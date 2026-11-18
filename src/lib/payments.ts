import "server-only";

import { query, queryOne, withTransaction } from "./db";
import {
  applyProviderStatus,
  latestTransaction,
  logProviderEvent,
  newIdempotencyKey,
  type OrderRow,
  type TransactionRow,
} from "./orders";
import { clientFromEnv, NevonError, nevonConfig, type NevonMethod } from "./nevonpay";

/** Métodos que a Nevon Pay documenta. */
export const PAYMENT_METHODS: Array<{
  id: NevonMethod;
  label: string;
  description: string;
  availableInSandbox: boolean;
  requirement?: string;
}> = [
  {
    id: "SANDBOX",
    label: "Nevon Pay — Sandbox",
    description:
      "Método de teste da Nevon Pay. Cria um pagamento real na API (sandbox) sem movimentar dinheiro.",
    availableInSandbox: true,
  },
  {
    id: "MPESA",
    label: "M-Pesa",
    description:
      "Documentado na API pública. No ambiente sandbox a Nevon Pay responde 503 PROVIDER_NOT_CONFIGURED até existir conta de programador M-Pesa.",
    availableInSandbox: false,
    requirement: "Requer conta de programador M-Pesa configurada pela Nevon Pay.",
  },
  {
    id: "EMOLA",
    label: "e-Mola",
    description:
      "Documentado na API pública. No ambiente sandbox a Nevon Pay responde 503 PROVIDER_NOT_CONFIGURED até a Nevon Pay disponibilizar a documentação/acesso oficial.",
    availableInSandbox: false,
    requirement: "Bloqueado até a Nevon Pay disponibilizar acesso oficial.",
  },
];

export type PaymentSessionResult =
  | {
      kind: "created" | "reused";
      transaction: TransactionRow;
      checkoutUrl: string;
    }
  | { kind: "already_paid"; order: OrderRow }
  | { kind: "error"; code: string; message: string; status: number };

/**
 * Cria (uma única vez) a sessão de pagamento de um pedido.
 *
 * Protecções contra pagamentos duplicados:
 *  - o pedido é bloqueado (`FOR UPDATE`) durante a operação;
 *  - pedido já pago → devolve `already_paid`, nunca cria nova cobrança;
 *  - existe transacção activa e não expirada → reutiliza-a (idempotente);
 *  - índice único parcial em `transactions(order_id)` para OPEN/PENDING/PROCESSING;
 *  - `Idempotency-Key` enviada à Nevon Pay.
 */
export async function createPaymentForOrder(input: {
  orderId: string;
  method: NevonMethod;
  appUrl: string;
  actor?: { id: string; role: string; ip?: string | null };
}): Promise<PaymentSessionResult> {
  if (!nevonConfig().secretKey) {
    return {
      kind: "error",
      code: "NEVONPAY_NOT_CONFIGURED",
      message: "A integração Nevon Pay não está configurada (NEVONPAY_SECRET_KEY ausente).",
      status: 503,
    };
  }

  const methodInfo = PAYMENT_METHODS.find((m) => m.id === input.method);
  if (!methodInfo) {
    return { kind: "error", code: "INVALID_METHOD", message: "Método de pagamento inválido.", status: 400 };
  }

  const existingActive = await queryOne<TransactionRow>(
    `SELECT * FROM transactions
      WHERE order_id = $1 AND status IN ('OPEN','PENDING','PROCESSING')
      ORDER BY created_at DESC LIMIT 1`,
    [input.orderId]
  );

  const order = await queryOne<OrderRow>(`SELECT * FROM orders WHERE id = $1`, [input.orderId]);
  if (!order) return { kind: "error", code: "NOT_FOUND", message: "Pedido não encontrado.", status: 404 };

  if (order.payment_status === "PAID") return { kind: "already_paid", order };

  if (existingActive) {
    const expired =
      existingActive.expires_at !== null && new Date(existingActive.expires_at).getTime() < Date.now();
    if (!expired && existingActive.checkout_url) {
      // A sessão pode ter sido cancelada na própria gateway (o botão "Cancelar
      // este pagamento"). Nesse caso o link está morto e não deve ser reutilizado.
      const sessionState = await checkoutSessionState(existingActive.checkout_session_id);
      if (sessionState === "CANCELLED" || sessionState === "EXPIRED" || sessionState === "COMPLETED") {
        await query(
          `UPDATE transactions SET status = $2, updated_at = now()
            WHERE id = $1 AND status IN ('OPEN','PENDING','PROCESSING')`,
          [existingActive.id, sessionState]
        );
      } else {
        return { kind: "reused", transaction: existingActive, checkoutUrl: existingActive.checkout_url };
      }
    } else if (expired) {
      await query(
        `UPDATE transactions SET status = 'EXPIRED', updated_at = now() WHERE id = $1 AND status IN ('OPEN','PENDING','PROCESSING')`,
        [existingActive.id]
      );
    }
  }

  if (order.status === "CANCELLED" || order.status === "DELIVERED") {
    return {
      kind: "error",
      code: "ORDER_NOT_PAYABLE",
      message: "Este pedido não pode ser pago no estado actual.",
      status: 409,
    };
  }

  const idempotencyKey = newIdempotencyKey(order.id);
  const successUrl = `${input.appUrl}/pedido/${order.reference}?pagamento=retorno`;
  const cancelUrl = `${input.appUrl}/pedido/${order.reference}?pagamento=cancelado`;

  let tx: TransactionRow;
  try {
    tx = await withTransaction(async (client) => {
      const inserted = await client.query<TransactionRow>(
        `INSERT INTO transactions
           (order_id, method, status, amount_cents, currency, idempotency_key, success_url, cancel_url, metadata)
         VALUES ($1, $2, 'OPEN', $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          order.id,
          input.method,
          order.total_cents,
          order.currency,
          idempotencyKey,
          successUrl,
          cancelUrl,
          JSON.stringify({ order_reference: order.reference }),
        ]
      );
      return inserted.rows[0];
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro";
    if (message.includes("transactions_active_order_idx") || message.includes("duplicate key")) {
      const active = await queryOne<TransactionRow>(
        `SELECT * FROM transactions WHERE order_id = $1 AND status IN ('OPEN','PENDING','PROCESSING') ORDER BY created_at DESC LIMIT 1`,
        [order.id]
      );
      if (active?.checkout_url) {
        return { kind: "reused", transaction: active, checkoutUrl: active.checkout_url };
      }
    }
    throw error;
  }

  const method: NevonMethod = input.method === "SANDBOX" ? "SANDBOX" : input.method;
  const client = clientFromEnv({ onEvent: logProviderEvent });

  try {
    // 1) Registo da transacção na Nevon Pay (endpoint de pagamentos, com
    //    idempotência) — é a referência que consultamos para confirmar.
    const payment = await client.createPayment({
      amount: order.total_cents / 100,
      currency: order.currency,
      method,
      reference: tx.idempotency_key,
      idempotencyKey: tx.idempotency_key,
      metadata: { order_reference: order.reference, order_id: order.id },
      requestRef: order.reference,
    });

    // 2) Sessão de checkout hospedada (onde o cliente efectua o pagamento).
    const { session, checkoutUrl } = await client.createCheckoutSession({
      amount: order.total_cents / 100,
      currency: order.currency,
      successUrl,
      cancelUrl,
      customer: {
        name: order.customer_name,
        email: order.customer_email,
        phone: order.customer_phone,
      },
      metadata: {
        order_reference: order.reference,
        order_id: order.id,
        payment_id: payment.id,
        idempotency_key: tx.idempotency_key,
      },
      expiresInMinutes: 45,
      requestRef: order.reference,
    });

    const updated = await queryOne<TransactionRow>(
      `UPDATE transactions
          SET status = $2,
              provider_payment_id = $3,
              provider_ref = $4,
              checkout_session_id = $5,
              checkout_url = $6,
              expires_at = $7,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        tx.id,
        session.status === "OPEN" ? "PENDING" : session.status,
        payment.id,
        payment.reference ?? session.payment?.reference ?? null,
        session.id,
        checkoutUrl,
        session.expiresAt ? new Date(session.expiresAt) : new Date(Date.now() + 45 * 60 * 1000),
      ]
    );

    return { kind: "created", transaction: updated ?? tx, checkoutUrl };
  } catch (error) {
    const nevonError = error instanceof NevonError ? error : null;
    await query(
      `UPDATE transactions SET status = 'FAILED', last_error = $2, updated_at = now() WHERE id = $1`,
      [tx.id, nevonError?.message ?? (error instanceof Error ? error.message : "erro desconhecido")]
    );
    await logProviderEvent({
      kind: "ERROR",
      requestRef: order.reference,
      message: nevonError?.message ?? "Falha ao criar sessão de pagamento",
      ok: false,
    });
    return {
      kind: "error",
      code: nevonError?.code ?? "PAYMENT_CREATE_FAILED",
      message: nevonError?.publicMessage ?? "Não foi possível iniciar o pagamento.",
      status: nevonError?.status && nevonError.status >= 400 && nevonError.status < 600 ? 502 : 500,
    };
  }
}

export type VerificationResult =
  | { ok: true; outcome: Awaited<ReturnType<typeof applyProviderStatus>>; providerStatus: string }
  | { ok: false; code: string; message: string; status: number };

/**
 * Confirma o estado do pagamento consultando a Nevon Pay com a chave secreta.
 * Esta é a ÚNICA via que pode marcar um pedido como pago.
 */

/**
 * Consulta à gateway o estado real da sessão de checkout.
 *
 * O cliente pode cancelar o pagamento na própria página da Nevon Pay; sem esta
 * verificação a aplicação continuaria a mostrar "Continuar pagamento" com um
 * link que já não existe ("Checkout não encontrado").
 */
async function checkoutSessionState(
  sessionId: string | null
): Promise<string | null> {
  if (!sessionId) return null;
  try {
    const client = clientFromEnv({ onEvent: logProviderEvent });
    const session = await client.getCheckoutSession(sessionId);
    return session.status ?? null;
  } catch {
    return null;
  }
}

export async function verifyOrderPayment(orderId: string): Promise<VerificationResult> {
  const order = await queryOne<OrderRow>(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  if (!order) return { ok: false, code: "NOT_FOUND", message: "Pedido não encontrado.", status: 404 };

  const tx = await latestTransaction(orderId);
  if (!tx) {
    return {
      ok: false,
      code: "NO_TRANSACTION",
      message: "Este pedido ainda não tem transacção de pagamento.",
      status: 409,
    };
  }
  if (order.payment_status === "PAID") {
    return {
      ok: true,
      providerStatus: tx.status,
      outcome: {
        orderId: order.id,
        reference: order.reference,
        changed: false,
        status: order.status,
        paymentStatus: "PAID",
        source: "API_QUERY",
        providerStatus: tx.status,
      },
    };
  }
  if (!tx.provider_payment_id && !tx.provider_ref) {
    return {
      ok: false,
      code: "NOT_SENT_TO_PROVIDER",
      message: "A transacção não foi registada na Nevon Pay.",
      status: 409,
    };
  }

  const client = clientFromEnv({ onEvent: logProviderEvent });
  try {
    // A API só resolve o pagamento pelo seu ID (`cmm…`). O providerRef
    // (`sandbox_…`) devolve NOT_FOUND, por isso o ID é a primeira escolha.
    const payment = await client.getPayment(
      tx.provider_payment_id ?? tx.provider_ref ?? "",
      order.reference
    );
    const outcome = await applyProviderStatus({
      transactionId: tx.id,
      payment: {
        id: payment.id,
        status: payment.status,
        reference: payment.reference,
        providerRef: payment.providerRef ?? null,
      },
      source: "API_QUERY",
    });
    return { ok: true, outcome, providerStatus: payment.status };
  } catch (error) {
    const nevonError = error instanceof NevonError ? error : null;
    await query(
      `UPDATE transactions SET last_error = $2, updated_at = now() WHERE id = $1`,
      [tx.id, nevonError?.message ?? "erro de verificação"]
    );
    return {
      ok: false,
      code: nevonError?.code ?? "VERIFY_FAILED",
      message: nevonError?.publicMessage ?? "Não foi possível confirmar o pagamento.",
      status: 502,
    };
  }
}

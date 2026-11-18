import "server-only";

import { randomBytes } from "node:crypto";
import { query, queryOne, withTransaction } from "./db";
import {
  nevonConfig,
  isPaidStatus,
  type NevonPayClient,
  type NevonPaymentStatus,
} from "./nevonpay";

export type OrderRow = {
  id: string;
  reference: string;
  user_id: string | null;
  status: string;
  payment_status: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  delivery_recipient: string;
  delivery_phone: string;
  delivery_street: string;
  delivery_number: string | null;
  delivery_neighbourhood: string | null;
  delivery_city: string;
  delivery_reference: string | null;
  notes: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  discount_cents: number;
  total_cents: number;
  currency: string;
  promo_code: string | null;
  courier_id: string | null;
  assigned_at: string | null;
  paid_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TransactionRow = {
  id: string;
  order_id: string;
  provider: string;
  environment: string;
  method: string;
  status: NevonPaymentStatus;
  amount_cents: number;
  currency: string;
  idempotency_key: string;
  checkout_session_id: string | null;
  checkout_url: string | null;
  provider_ref: string | null;
  provider_payment_id: string | null;
  expires_at: string | null;
  confirmed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export const NEVON_STATUS_MAP: Record<string, string> = {
  OPEN: "OPEN",
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
};

/** Referência legível e única: EX-2026-8F3K2A */
export function newOrderReference() {
  const year = new Date().getFullYear();
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `EX-${year}-${suffix}`;
}

export function newIdempotencyKey(orderId: string) {
  return `express_${orderId}_${randomBytes(8).toString("hex")}`;
}

/** Registo técnico das chamadas à Nevon Pay (sem segredos). */
export async function logProviderEvent(event: {
  kind: string;
  method?: string;
  path?: string;
  statusCode?: number;
  ok?: boolean;
  durationMs?: number;
  requestRef?: string | null;
  message?: string;
  payload?: unknown;
}) {
  try {
    await query(
      `INSERT INTO provider_events (kind, method, path, status_code, ok, duration_ms, request_ref, message, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        event.kind,
        event.method ?? null,
        event.path ?? null,
        event.statusCode ?? null,
        event.ok ?? null,
        event.durationMs ?? null,
        event.requestRef ?? null,
        event.message ?? null,
        event.payload === undefined ? null : JSON.stringify(event.payload),
      ]
    );
  } catch (error) {
    console.error("[nevonpay] falha ao registar evento:", error instanceof Error ? error.message : error);
  }
}

export async function addOrderEvent(input: {
  orderId: string;
  status: string;
  note?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
}) {
  await query(
    `INSERT INTO order_events (order_id, status, note, actor_id, actor_role) VALUES ($1, $2, $3, $4, $5)`,
    [input.orderId, input.status, input.note ?? null, input.actorId ?? null, input.actorRole ?? null]
  );
}

export async function notify(input: {
  audience: "ADMIN" | "COURIER" | "CUSTOMER";
  userId?: string | null;
  orderId?: string | null;
  type: string;
  title: string;
  body?: string | null;
}) {
  await query(
    `INSERT INTO notifications (audience, user_id, order_id, type, title, body)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.audience,
      input.userId ?? null,
      input.orderId ?? null,
      input.type,
      input.title,
      input.body ?? null,
    ]
  );
}

export async function audit(input: {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  resource?: string;
  resourceId?: string;
  metadata?: unknown;
  ip?: string | null;
}) {
  await query(
    `INSERT INTO audit_log (actor_id, actor_role, action, resource, resource_id, metadata, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.actorId ?? null,
      input.actorRole ?? null,
      input.action,
      input.resource ?? null,
      input.resourceId ?? null,
      input.metadata === undefined ? null : JSON.stringify(input.metadata),
      input.ip ?? null,
    ]
  );
}

export type ConfirmOutcome = {
  orderId: string;
  reference: string;
  changed: boolean;
  status: string;
  paymentStatus: string;
  source: "API_QUERY" | "WEBHOOK_API_QUERY";
  providerStatus: string;
};

/**
 * Aplica o resultado de uma consulta autenticada à Nevon Pay.
 *
 * Regra central do projecto: o pedido só passa a PAGAMENTO CONFIRMADO quando a
 * própria Nevon Pay devolve, numa resposta autenticada, o estado COMPLETED.
 * Nunca a partir do URL de retorno, de um parâmetro de query ou de uma página
 * de sucesso.
 */
export async function applyProviderStatus(input: {
  transactionId: string;
  payment: { id: string; status: NevonPaymentStatus; reference: string; providerRef?: string | null };
  source: "API_QUERY" | "WEBHOOK_API_QUERY";
}): Promise<ConfirmOutcome | null> {
  const providerStatus = input.payment.status;
  const mapped = NEVON_STATUS_MAP[providerStatus] ?? "PENDING";

  return withTransaction(async (client) => {
    const txRes = await client.query<TransactionRow>(
      `SELECT * FROM transactions WHERE id = $1 FOR UPDATE`,
      [input.transactionId]
    );
    const tx = txRes.rows[0];
    if (!tx) return null;

    const orderRes = await client.query<OrderRow>(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [
      tx.order_id,
    ]);
    const order = orderRes.rows[0];
    if (!order) return null;

    const alreadyPaid = order.payment_status === "PAID";
    const paidNow = isPaidStatus(providerStatus);

    await client.query(
      `UPDATE transactions
          SET status = $2,
              provider_payment_id = $3,
              provider_ref = COALESCE($4, provider_ref),
              confirmed_at = CASE WHEN $5 AND confirmed_at IS NULL THEN now() ELSE confirmed_at END,
              last_error = CASE WHEN $2 IN ('FAILED','CANCELLED','EXPIRED') THEN $6 ELSE NULL END,
              updated_at = now()
        WHERE id = $1`,
      [
        tx.id,
        mapped,
        input.payment.id,
        input.payment.providerRef ?? null,
        paidNow,
        mapped === "FAILED" ? "A Nevon Pay reportou o pagamento como falhado." : null,
      ]
    );

    let changed = false;

    if (paidNow && !alreadyPaid) {
      await client.query(
        `UPDATE orders
            SET payment_status = 'PAID',
                paid_at = COALESCE(paid_at, now()),
                status = CASE WHEN status = 'RECEIVED' THEN 'PAYMENT_CONFIRMED' ELSE status END,
                updated_at = now()
          WHERE id = $1`,
        [order.id]
      );
      await client.query(
        `INSERT INTO order_events (order_id, status, note, actor_role)
         VALUES ($1, 'PAYMENT_CONFIRMED', $2, 'SYSTEM')`,
        [
          order.id,
          `Confirmado por consulta autenticada à Nevon Pay (transacção ${input.payment.id}, estado ${providerStatus}).`,
        ]
      );
      await client.query(
        `INSERT INTO notifications (audience, order_id, type, title, body)
         VALUES ('ADMIN', $1, 'order.paid', $2, $3)`,
        [
          order.id,
          `Pedido ${order.reference} pago`,
          `Pagamento confirmado pela Nevon Pay (${input.payment.id}). Preparar a entrega.`,
        ]
      );
      await client.query(
        `INSERT INTO notifications (audience, user_id, order_id, type, title, body)
         VALUES ('CUSTOMER', $1, $2, 'order.paid', 'Pagamento confirmado', $3)`,
        [
          order.user_id,
          order.id,
          `O pagamento do pedido ${order.reference} foi confirmado pela Nevon Pay. Vamos preparar a entrega.`,
        ]
      );
      changed = true;
    } else if (!paidNow && !alreadyPaid && ["FAILED", "CANCELLED", "EXPIRED"].includes(mapped)) {
      const orderStatus = order.status === "RECEIVED" ? order.status : order.status;
      await client.query(
        `UPDATE orders
            SET payment_status = $2, updated_at = now()
          WHERE id = $1 AND payment_status = 'PENDING'`,
        [order.id, mapped === "CANCELLED" ? "CANCELLED" : mapped === "EXPIRED" ? "EXPIRED" : "FAILED"]
      );
      await client.query(
        `INSERT INTO order_events (order_id, status, note, actor_role)
         VALUES ($1, $2, $3, 'SYSTEM')`,
        [order.id, orderStatus, `Nevon Pay reportou o pagamento como ${mapped}.`]
      );
      changed = true;
    }

    return {
      orderId: order.id,
      reference: order.reference,
      changed,
      status: paidNow && !alreadyPaid ? "PAYMENT_CONFIRMED" : order.status,
      paymentStatus: paidNow ? "PAID" : order.payment_status,
      source: input.source,
      providerStatus,
    };
  });
}

/** Activa a transacção mais recente de um pedido (a que está em curso). */
export async function latestTransaction(orderId: string) {
  return queryOne<TransactionRow>(
    `SELECT * FROM transactions WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orderId]
  );
}

export function environmentLabel() {
  return nevonConfig().environment === "PRODUCTION" ? "Produção" : "Sandbox";
}

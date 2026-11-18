import { query, queryOne } from "@/lib/db";
import { clientIp, errorJson, okJson, rateLimit } from "@/lib/http";
import { addOrderEvent, logProviderEvent, type OrderRow, type TransactionRow } from "@/lib/orders";
import { applyProviderStatus } from "@/lib/orders";
import { clientFromEnv, nevonConfig, sanitizePayload } from "@/lib/nevonpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint de webhooks.
 *
 * A documentação pública da Nevon Pay não descreve webhooks nem esquema de
 * assinatura. Este handler foi desenhado para ser seguro nos dois casos:
 *
 *  1. Verifica a assinatura quando NEVONPAY_WEBHOOK_SECRET está definido.
 *  2. Independentemente do conteúdo recebido, NUNCA confia no estado enviado no
 *     corpo: usa o payload apenas para identificar a transacção e depois
 *     consulta a Nevon Pay com a chave secreta (GET /api/v1/payments/{id}).
 *     Só essa resposta autenticada pode marcar o pedido como pago.
 *  3. `event_id` único impede processamento duplicado (idempotência).
 */
export async function POST(request: Request) {
  const limit = rateLimit(`webhook:${clientIp(request)}`, 120, 60);
  if (!limit.allowed) {
    return errorJson("RATE_LIMITED", "Demasiados webhooks.", { status: 429 });
  }

  const raw = await request.text();
  const config = nevonConfig();
  const client = clientFromEnv({ onEvent: logProviderEvent });
  const signature =
    request.headers.get("x-nevonpay-signature") ??
    request.headers.get("x-signature") ??
    request.headers.get("x-webhook-signature");

  const verification = client.verifyWebhook(raw, signature);

  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    await logProviderEvent({ kind: "WEBHOOK", ok: false, message: "Corpo do webhook não é JSON válido." });
    return errorJson("INVALID_PAYLOAD", "Corpo inválido.", { status: 400 });
  }

  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const candidates = key.split(".").reduce<unknown>((acc, part) => {
        if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[part];
        return undefined;
      }, payload);
      if (typeof candidates === "string" && candidates.trim()) return candidates.trim();
      if (typeof candidates === "number") return String(candidates);
    }
    return null;
  };

  const providerPaymentId = pick("payment.id", "payment_id", "data.payment.id", "data.id", "id");
  const providerReference = pick("payment.reference", "reference", "data.reference", "data.payment.reference");
  const eventId =
    pick("event_id", "event.id", "id", "webhook_id") ??
    `${providerPaymentId ?? providerReference ?? "unknown"}:${pick("event", "type", "status") ?? "status"}`;

  const existing = await queryOne<{ id: string; processed: boolean }>(
    `SELECT id, processed FROM webhook_events WHERE provider = 'NEVONPAY' AND event_id = $1`,
    [eventId]
  );
  if (existing?.processed) {
    return okJson({ received: true, duplicate: true, changed: false, event_id: eventId });
  }

  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO webhook_events (event_id, signature_ok, payload)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, event_id) DO UPDATE SET payload = EXCLUDED.payload
     RETURNING id`,
    [eventId, verification.verified, JSON.stringify(sanitizePayload(payload))]
  );

  // Encontra a transacção correspondente (por id do pagamento no provedor ou
  // pela referência usada na criação).
  let tx: TransactionRow | null = null;
  if (providerPaymentId) {
    tx = await queryOne<TransactionRow>(
      `SELECT * FROM transactions WHERE provider_payment_id = $1 OR provider_ref = $1 ORDER BY created_at DESC LIMIT 1`,
      [providerPaymentId]
    );
  }
  if (!tx && providerReference) {
    tx = await queryOne<TransactionRow>(
      `SELECT * FROM transactions WHERE provider_ref = $1 OR idempotency_key = $1 ORDER BY created_at DESC LIMIT 1`,
      [providerReference]
    );
  }

  if (!tx) {
    await query(
      `UPDATE webhook_events SET error = $2, processed = false WHERE id = $1`,
      [inserted!.id, "Transacção não encontrada para o evento."]
    );
    await logProviderEvent({
      kind: "WEBHOOK",
      ok: false,
      message: `Webhook ${eventId} sem transacção correspondente.`,
      payload: sanitizePayload(payload),
    });
    return okJson({ received: true, matched: false, changed: false, event_id: eventId });
  }

  if (!tx.provider_ref) {
    await query(`UPDATE webhook_events SET error = $2 WHERE id = $1`, [
      inserted!.id,
      "Transacção sem referência no provedor.",
    ]);
    return okJson({ received: true, matched: true, verified: false, changed: false, event_id: eventId });
  }

  const order = await queryOne<OrderRow>(`SELECT * FROM orders WHERE id = $1`, [tx.order_id]);

  try {
    // Fonte de verdade: consulta autenticada à Nevon Pay.
    const payment = await client.getPayment(tx.provider_ref, order?.reference ?? null);
    const outcome = await applyProviderStatus({
      transactionId: tx.id,
      payment: {
        id: payment.id,
        status: payment.status,
        reference: payment.reference,
        providerRef: payment.providerRef ?? null,
      },
      source: "WEBHOOK_API_QUERY",
    });

    if (order && outcome?.changed) {
      await addOrderEvent({
        orderId: order.id,
        status: outcome.status,
        note: `Webhook Nevon Pay (${eventId}) verificado por consulta autenticada: ${payment.status}.`,
        actorRole: "SYSTEM",
      });
    }

    await query(
      `UPDATE webhook_events SET processed = true, processed_at = now(), error = NULL WHERE id = $1`,
      [inserted!.id]
    );
    await logProviderEvent({
      kind: "WEBHOOK",
      ok: true,
      requestRef: order?.reference ?? null,
      message: `Webhook ${eventId} processado. Assinatura: ${verification.verified ? "válida" : verification.reason} Estado real: ${payment.status}`,
    });

    return okJson({
      received: true,
      matched: true,
      verified: verification.verified,
      provider_status: payment.status,
      changed: outcome?.changed ?? false,
      environment: config.environment,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro";
    await query(`UPDATE webhook_events SET error = $2 WHERE id = $1`, [inserted!.id, message.slice(0, 500)]);
    await logProviderEvent({ kind: "WEBHOOK", ok: false, message: `Falha ao processar webhook: ${message}` });
    // 200 para evitar reenvios infinitos; o erro fica registado e visível no
    // painel de diagnóstico, e o estado pode ser reconsultado manualmente.
    return okJson({ received: true, changed: false, error: "processing_failed" });
  }
}

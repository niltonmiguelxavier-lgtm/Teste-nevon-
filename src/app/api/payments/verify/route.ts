import { currentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { errorJson, okJson, rateLimit } from "@/lib/http";
import { audit, type OrderRow } from "@/lib/orders";
import { verifyOrderPayment } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Confirma o pagamento consultando a Nevon Pay com a chave secreta.
 * Devolver o cliente do checkout para esta rota NÃO confirma nada: o estado
 * vem sempre da resposta autenticada da API.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return errorJson("UNAUTHENTICATED", "Inicie sessão.", { status: 401 });

  const limit = rateLimit(`verify:${user.id}`, 30, 60);
  if (!limit.allowed) {
    return errorJson("RATE_LIMITED", "Demasiados pedidos de verificação. Aguarde.", { status: 429 });
  }

  let reference = "";
  try {
    const body = (await request.json()) as { reference?: string };
    reference = typeof body.reference === "string" ? body.reference.trim() : "";
  } catch {
    return errorJson("VALIDATION_ERROR", "Corpo do pedido inválido.", { status: 400 });
  }
  if (!reference) return errorJson("VALIDATION_ERROR", "Indique a referência do pedido.", { status: 400 });

  const order = await queryOne<OrderRow>(`SELECT * FROM orders WHERE reference = $1`, [reference]);
  if (!order) return errorJson("NOT_FOUND", "Pedido não encontrado.", { status: 404 });
  if (order.user_id !== user.id && user.role !== "ADMIN") {
    return errorJson("FORBIDDEN", "Este pedido não pertence à sua conta.", { status: 403 });
  }

  const result = await verifyOrderPayment(order.id);
  if (!result.ok) {
    return errorJson(result.code, result.message, { status: result.status });
  }

  await audit({
    actorId: user.id,
    actorRole: user.role,
    action: "payment.verified",
    resource: "orders",
    resourceId: order.id,
    metadata: {
      order_reference: order.reference,
      provider_status: result.providerStatus,
      changed: result.outcome?.changed ?? false,
    },
  });

  return okJson({
    reference: order.reference,
    provider_status: result.providerStatus,
    changed: result.outcome?.changed ?? false,
    payment_status: result.outcome?.paymentStatus ?? order.payment_status,
    order_status: result.outcome?.status ?? order.status,
    paid: result.providerStatus === "COMPLETED",
    checked_at: new Date().toISOString(),
  });
}

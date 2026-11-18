import { ZodError } from "zod";
import { currentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { clientIp, errorJson, okJson, rateLimit, validationError } from "@/lib/http";
import { audit, type OrderRow } from "@/lib/orders";
import { createPaymentForOrder } from "@/lib/payments";
import { paymentCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cria a cobrança na Nevon Pay para um pedido existente.
 * A chave secreta é usada apenas aqui, no servidor.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return errorJson("UNAUTHENTICATED", "Inicie sessão para pagar.", { status: 401 });

  const limit = rateLimit(`pay:${user.id}`, 10, 60);
  if (!limit.allowed) {
    return errorJson("RATE_LIMITED", "Aguarde alguns segundos antes de tentar novamente.", { status: 429 });
  }

  try {
    const body = (await request.json()) as { reference?: string } & Record<string, unknown>;
    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    if (!reference) {
      return errorJson("VALIDATION_ERROR", "Indique a referência do pedido.", { status: 400 });
    }
    const { method } = paymentCreateSchema.parse(body);

    const order = await queryOne<OrderRow>(`SELECT * FROM orders WHERE reference = $1`, [reference]);
    if (!order) return errorJson("NOT_FOUND", "Pedido não encontrado.", { status: 404 });
    if (order.user_id !== user.id && user.role !== "ADMIN") {
      return errorJson("FORBIDDEN", "Este pedido não pertence à sua conta.", { status: 403 });
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ||
      new URL(request.url).origin;

    const result = await createPaymentForOrder({
      orderId: order.id,
      method,
      appUrl,
      actor: { id: user.id, role: user.role, ip: clientIp(request) },
    });

    if (result.kind === "error") {
      return errorJson(result.code, result.message, { status: result.status });
    }
    if (result.kind === "already_paid") {
      return okJson({
        already_paid: true,
        reference: order.reference,
        redirect: `/pedido/${order.reference}`,
      });
    }

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "payment.initiated",
      resource: "transactions",
      resourceId: result.transaction.id,
      metadata: {
        order_reference: order.reference,
        method,
        amount_cents: order.total_cents,
        environment: result.transaction.environment,
        provider_payment_id: result.transaction.provider_payment_id,
        reused: result.kind === "reused",
      },
      ip: clientIp(request),
    });

    return okJson(
      {
        transaction_id: result.transaction.id,
        provider_payment_id: result.transaction.provider_payment_id,
        status: result.transaction.status,
        environment: result.transaction.environment,
        checkout_url: result.checkoutUrl,
        reused: result.kind === "reused",
        reference: order.reference,
      },
      { status: result.kind === "created" ? 201 : 200 }
    );
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    console.error("[payments.create]", error);
    return errorJson("INTERNAL_ERROR", "Não foi possível iniciar o pagamento.", { status: 500 });
  }
}

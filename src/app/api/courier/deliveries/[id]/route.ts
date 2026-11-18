import { ZodError } from "zod";
import { query, queryOne } from "@/lib/db";
import { guard } from "@/lib/guard";
import { errorJson, okJson, validationError } from "@/lib/http";
import { addOrderEvent, audit, notify, type OrderRow } from "@/lib/orders";
import { courierStatusSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COURIER_TRANSITIONS: Record<string, string[]> = {
  // O entregador pode marcar recolha (PREPARING -> OUT_FOR_DELIVERY) e entrega.
  PAYMENT_CONFIRMED: ["OUT_FOR_DELIVERY"],
  PREPARING: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
};

/** O entregador actualiza o estado da sua entrega. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(["COURIER", "ADMIN"]);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    const input = courierStatusSchema.parse(await request.json());
    const order = await queryOne<OrderRow>(`SELECT * FROM orders WHERE id = $1`, [id]);
    if (!order) return errorJson("NOT_FOUND", "Pedido não encontrado.", { status: 404 });

    if (auth.user.role === "COURIER" && order.courier_id !== auth.user.id) {
      return errorJson("FORBIDDEN", "Esta entrega não está atribuída a si.", { status: 403 });
    }
    if (order.payment_status !== "PAID") {
      return errorJson("PAYMENT_REQUIRED", "Este pedido ainda não tem pagamento confirmado.", {
        status: 409,
      });
    }

    const allowed = COURIER_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(input.status)) {
      return errorJson(
        "INVALID_TRANSITION",
        `Não é possível marcar como ${input.status} a partir de ${order.status}.`,
        { status: 409 }
      );
    }

    await query(
      `UPDATE orders
          SET status = $2, updated_at = now(),
              delivered_at = CASE WHEN $2 = 'DELIVERED' THEN now() ELSE delivered_at END
        WHERE id = $1`,
      [order.id, input.status]
    );

    await addOrderEvent({
      orderId: order.id,
      status: input.status,
      note: input.note ?? null,
      actorId: auth.user.id,
      actorRole: auth.user.role,
    });

    await notify({
      audience: "CUSTOMER",
      userId: order.user_id,
      orderId: order.id,
      type: `order.${input.status.toLowerCase()}`,
      title:
        input.status === "OUT_FOR_DELIVERY"
          ? `O pedido ${order.reference} saiu para entrega`
          : `O pedido ${order.reference} foi entregue`,
      body: input.note ?? null,
    });

    await audit({
      actorId: auth.user.id,
      actorRole: auth.user.role,
      action: "delivery.status_changed",
      resource: "orders",
      resourceId: order.id,
      metadata: { from: order.status, to: input.status },
    });

    return okJson({ order_id: order.id, status: input.status });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    console.error("[courier.deliveries.patch]", error);
    return errorJson("INTERNAL_ERROR", "Não foi possível actualizar a entrega.", { status: 500 });
  }
}

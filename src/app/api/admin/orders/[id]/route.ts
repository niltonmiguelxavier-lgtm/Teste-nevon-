import { ZodError } from "zod";
import { queryOne, query } from "@/lib/db";
import { ADMIN_ONLY, guard } from "@/lib/guard";
import { errorJson, okJson, validationError } from "@/lib/http";
import { addOrderEvent, audit, notify, type OrderRow } from "@/lib/orders";
import { orderStatusUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRANSITIONS: Record<string, string[]> = {
  RECEIVED: ["PREPARING", "CANCELLED"],
  PAYMENT_CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

/** Alteração de estado pelo administrador, com transições validadas. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    const input = orderStatusUpdateSchema.parse(await request.json());
    const order = await queryOne<OrderRow>(`SELECT * FROM orders WHERE id = $1`, [id]);
    if (!order) return errorJson("NOT_FOUND", "Pedido não encontrado.", { status: 404 });

    const allowed = TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(input.status)) {
      return errorJson(
        "INVALID_TRANSITION",
        `Não é possível passar de ${order.status} para ${input.status}.`,
        { status: 409 }
      );
    }
    if (input.status === "PREPARING" && order.payment_status !== "PAID") {
      return errorJson("PAYMENT_REQUIRED", "Só é possível preparar pedidos com pagamento confirmado.", {
        status: 409,
      });
    }

    await query(
      `UPDATE orders
          SET status = $2,
              updated_at = now(),
              delivered_at = CASE WHEN $2 = 'DELIVERED' THEN now() ELSE delivered_at END,
              cancelled_at = CASE WHEN $2 = 'CANCELLED' THEN now() ELSE cancelled_at END
        WHERE id = $1`,
      [order.id, input.status]
    );

    await addOrderEvent({
      orderId: order.id,
      status: input.status,
      note: input.note ?? null,
      actorId: auth.user.id,
      actorRole: "ADMIN",
    });

    await notify({
      audience: "CUSTOMER",
      userId: order.user_id,
      orderId: order.id,
      type: `order.${input.status.toLowerCase()}`,
      title: `Pedido ${order.reference} actualizado`,
      body: input.note || `Novo estado: ${input.status}`,
    });

    await audit({
      actorId: auth.user.id,
      actorRole: "ADMIN",
      action: "order.status_changed",
      resource: "orders",
      resourceId: order.id,
      metadata: { from: order.status, to: input.status },
    });

    return okJson({ order_id: order.id, status: input.status });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    console.error("[admin.orders.patch]", error);
    return errorJson("INTERNAL_ERROR", "Não foi possível actualizar o pedido.", { status: 500 });
  }
}

/** Atribuição de entregador. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    const body = (await request.json()) as { courierId?: string | null };
    const courierId = body.courierId ?? null;

    const order = await queryOne<OrderRow>(`SELECT * FROM orders WHERE id = $1`, [id]);
    if (!order) return errorJson("NOT_FOUND", "Pedido não encontrado.", { status: 404 });

    if (courierId) {
      const courier = await queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM users WHERE id = $1 AND role = 'COURIER' AND active`,
        [courierId]
      );
      if (!courier) return errorJson("COURIER_NOT_FOUND", "Entregador inválido ou inactivo.", { status: 404 });

      await query(`UPDATE orders SET courier_id = $2, assigned_at = now(), updated_at = now() WHERE id = $1`, [
        order.id,
        courierId,
      ]);
      await addOrderEvent({
        orderId: order.id,
        status: order.status,
        note: `Entregador atribuído: ${courier.name}.`,
        actorId: auth.user.id,
        actorRole: "ADMIN",
      });
      await notify({
        audience: "COURIER",
        userId: courierId,
        orderId: order.id,
        type: "delivery.assigned",
        title: `Nova entrega atribuída: ${order.reference}`,
        body: `${order.delivery_street}, ${order.delivery_city} · ${order.delivery_phone}`,
      });
    } else {
      await query(`UPDATE orders SET courier_id = NULL, assigned_at = NULL, updated_at = now() WHERE id = $1`, [
        order.id,
      ]);
      await addOrderEvent({
        orderId: order.id,
        status: order.status,
        note: "Entregador removido.",
        actorId: auth.user.id,
        actorRole: "ADMIN",
      });
    }

    await audit({
      actorId: auth.user.id,
      actorRole: "ADMIN",
      action: courierId ? "order.courier_assigned" : "order.courier_removed",
      resource: "orders",
      resourceId: order.id,
      metadata: { courier_id: courierId },
    });

    return okJson({ order_id: order.id, courier_id: courierId });
  } catch (error) {
    console.error("[admin.orders.assign]", error);
    return errorJson("INTERNAL_ERROR", "Não foi possível atribuir o entregador.", { status: 500 });
  }
}

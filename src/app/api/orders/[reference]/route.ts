import { currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { errorJson, okJson } from "@/lib/http";
import { latestTransaction, type OrderRow } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Detalhe do pedido. O cliente só vê os próprios pedidos; ADMIN e o entregador
 * atribuído também têm acesso.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const user = await currentUser();
  if (!user) return errorJson("UNAUTHENTICATED", "Inicie sessão para consultar o pedido.", { status: 401 });

  const { reference } = await params;
  const order = await queryOne<OrderRow>(`SELECT * FROM orders WHERE reference = $1`, [reference]);
  if (!order) return errorJson("NOT_FOUND", "Pedido não encontrado.", { status: 404 });

  const isOwner = order.user_id === user.id;
  const isStaff = user.role === "ADMIN";
  const isCourier = user.role === "COURIER" && order.courier_id === user.id;
  if (!isOwner && !isStaff && !isCourier) {
    return errorJson("FORBIDDEN", "Não tem acesso a este pedido.", { status: 403 });
  }

  const items = await query<{
    id: string;
    name: string;
    unit_price_cents: number;
    quantity: number;
    line_total_cents: number;
  }>(`SELECT id, name, unit_price_cents, quantity, line_total_cents FROM order_items WHERE order_id = $1`, [
    order.id,
  ]);

  const events = await query<{ status: string; note: string | null; created_at: string; actor_role: string | null }>(
    `SELECT status, note, created_at, actor_role FROM order_events WHERE order_id = $1 ORDER BY created_at ASC`,
    [order.id]
  );

  const tx = await latestTransaction(order.id);

  return okJson({
    order,
    items,
    events,
    transaction: tx
      ? {
          id: tx.id,
          status: tx.status,
          method: tx.method,
          provider_payment_id: tx.provider_payment_id,
          checkout_url: tx.checkout_url,
          expires_at: tx.expires_at,
          confirmed_at: tx.confirmed_at,
        }
      : null,
  });
}

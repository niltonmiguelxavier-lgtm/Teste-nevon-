import { query } from "@/lib/db";
import { guard } from "@/lib/guard";
import { okJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Entregas atribuídas ao entregador autenticado. */
export async function GET(request: Request) {
  const auth = await guard(["COURIER", "ADMIN"]);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const scope = url.searchParams.get("estado") ?? "activas";

  const params: unknown[] = [];
  let filter = "";
  if (auth.user.role === "COURIER") {
    params.push(auth.user.id);
    filter = `o.courier_id = $${params.length}`;
  } else {
    filter = "o.courier_id IS NOT NULL";
  }

  if (scope === "activas") {
    filter += ` AND o.status IN ('PAYMENT_CONFIRMED','PREPARING','OUT_FOR_DELIVERY')`;
  } else if (scope === "concluidas") {
    filter += ` AND o.status = 'DELIVERED'`;
  }

  const deliveries = await query(
    `SELECT o.id, o.reference, o.status, o.payment_status,
            o.delivery_recipient, o.delivery_phone, o.delivery_street, o.delivery_number,
            o.delivery_neighbourhood, o.delivery_city, o.delivery_reference, o.notes,
            o.total_cents, o.assigned_at, o.delivered_at, o.created_at,
            u.name AS courier_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.courier_id
      WHERE ${filter}
      ORDER BY o.assigned_at DESC NULLS LAST, o.created_at DESC
      LIMIT 100`,
    params
  );

  return okJson({ deliveries });
}

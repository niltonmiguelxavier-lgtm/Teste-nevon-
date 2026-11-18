import { query } from "@/lib/db";
import { ADMIN_ONLY, guard } from "@/lib/guard";
import { okJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("estado");
  const payment = url.searchParams.get("pagamento");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limite") ?? 100), 1), 300);

  const filters: string[] = ["1=1"];
  const params: unknown[] = [];
  if (status) {
    params.push(status);
    filters.push(`o.status = $${params.length}`);
  }
  if (payment) {
    params.push(payment);
    filters.push(`o.payment_status = $${params.length}`);
  }
  params.push(limit);

  const orders = await query(
    `SELECT o.*, u.name AS courier_name, t.status AS tx_status, t.provider_payment_id
       FROM orders o
       LEFT JOIN users u ON u.id = o.courier_id
       LEFT JOIN LATERAL (
         SELECT status, provider_payment_id FROM transactions
          WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
       ) t ON true
      WHERE ${filters.join(" AND ")}
      ORDER BY o.created_at DESC
      LIMIT $${params.length}`,
    params
  );

  return okJson({ orders });
}

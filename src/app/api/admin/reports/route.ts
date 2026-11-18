import { query } from "@/lib/db";
import { ADMIN_ONLY, guard } from "@/lib/guard";
import { okJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Relatórios financeiros por dia, método e estado. */
export async function GET(request: Request) {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("dias") ?? 30), 1), 365);

  const summary = await query<{
    day: string;
    paid_orders: string;
    revenue_cents: string;
    pending_cents: string;
    fees_cents: string;
  }>(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            count(*) FILTER (WHERE payment_status = 'PAID')::text AS paid_orders,
            coalesce(sum(total_cents) FILTER (WHERE payment_status = 'PAID'), 0)::text AS revenue_cents,
            coalesce(sum(total_cents) FILTER (WHERE payment_status = 'PENDING'), 0)::text AS pending_cents,
            coalesce(sum(delivery_fee_cents) FILTER (WHERE payment_status = 'PAID'), 0)::text AS fees_cents
       FROM orders
      WHERE created_at >= now() - ($1 || ' days')::interval
      GROUP BY 1 ORDER BY 1 DESC`,
    [String(days)]
  );

  const byMethod = await query<{ method: string; status: string; count: string; total_cents: string }>(
    `SELECT method, status, count(*)::text AS count, coalesce(sum(amount_cents),0)::text AS total_cents
       FROM transactions GROUP BY 1,2 ORDER BY 1`
  );

  const topProducts = await query<{ name: string; units: string; revenue_cents: string }>(
    `SELECT oi.name, sum(oi.quantity)::text AS units, coalesce(sum(oi.line_total_cents),0)::text AS revenue_cents
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.payment_status = 'PAID'
      GROUP BY oi.name ORDER BY sum(oi.line_total_cents) DESC LIMIT 10`
  );

  const ledger = await query(
    `SELECT a.created_at, a.actor_role, a.action, a.resource, a.resource_id, a.metadata
       FROM audit_log a
      WHERE a.action LIKE 'payment.%' OR a.action LIKE 'order.%' OR a.action LIKE 'nevonpay.%'
      ORDER BY a.created_at DESC LIMIT 100`
  );

  return okJson({ days, summary, by_method: byMethod, top_products: topProducts, ledger });
}

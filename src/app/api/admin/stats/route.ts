import { query, queryOne } from "@/lib/db";
import { ADMIN_ONLY, guard } from "@/lib/guard";
import { okJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  const byStatus = await query<{ status: string; count: string; total: string }>(
    `SELECT status, count(*)::text AS count, coalesce(sum(total_cents), 0)::text AS total
       FROM orders GROUP BY status`
  );
  const byPayment = await query<{ payment_status: string; count: string; total: string }>(
    `SELECT payment_status, count(*)::text AS count, coalesce(sum(total_cents), 0)::text AS total
       FROM orders GROUP BY payment_status`
  );
  const revenue = await queryOne<{ paid_total: string; paid_orders: string; avg_ticket: string }>(
    `SELECT coalesce(sum(total_cents),0)::text AS paid_total,
            count(*)::text AS paid_orders,
            coalesce(round(avg(total_cents)),0)::text AS avg_ticket
       FROM orders WHERE payment_status = 'PAID'`
  );
  const daily = await query<{ day: string; orders: string; total: string }>(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            count(*)::text AS orders,
            coalesce(sum(total_cents),0)::text AS total
       FROM orders
      WHERE created_at >= now() - interval '14 days'
      GROUP BY 1 ORDER BY 1`
  );
  const couriers = await query<{
    id: string;
    name: string;
    email: string;
    phone: string | null;
    active: boolean;
    deliveries: string;
    delivered: string;
  }>(
    `SELECT u.id, u.name, u.email, u.phone, u.active,
            count(o.id)::text AS deliveries,
            count(o.id) FILTER (WHERE o.status = 'DELIVERED')::text AS delivered
       FROM users u
       LEFT JOIN orders o ON o.courier_id = u.id
      WHERE u.role = 'COURIER'
      GROUP BY u.id ORDER BY u.name`
  );
  const customers = await queryOne<{ total: string; active: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE created_at >= now() - interval '30 days')::text AS active
       FROM users WHERE role = 'CUSTOMER'`
  );
  const transactions = await query<{ status: string; count: string; total: string }>(
    `SELECT status, count(*)::text AS count, coalesce(sum(amount_cents),0)::text AS total
       FROM transactions GROUP BY status`
  );
  const unreadAdmin = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM notifications WHERE audience = 'ADMIN' AND read_at IS NULL`
  );

  return okJson({
    orders: { by_status: byStatus, by_payment: byPayment },
    revenue: revenue,
    daily,
    couriers,
    customers,
    transactions,
    unread_admin: Number(unreadAdmin?.count ?? 0),
  });
}

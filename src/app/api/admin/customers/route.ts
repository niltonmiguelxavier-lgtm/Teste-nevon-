import { query } from "@/lib/db";
import { ADMIN_ONLY, guard } from "@/lib/guard";
import { okJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Gestão de clientes: dados de contacto e histórico agregado (sem dados de cartão). */
export async function GET() {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  const customers = await query(
    `SELECT u.id, u.name, u.email, u.phone, u.active, u.created_at, u.last_login_at,
            count(o.id)::text AS orders,
            coalesce(sum(o.total_cents) FILTER (WHERE o.payment_status = 'PAID'), 0)::text AS spent_cents,
            max(o.created_at) AS last_order_at
       FROM users u
       LEFT JOIN orders o ON o.user_id = u.id
      WHERE u.role = 'CUSTOMER'
      GROUP BY u.id
      ORDER BY u.created_at DESC`
  );

  return okJson({ customers });
}

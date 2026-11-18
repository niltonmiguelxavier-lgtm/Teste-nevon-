import { query } from "@/lib/db";
import { ADMIN_ONLY, guard } from "@/lib/guard";
import { okJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  const notifications = await query(
    `SELECT n.id, n.type, n.title, n.body, n.read_at, n.created_at, o.reference AS order_reference
       FROM notifications n
       LEFT JOIN orders o ON o.id = n.order_id
      WHERE n.audience = 'ADMIN'
      ORDER BY n.created_at DESC LIMIT 60`
  );
  return okJson({ notifications });
}

export async function PATCH() {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;
  await query(`UPDATE notifications SET read_at = now() WHERE audience = 'ADMIN' AND read_at IS NULL`);
  return okJson({ all_read: true });
}

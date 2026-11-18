import { query } from "@/lib/db";
import { ADMIN_ONLY, guard } from "@/lib/guard";
import { okJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Histórico técnico da integração (chamadas, respostas, erros e webhooks). */
export async function GET(request: Request) {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limite") ?? 50), 1), 200);
  const onlyErrors = url.searchParams.get("erros") === "1";

  const events = await query(
    `SELECT id, kind, method, path, status_code, ok, duration_ms, request_ref, message, payload, created_at
       FROM provider_events
      ${onlyErrors ? "WHERE ok = false OR status_code >= 400" : ""}
      ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );

  const webhooks = await query(
    `SELECT id, event_id, signature_ok, processed, error, payload, received_at, processed_at
       FROM webhook_events ORDER BY received_at DESC LIMIT $1`,
    [limit]
  );

  const stats = await query<{ kind: string; count: string }>(
    `SELECT kind, count(*)::text AS count FROM provider_events
      WHERE created_at >= now() - interval '24 hours' GROUP BY kind`
  );

  return okJson({ events, webhooks, stats_24h: stats });
}

import { databaseHealth, hasDatabaseUrl } from "@/lib/db";
import { nevonConfig } from "@/lib/nevonpay";
import { errorJson, okJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Estado do serviço. Não expõe chaves: apenas indicadores booleanos e o
 * ambiente Nevon Pay derivado do prefixo da chave.
 */
export async function GET() {
  if (!hasDatabaseUrl()) {
    return errorJson("CONFIG_MISSING", "DATABASE_URL não está definida.", { status: 503 });
  }

  const db = await databaseHealth();
  const nevon = nevonConfig();

  const healthy = db.ok && (db as { tables?: number }).tables! >= 10;

  return okJson(
    {
      service: "express-delivery",
      status: healthy ? "healthy" : "degraded",
      database: db,
      nevonpay: {
        configured: Boolean(nevon.secretKey),
        environment: nevon.environment,
        base_url: nevon.baseUrl,
        key_kind: nevon.secretKey.startsWith("nv_live_")
          ? "live"
          : nevon.secretKey.startsWith("nv_test_")
            ? "test"
            : nevon.secretKey
              ? "unknown"
              : "absent",
        webhook_secret_configured: Boolean(nevon.webhookSecret),
      },
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 }
  );
}

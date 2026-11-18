import { randomBytes } from "node:crypto";
import { ADMIN_ONLY, guard } from "@/lib/guard";
import { errorJson, okJson } from "@/lib/http";
import { logProviderEvent } from "@/lib/orders";
import {
  clientFromEnv,
  nevonConfig,
  NevonError,
  redactSecret,
  sanitizePayload,
} from "@/lib/nevonpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Step = {
  id: string;
  label: string;
  status: "ok" | "error" | "warning" | "skipped";
  detail: string;
  httpStatus?: number;
  durationMs?: number;
  response?: unknown;
};

/**
 * Diagnóstico da integração Nevon Pay (exclusivo do administrador).
 *
 * Nunca devolve a chave secreta: só o ambiente, o host, o comprimento da chave
 * e o prefixo do tipo de chave (`nv_test_`/`nv_live_`).
 */
export async function GET(request: Request) {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const runTest = url.searchParams.get("teste") === "transacao";
  const environment = url.searchParams.get("ambiente") === "production" ? "PRODUCTION" : "SANDBOX";

  const config = nevonConfig();
  const client = clientFromEnv({ onEvent: logProviderEvent });
  const steps: Step[] = [];

  // 1) Configuração
  if (!config.secretKey) {
    steps.push({
      id: "config",
      label: "Configuração",
      status: "error",
      detail: "NEVONPAY_SECRET_KEY não está definida no servidor. Nenhuma chamada foi efectuada.",
    });
  } else if (!config.secretKey.startsWith("nv_")) {
    steps.push({
      id: "config",
      label: "Configuração",
      status: "warning",
      detail:
        "A chave não tem o prefixo documentado (nv_test_ / nv_live_). A API poderá recusá-la — veja o teste de autenticação.",
    });
  } else {
    steps.push({
      id: "config",
      label: "Configuração",
      status: "ok",
      detail: `Chave presente (${config.secretKey.slice(0, 8)}…, ${config.secretKey.length} caracteres). Host: ${config.baseUrl}`,
    });
  }

  // 2) Ligação ao host (health, endpoint público)
  const started = Date.now();
  try {
    const response = await fetch(`${config.baseUrl}/api/health`, {
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: "no-store",
    });
    const body = await response.text();
    steps.push({
      id: "connection",
      label: "Ligação ao servidor",
      status: response.ok ? "ok" : "error",
      httpStatus: response.status,
      durationMs: Date.now() - started,
      detail: response.ok
        ? `GET /api/health respondeu ${response.status} em ${Date.now() - started} ms.`
        : `GET /api/health respondeu ${response.status}.`,
      response: sanitizePayload(safeJson(body)),
    });
  } catch (error) {
    steps.push({
      id: "connection",
      label: "Ligação ao servidor",
      status: "error",
      durationMs: Date.now() - started,
      detail: redactSecret(error instanceof Error ? error.message : "Falha de rede", config.secretKey),
    });
  }

  // 3) Autenticação — pedido sem chave (deve devolver 401 MISSING_API_KEY)
  const authStarted = Date.now();
  try {
    const response = await fetch(`${config.baseUrl}/api/v1/payments?limit=1`, {
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: "no-store",
    });
    const body = safeJson(await response.text());
    const code = (body as { error?: { code?: string } } | null)?.error?.code;
    const behaviorDocumented = response.status === 401 && code === "MISSING_API_KEY";
    steps.push({
      id: "auth_required",
      label: "Autenticação exigida",
      status: behaviorDocumented ? "ok" : "warning",
      httpStatus: response.status,
      durationMs: Date.now() - authStarted,
      detail: behaviorDocumented
        ? "A API recusa pedidos sem chave com 401 MISSING_API_KEY (comportamento documentado)."
        : `Comportamento diferente do documentado: HTTP ${response.status}${code ? ` (${code})` : ""}.`,
      response: sanitizePayload(body),
    });
  } catch (error) {
    steps.push({
      id: "auth_required",
      label: "Autenticação exigida",
      status: "error",
      detail: error instanceof Error ? error.message : "Falha de rede",
    });
  }

  // 4) Autenticação com a chave secreta
  if (!config.secretKey) {
    steps.push({
      id: "auth_key",
      label: "Autenticação com a chave secreta",
      status: "skipped",
      detail: "Sem chave configurada.",
    });
  } else {
    const authKeyStarted = Date.now();
    try {
      const response = await fetch(`${config.baseUrl}/api/v1/payments?limit=1`, {
        headers: { Authorization: `Bearer ${config.secretKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(config.timeoutMs),
        cache: "no-store",
      });
      const body = safeJson(await response.text());
      await logProviderEvent({
        kind: response.ok ? "RESPONSE" : "ERROR",
        method: "GET",
        path: "/api/v1/payments",
        statusCode: response.status,
        ok: response.ok,
        durationMs: Date.now() - authKeyStarted,
        message: `Diagnóstico de autenticação — HTTP ${response.status}`,
        payload: sanitizePayload(body),
      });
      steps.push({
        id: "auth_key",
        label: "Autenticação com a chave secreta",
        status: response.ok ? "ok" : "error",
        httpStatus: response.status,
        durationMs: Date.now() - authKeyStarted,
        detail: response.ok
          ? "A chave foi aceite pela API. Resposta sem dados sensíveis."
          : `A chave foi recusada: HTTP ${response.status} ${
              (body as { error?: { code?: string } } | null)?.error?.code ?? ""
            }`.trim(),
        response: sanitizePayload(body),
      });
    } catch (error) {
      steps.push({
        id: "auth_key",
        label: "Autenticação com a chave secreta",
        status: "error",
        detail: error instanceof Error ? redactSecret(error.message, config.secretKey) : "Falha de rede",
      });
    }
  }

  // 5) Registo de transacção de teste (opcional, exige parâmetro explícito)
  if (runTest) {
    if (!config.secretKey) {
      steps.push({
        id: "create_transaction",
        label: "Criar transacção de teste",
        status: "skipped",
        detail: "Sem chave configurada.",
      });
    } else {
      const reference = `TEST_${Date.now()}_${randomBytes(3).toString("hex")}`;
      const startedCreate = Date.now();
      try {
        const payment = await client.createPayment({
          amount: 10,
          currency: "MZN",
          method: "SANDBOX",
          reference,
          idempotencyKey: `diag_${reference}`,
          metadata: { origin: "admin-diagnostics" },
          requestRef: reference,
        });
        steps.push({
          id: "create_transaction",
          label: "Criar transacção de teste",
          status: "ok",
          durationMs: Date.now() - startedCreate,
          detail: `Pagamento de teste criado: ${payment.id} · estado ${payment.status} · ${payment.amount} ${payment.currency}`,
          response: sanitizePayload(payment),
        });

        // 6) Consultar a transacção criada (mesma fonte usada na confirmação)
        try {
          const fetched = await client.getPayment(payment.id, reference);
          steps.push({
            id: "fetch_transaction",
            label: "Consultar transacção",
            status: "ok",
            detail: `GET /api/v1/payments/${payment.id} → estado ${fetched.status}`,
            response: sanitizePayload(fetched),
          });
        } catch (error) {
          const e = error instanceof NevonError ? error : null;
          steps.push({
            id: "fetch_transaction",
            label: "Consultar transacção",
            status: "error",
            httpStatus: e?.status,
            detail: e?.message ?? "Falha ao consultar a transacção.",
            response: sanitizePayload(e?.responseBody),
          });
        }
      } catch (error) {
        const e = error instanceof NevonError ? error : null;
        steps.push({
          id: "create_transaction",
          label: "Criar transacção de teste",
          status: "error",
          httpStatus: e?.status,
          durationMs: Date.now() - startedCreate,
          detail: e?.message ?? "Falha ao criar a transacção.",
          response: sanitizePayload(e?.responseBody),
        });
      }
    }
  }

  return okJson({
    environment: {
      // `ambiente` indicado pelo cliente é apenas o pretendido; o efectivo vem
      // sempre do prefixo da chave no servidor.
      configured: config.environment,
      requested: environment,
      base_url: config.baseUrl,
      key_present: Boolean(config.secretKey),
      key_kind: config.secretKey.startsWith("nv_live_")
        ? "nv_live_ (produção)"
        : config.secretKey.startsWith("nv_test_")
          ? "nv_test_ (teste)"
          : config.secretKey
            ? "prefixo não documentado"
            : "ausente",
      key_length: config.secretKey.length,
      key_preview: config.secretKey ? `${config.secretKey.slice(0, 8)}…` : null,
      webhook_secret_configured: Boolean(config.webhookSecret),
      timeout_ms: config.timeoutMs,
      documented_endpoints: [
        "POST /api/v1/payments",
        "GET /api/v1/payments",
        "GET /api/v1/payments/{id ou referência}",
        "POST /api/v1/checkout/session",
        "GET /api/v1/checkout/session/{id}",
        "POST /api/v1/checkout/session/{id}/cancel",
      ],
      documented_methods: ["sandbox", "mpesa", "emola"],
      webhook_documented: false,
    },
    steps,
    checked_at: new Date().toISOString(),
    checked_by: { id: auth.user.id, email: auth.user.email },
  });
}

function safeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}

/** Registos recentes de integração (chamadas, erros, webhooks) — sem segredos. */
export async function POST(request: Request) {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "clear_events") {
    return errorJson("INVALID_ACTION", "Acção inválida.", { status: 400 });
  }
  return okJson({ cleared: false, message: "Os registos de integração são mantidos para auditoria." });
}

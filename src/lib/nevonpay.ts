/**
 * Cliente Nevon Pay — ambiente SANDBOX.
 *
 * Fontes (documentação oficial do repositório Nevon-pay-):
 *  - README.md § "API pública (/api/v1)":
 *      autenticação por chave de API (`Authorization: Bearer nv_test_…` ou `x-api-key`)
 *      POST /api/v1/payments                 cria pagamento (aceita Idempotency-Key)
 *      GET  /api/v1/payments                 lista pagamentos do comerciante
 *      GET  /api/v1/payments/{id ou referência}  consulta um pagamento
 *      POST /api/v1/checkout/session         cria sessão de checkout (checkout_url)
 *      GET  /api/v1/checkout/session/{id}    consulta pública da sessão
 *      POST /api/v1/checkout/session/{id}/cancel  cancela a sessão
 *    Provedores: apenas `sandbox` (não liquida dinheiro); `mpesa` e `emola`
 *    respondem 503 PROVIDER_NOT_CONFIGURED.
 *  - lib/api/errors.ts: erros em `{ success:false, error:{ code, message } }`.
 *  - Chaves `nv_live_` não podem usar o sandbox — validado no servidor.
 *
 * Regras aplicadas aqui:
 *  - A chave secreta nunca sai do servidor (esta camada só é importada em
 *    route handlers do Next.js, nunca em componentes cliente).
 *  - Nenhum pagamento é considerado aprovado sem resposta autenticada da API
 *    (GET do pagamento) ou webhook com assinatura verificada.
 *  - Não existe endpoint de webhooks na documentação: o segredo de webhook é
 *    opcional e a verificação só é feita se NEVONPAY_WEBHOOK_SECRET existir.
 */

export type NevonEnvironment = "SANDBOX" | "PRODUCTION";

export type NevonMethod = "SANDBOX" | "MPESA" | "EMOLA";

export type NevonPaymentStatus =
  | "OPEN"
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export type NevonConfig = {
  baseUrl: string;
  secretKey: string;
  environment: NevonEnvironment;
  webhookSecret: string | null;
  timeoutMs: number;
};

const DEFAULT_BASE_URL = "https://nevon-pay.vercel.app";

/** Configuração lida apenas no servidor. */
export function nevonConfig(): NevonConfig {
  const secretKey = process.env.NEVONPAY_SECRET_KEY?.trim() ?? "";
  const baseUrl = (process.env.NEVONPAY_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const webhookSecret = process.env.NEVONPAY_WEBHOOK_SECRET?.trim() || null;
  const timeoutMs = Number(process.env.NEVONPAY_TIMEOUT_MS || 15000);

  // O ambiente é derivado do prefixo da chave — a própria API recusa chaves
  // `nv_live_` no sandbox, por isso nunca assumimos produção sem essa marca.
  const environment: NevonEnvironment = secretKey.startsWith("nv_live_") ? "PRODUCTION" : "SANDBOX";

  return { baseUrl, secretKey, environment, webhookSecret, timeoutMs };
}

export type NevonErrorKind =
  | "NOT_CONFIGURED"
  | "NETWORK"
  | "UNAUTHORIZED"
  | "VALIDATION"
  | "PROVIDER_NOT_CONFIGURED"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVER"
  | "UNKNOWN";

export class NevonError extends Error {
  kind: NevonErrorKind;
  status: number;
  code: string;
  details?: unknown;
  responseBody?: unknown;

  constructor(input: {
    kind: NevonErrorKind;
    status: number;
    code: string;
    message: string;
    details?: unknown;
    responseBody?: unknown;
  }) {
    super(input.message);
    this.name = "NevonError";
    this.kind = input.kind;
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
    this.responseBody = input.responseBody;
  }

  /** Mensagem segura para mostrar ao cliente final (sem detalhes internos). */
  get publicMessage(): string {
    switch (this.kind) {
      case "NOT_CONFIGURED":
        return "O pagamento online não está configurado neste ambiente. Contacte o suporte.";
      case "NETWORK":
        return "Não foi possível contactar a Nevon Pay. Tente novamente em instantes.";
      case "UNAUTHORIZED":
        return "A Nevon Pay recusou as credenciais do servidor. O pagamento não foi criado.";
      case "VALIDATION":
        return "A Nevon Pay recusou os dados do pagamento.";
      case "PROVIDER_NOT_CONFIGURED":
        return "Este método de pagamento ainda não está disponível na Nevon Pay (sandbox).";
      case "CONFLICT":
        return "Já existe um pagamento para este pedido.";
      case "RATE_LIMITED":
        return "Demasiados pedidos à Nevon Pay. Aguarde alguns segundos.";
      default:
        return "A Nevon Pay devolveu um erro inesperado. O pagamento não foi confirmado.";
    }
  }
}

type CallResult<T> = {
  ok: boolean;
  status: number;
  body: T | null;
  raw: string;
  durationMs: number;
  path: string;
};

export type NevonPayment = {
  id: string;
  reference: string;
  amount: string | number;
  currency: string;
  status: NevonPaymentStatus;
  provider?: string | null;
  providerRef?: string | null;
  createdAt?: string;
  updatedAt?: string;
  session?: {
    id: string;
    status: string;
    expiresAt: string;
    successUrl?: string | null;
    cancelUrl?: string | null;
  } | null;
};

export type NevonCheckoutSession = {
  id: string;
  status: string;
  amount: string | number;
  currency: string;
  expiresAt: string;
  cancelToken?: string | null;
  successUrl?: string | null;
  cancelUrl?: string | null;
  payment?: { reference: string; status: string; provider?: string | null };
};

function classify(status: number, code?: string): NevonErrorKind {
  if (code === "PROVIDER_NOT_CONFIGURED") return "PROVIDER_NOT_CONFIGURED";
  if (status === 401 || status === 403 || code === "INVALID_API_KEY" || code === "MISSING_API_KEY") return "UNAUTHORIZED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 409) return "CONFLICT";
  if (status === 400 || status === 422) return "VALIDATION";
  if (status >= 500) return "SERVER";
  return "UNKNOWN";
}

/** Remove qualquer vestígio da chave secreta antes de guardar/mostrar dados. */
export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("«NEVONPAY_SECRET_KEY»");
}

export class NevonPayClient {
  private config: NevonConfig;
  private onEvent?: (event: {
    kind: "REQUEST" | "RESPONSE" | "ERROR";
    method: string;
    path: string;
    statusCode?: number;
    ok?: boolean;
    durationMs?: number;
    requestRef?: string | null;
    message?: string;
    payload?: unknown;
  }) => void | Promise<void>;

  constructor(config: NevonConfig, hooks?: { onEvent?: NevonPayClient["onEvent"] }) {
    this.config = config;
    this.onEvent = hooks?.onEvent;
  }

  get environment() {
    return this.config.environment;
  }

  get configured() {
    return Boolean(this.config.secretKey) && this.config.secretKey.startsWith("nv_");
  }

  private async call<T>(
    method: "GET" | "POST",
    path: string,
    options?: { body?: unknown; idempotencyKey?: string; requestRef?: string | null; auth?: "key" | "none" }
  ): Promise<CallResult<T>> {
    if (!this.config.secretKey && options?.auth !== "none") {
      throw new NevonError({
        kind: "NOT_CONFIGURED",
        status: 503,
        code: "NEVONPAY_NOT_CONFIGURED",
        message: "NEVONPAY_SECRET_KEY não está definida no servidor.",
      });
    }

    const url = `${this.config.baseUrl}${path}`;
    const started = Date.now();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options?.auth !== "none") headers.Authorization = `Bearer ${this.config.secretKey}`;
    if (options?.body !== undefined) headers["Content-Type"] = "application/json";
    if (options?.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

    await this.onEvent?.({
      kind: "REQUEST",
      method,
      path,
      requestRef: options?.requestRef ?? null,
      message: `${method} ${path}`,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options?.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      const durationMs = Date.now() - started;
      const message = error instanceof Error ? error.message : "Falha de rede";
      await this.onEvent?.({
        kind: "ERROR",
        method,
        path,
        ok: false,
        durationMs,
        requestRef: options?.requestRef ?? null,
        message: redactSecret(message, this.config.secretKey),
      });
      throw new NevonError({
        kind: "NETWORK",
        status: 502,
        code: "NETWORK_ERROR",
        message: `Falha ao contactar ${this.config.baseUrl}${path}: ${message}`,
      });
    }

    const raw = await response.text();
    const durationMs = Date.now() - started;
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
    }

    const safePayload = sanitizePayload(body);
    const errorCode =
      typeof body === "object" && body !== null
        ? ((body as { error?: { code?: string } }).error?.code ?? undefined)
        : undefined;

    await this.onEvent?.({
      kind: response.ok ? "RESPONSE" : "ERROR",
      method,
      path,
      statusCode: response.status,
      ok: response.ok,
      durationMs,
      requestRef: options?.requestRef ?? null,
      message:
        response.ok
          ? `${response.status} em ${durationMs} ms`
          : `${response.status} ${errorCode ?? ""} em ${durationMs} ms`.trim(),
      payload: safePayload,
    });

    if (!response.ok) {
      const apiMessage =
        (typeof body === "object" && body !== null
          ? ((body as { error?: { message?: string } }).error?.message ?? undefined)
          : undefined) ?? `A Nevon Pay respondeu ${response.status}.`;
      throw new NevonError({
        kind: classify(response.status, errorCode),
        status: response.status,
        code: errorCode ?? `HTTP_${response.status}`,
        message: redactSecret(apiMessage, this.config.secretKey),
        responseBody: safePayload,
      });
    }

    return { ok: true, status: response.status, body: body as T, raw, durationMs, path };
  }

  /** Cria um pagamento. Idempotente quando `idempotencyKey` é enviada. */
  async createPayment(input: {
    amount: number;
    currency: string;
    method: NevonMethod;
    reference: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
    requestRef?: string | null;
  }): Promise<NevonPayment> {
    if (this.config.environment === "PRODUCTION" && input.method === "SANDBOX") {
      throw new NevonError({
        kind: "PROVIDER_NOT_CONFIGURED",
        status: 400,
        code: "SANDBOX_METHOD_WITH_LIVE_KEY",
        message: "O método sandbox não pode ser usado com uma chave de produção.",
      });
    }

    const result = await this.call<{ success: boolean; payment: NevonPayment; idempotent_replay?: boolean }>(
      "POST",
      "/api/v1/payments",
      {
        idempotencyKey: input.idempotencyKey,
        requestRef: input.requestRef ?? input.reference,
        body: {
          amount: input.amount,
          currency: input.currency,
          provider: input.method.toLowerCase(),
          reference: input.reference,
          metadata: input.metadata,
        },
      }
    );

    const payment = result.body?.payment;
    if (!payment?.id) {
      throw new NevonError({
        kind: "SERVER",
        status: 502,
        code: "MALFORMED_RESPONSE",
        message: "A Nevon Pay não devolveu um pagamento válido.",
        responseBody: sanitizePayload(result.body),
      });
    }
    return payment;
  }

  /** Consulta o estado de um pagamento (fonte de verdade da confirmação). */
  async getPayment(paymentIdOrReference: string, requestRef?: string | null): Promise<NevonPayment> {
    const result = await this.call<{ success: boolean; payment: NevonPayment }>(
      "GET",
      `/api/v1/payments/${encodeURIComponent(paymentIdOrReference)}`,
      { requestRef: requestRef ?? paymentIdOrReference }
    );
    const payment = result.body?.payment;
    if (!payment?.id) {
      throw new NevonError({
        kind: "SERVER",
        status: 502,
        code: "MALFORMED_RESPONSE",
        message: "Resposta inválida ao consultar o pagamento.",
        responseBody: sanitizePayload(result.body),
      });
    }
    return payment;
  }

  /** Cria uma sessão de checkout e devolve o `checkout_url`. */
  async createCheckoutSession(input: {
    amount: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
    customer: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    expiresInMinutes?: number;
    requestRef?: string | null;
  }): Promise<{ session: NevonCheckoutSession; checkoutUrl: string }> {
    const result = await this.call<{
      success: boolean;
      session: NevonCheckoutSession;
      checkout_url: string;
      payment_reference: string;
    }>("POST", "/api/v1/checkout/session", {
      requestRef: input.requestRef ?? null,
      body: {
        amount: input.amount,
        currency: input.currency,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        customer: input.customer,
        metadata: input.metadata,
        ...(input.expiresInMinutes ? { expiresInMinutes: input.expiresInMinutes } : {}),
      },
    });

    const session = result.body?.session;
    const checkoutUrl = result.body?.checkout_url;
    if (!session?.id || !checkoutUrl) {
      throw new NevonError({
        kind: "SERVER",
        status: 502,
        code: "MALFORMED_RESPONSE",
        message: "A Nevon Pay não devolveu uma sessão de checkout válida.",
        responseBody: sanitizePayload(result.body),
      });
    }
    return { session, checkoutUrl };
  }

  async getCheckoutSession(sessionId: string): Promise<NevonCheckoutSession> {
    const result = await this.call<{ success: boolean; session: NevonCheckoutSession }>(
      "GET",
      `/api/v1/checkout/session/${encodeURIComponent(sessionId)}`
    );
    if (!result.body?.session?.id) {
      throw new NevonError({
        kind: "SERVER",
        status: 502,
        code: "MALFORMED_RESPONSE",
        message: "Resposta inválida ao consultar a sessão de checkout.",
        responseBody: sanitizePayload(result.body),
      });
    }
    return result.body.session;
  }

  async cancelCheckoutSession(sessionId: string): Promise<void> {
    await this.call("POST", `/api/v1/checkout/session/${encodeURIComponent(sessionId)}/cancel`);
  }

  /**
   * Verificação de webhook.
   *
   * A documentação pública da Nevon Pay **não descreve** um endpoint nem um
   * esquema de assinatura para webhooks. Por isso:
   *  - se NEVONPAY_WEBHOOK_SECRET estiver definido, aceitamos os formatos
   *    HMAC-SHA256 habituais (`X-Nevonpay-Signature` / `X-Signature` em hex ou
   *    `sha256=<hex>`), calculados sobre o corpo cru;
   *  - se não estiver definido, o webhook é registado mas NUNCA confirma o
   *    pagamento por si só — a confirmação exige sempre uma consulta
   *    autenticada à API (GET /api/v1/payments/{id}).
   */
  verifyWebhook(rawBody: string, headerValue: string | null): { verified: boolean; reason: string } {
    if (!this.config.webhookSecret) {
      return {
        verified: false,
        reason:
          "NEVONPAY_WEBHOOK_SECRET não configurado — webhook registado, mas a confirmação exige consulta autenticada à API.",
      };
    }
    if (!headerValue) {
      return { verified: false, reason: "Cabeçalho de assinatura ausente." };
    }
    const provided = headerValue.startsWith("sha256=") ? headerValue.slice(7) : headerValue;
    const expected = createHmac("sha256", this.config.webhookSecret).update(rawBody).digest("hex");
    const ok = timingSafeEqualHex(provided, expected);
    return {
      verified: ok,
      reason: ok ? "Assinatura HMAC-SHA256 válida." : "Assinatura HMAC-SHA256 inválida.",
    };
  }
}

/* ------------------------------------------------------------------ */
/* Utilitários                                                         */
/* ------------------------------------------------------------------ */

import { createHmac, timingSafeEqual } from "node:crypto";

function timingSafeEqualHex(a: string, b: string) {
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

const SENSITIVE_KEYS = /(secret|password|card|cvv|pan|token|authorization|api[_-]?key)/i;

/** Remove dados sensíveis antes de guardar respostas da API para diagnóstico. */
export function sanitizePayload(input: unknown, depth = 0): unknown {
  if (input === null || input === undefined) return null;
  if (depth > 6) return "«truncado»";
  if (Array.isArray(input)) return input.slice(0, 50).map((item) => sanitizePayload(item, depth + 1));
  if (typeof input === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(key)) {
        output[key] = "«removido»";
      } else if (typeof value === "string" && value.length > 800) {
        output[key] = `${value.slice(0, 800)}…`;
      } else {
        output[key] = sanitizePayload(value, depth + 1);
      }
    }
    return output;
  }
  return input;
}

/** Estados Nevon Pay que podem ser considerados pagamento confirmado. */
export function isPaidStatus(status: string | null | undefined) {
  return status === "COMPLETED";
}

export function clientFromEnv(hooks?: { onEvent?: NevonPayClient["onEvent"] }) {
  return new NevonPayClient(nevonConfig(), hooks);
}

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";

/** Utilitários de resposta JSON consistentes para os route handlers. */

export function requestId(request?: Request) {
  return request?.headers.get("x-request-id")?.slice(0, 64) || randomUUID();
}

export function okJson<T>(data: T, init?: { status?: number; requestId?: string }) {
  return NextResponse.json(
    { success: true, data },
    {
      status: init?.status ?? 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-ID": init?.requestId ?? randomUUID(),
      },
    }
  );
}

export function errorJson(
  code: string,
  message: string,
  init?: { status?: number; requestId?: string; details?: unknown }
) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        ...(init?.details === undefined ? {} : { details: init.details }),
      },
    },
    {
      status: init?.status ?? 400,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-ID": init?.requestId ?? randomUUID(),
      },
    }
  );
}

export async function parseBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ZodError([
      { code: "custom", path: [], message: "O corpo do pedido deve ser JSON válido." },
    ]);
  }
  return schema.parse(raw);
}

export function validationError(error: ZodError) {
  return errorJson("VALIDATION_ERROR", "Os dados enviados não são válidos.", {
    status: 400,
    details: error.issues.map((issue) => ({
      field: issue.path.join(".") || "(raiz)",
      problem: issue.message,
    })),
  });
}

/** Limitador simples em memória — protege contra abuso básico por instância. */
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, max = 20, windowSeconds = 60) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowSeconds * 1000 });
    return { allowed: true, remaining: max - 1, retryAfter: 0 };
  }
  current.count += 1;
  if (buckets.size > 5000) buckets.clear();
  return {
    allowed: current.count <= max,
    remaining: Math.max(0, max - current.count),
    retryAfter: Math.max(1, Math.ceil((current.reset - now) / 1000)),
  };
}

export function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

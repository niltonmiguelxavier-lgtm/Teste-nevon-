import { ZodError } from "zod";
import { query, queryOne } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/orders";
import { clientIp, errorJson, okJson, rateLimit, validationError } from "@/lib/http";
import { registerSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limit = rateLimit(`register:${clientIp(request)}`, 10, 300);
  if (!limit.allowed) {
    return errorJson("RATE_LIMITED", "Demasiadas tentativas. Tente novamente mais tarde.", {
      status: 429,
    });
  }

  try {
    const input = registerSchema.parse(await request.json());

    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = lower($1)`,
      [input.email]
    );
    if (existing) {
      return errorJson("EMAIL_IN_USE", "Já existe uma conta com este email.", { status: 409 });
    }

    const passwordHash = await hashPassword(input.password);
    const user = await queryOne<{ id: string; name: string; email: string; role: string }>(
      `INSERT INTO users (name, email, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, 'CUSTOMER')
       RETURNING id, name, email, role`,
      [input.name, input.email, input.phone.replace(/[\s-]/g, ""), passwordHash]
    );

    await createSession(user!.id);
    await audit({
      actorId: user!.id,
      actorRole: "CUSTOMER",
      action: "auth.register",
      resource: "users",
      resourceId: user!.id,
      ip: clientIp(request),
    });

    return okJson({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    console.error("[register]", error);
    return errorJson("INTERNAL_ERROR", "Não foi possível criar a conta.", { status: 500 });
  }
}

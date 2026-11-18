import { ZodError } from "zod";
import { query, queryOne } from "@/lib/db";
import { createSession, hashPassword, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/orders";
import { clientIp, errorJson, okJson, rateLimit, validationError } from "@/lib/http";
import { loginSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limit = rateLimit(`login:${ip}`, 20, 300);
  if (!limit.allowed) {
    return errorJson("RATE_LIMITED", "Demasiadas tentativas de início de sessão. Aguarde e tente novamente.", {
      status: 429,
    });
  }

  try {
    const input = loginSchema.parse(await request.json());

    const user = await queryOne<{
      id: string;
      name: string;
      email: string;
      role: string;
      active: boolean;
      password_hash: string;
    }>(`SELECT id, name, email, role, active, password_hash FROM users WHERE lower(email) = lower($1)`, [
      input.email,
    ]);

    // Mensagem genérica: não revela se o email existe.
    const invalid = errorJson("INVALID_CREDENTIALS", "Email ou palavra-passe incorretos.", {
      status: 401,
    });

    if (!user) {
      // Comparação "dummy" para manter o tempo de resposta constante.
      await hashPassword(input.password);
      return invalid;
    }
    if (!user.active) {
      return errorJson("ACCOUNT_DISABLED", "Esta conta está desactivada. Contacte o suporte.", {
        status: 403,
      });
    }

    const valid = await verifyPassword(input.password, user.password_hash);
    if (!valid) return invalid;

    await createSession(user.id);
    await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "auth.login",
      resource: "users",
      resourceId: user.id,
      ip,
    });

    return okJson({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      redirect:
        user.role === "ADMIN" ? "/admin" : user.role === "COURIER" ? "/entregador" : "/conta",
    });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    console.error("[login]", error);
    return errorJson("INTERNAL_ERROR", "Não foi possível iniciar sessão.", { status: 500 });
  }
}

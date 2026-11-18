import { ZodError } from "zod";
import { query, queryOne } from "@/lib/db";
import { ADMIN_ONLY, guard } from "@/lib/guard";
import { errorJson, okJson, validationError } from "@/lib/http";
import { audit } from "@/lib/orders";
import { hashPassword } from "@/lib/auth";
import { courierCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  const couriers = await query(
    `SELECT id, name, email, phone, active, created_at, last_login_at
       FROM users WHERE role = 'COURIER' ORDER BY name`
  );
  return okJson({ couriers });
}

export async function POST(request: Request) {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  try {
    const input = courierCreateSchema.parse(await request.json());
    const existing = await queryOne(`SELECT id FROM users WHERE lower(email) = lower($1)`, [input.email]);
    if (existing) return errorJson("EMAIL_IN_USE", "Já existe uma conta com este email.", { status: 409 });

    const courier = await queryOne(
      `INSERT INTO users (name, email, phone, password_hash, role)
       VALUES ($1,$2,$3,$4,'COURIER') RETURNING id, name, email, phone, role, active`,
      [input.name, input.email, input.phone.replace(/[\s-]/g, ""), await hashPassword(input.password)]
    );

    await audit({
      actorId: auth.user.id,
      actorRole: "ADMIN",
      action: "courier.created",
      resource: "users",
      resourceId: String((courier as { id?: string })?.id ?? ""),
    });

    return okJson({ courier }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    console.error("[admin.couriers.create]", error);
    return errorJson("INTERNAL_ERROR", "Não foi possível criar o entregador.", { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as { id?: string; active?: boolean; password?: string };
    if (!body.id) return errorJson("VALIDATION_ERROR", "Indique o entregador.", { status: 400 });

    const target = await queryOne<{ id: string; role: string }>(`SELECT id, role FROM users WHERE id = $1`, [
      body.id,
    ]);
    if (!target || target.role !== "COURIER") {
      return errorJson("NOT_FOUND", "Entregador não encontrado.", { status: 404 });
    }

    if (typeof body.active === "boolean") {
      await query(`UPDATE users SET active = $2, updated_at = now() WHERE id = $1`, [body.id, body.active]);
    }
    if (body.password) {
      if (body.password.length < 8) {
        return errorJson("VALIDATION_ERROR", "A palavra-passe deve ter pelo menos 8 caracteres.", {
          status: 400,
        });
      }
      await query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [
        body.id,
        await hashPassword(body.password),
      ]);
    }
    // Revoga sessões activas quando a conta é desactivada
    if (body.active === false) {
      await query(`DELETE FROM sessions WHERE user_id = $1`, [body.id]);
    }

    await audit({
      actorId: auth.user.id,
      actorRole: "ADMIN",
      action: "courier.updated",
      resource: "users",
      resourceId: body.id,
      metadata: { active: body.active, password_reset: Boolean(body.password) },
    });

    return okJson({ updated: true });
  } catch (error) {
    console.error("[admin.couriers.update]", error);
    return errorJson("INTERNAL_ERROR", "Não foi possível actualizar o entregador.", { status: 500 });
  }
}

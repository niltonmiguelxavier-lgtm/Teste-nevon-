import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { query, queryOne } from "./db";

export type Role = "CUSTOMER" | "COURIER" | "ADMIN";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  active: boolean;
};

const COOKIE_NAME = "express_session";
const SESSION_TTL_DAYS = 14;

function hashToken(token: string) {
  // O cookie contém um token aleatório; na base de dados só fica o hash.
  const secret = process.env.SESSION_SECRET || "express-delivery-dev-secret";
  return createHash("sha256").update(`${token}.${secret}`).digest("hex");
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const sessionId = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  let userAgent: string | null = null;
  let ip: string | null = null;
  try {
    const hdrs = await headers();
    userAgent = hdrs.get("user-agent");
    ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip");
  } catch {
    /* fora de um request context (testes) */
  }

  await query(
    `INSERT INTO sessions (id, user_id, user_agent, ip, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, userId, userAgent, ip, expiresAt]
  );

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return { sessionId, expiresAt };
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    await query(`DELETE FROM sessions WHERE id = $1`, [hashToken(token)]);
  }
  store.delete(COOKIE_NAME);
}

/** Devolve o utilizador autenticado (ou null) a partir do cookie de sessão. */
export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const row = await queryOne<SessionUser & { expires_at: Date }>(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.active, s.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.expires_at > now()`,
      [hashToken(token)]
    );
    if (!row || !row.active) return null;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      active: row.active,
    };
  } catch {
    return null;
  }
}

export async function requireRole(roles: Role[]): Promise<SessionUser | null> {
  const user = await currentUser();
  if (!user) return null;
  return roles.includes(user.role) ? user : null;
}

/** Comparação em tempo constante para tokens opacos (webhooks, etc.). */
export function safeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

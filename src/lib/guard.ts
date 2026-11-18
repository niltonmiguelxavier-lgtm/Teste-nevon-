import "server-only";

import { currentUser, type Role, type SessionUser } from "./auth";
import { errorJson } from "./http";

type GuardOk = { ok: true; user: SessionUser };
type GuardFail = { ok: false; response: ReturnType<typeof errorJson> };

/** Controlo de permissões por função em todas as rotas privadas. */
export async function guard(roles: Role[]): Promise<GuardOk | GuardFail> {
  const user = await currentUser();
  if (!user) {
    return {
      ok: false,
      response: errorJson("UNAUTHENTICATED", "Sessão inválida ou expirada. Inicie sessão novamente.", {
        status: 401,
      }),
    };
  }
  if (!roles.includes(user.role)) {
    return {
      ok: false,
      response: errorJson("FORBIDDEN", "Não tem permissões para esta operação.", { status: 403 }),
    };
  }
  return { ok: true, user };
}

export const ADMIN_ONLY: Role[] = ["ADMIN"];
export const STAFF: Role[] = ["ADMIN", "COURIER"];

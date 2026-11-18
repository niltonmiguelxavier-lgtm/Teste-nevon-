import { currentUser, destroySession } from "@/lib/auth";
import { audit } from "@/lib/orders";
import { errorJson, okJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    await destroySession();
    if (user) {
      await audit({
        actorId: user.id,
        actorRole: user.role,
        action: "auth.logout",
        resource: "users",
        resourceId: user.id,
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      });
    }
    return okJson({ loggedOut: true });
  } catch (error) {
    console.error("[logout]", error);
    return errorJson("INTERNAL_ERROR", "Não foi possível terminar a sessão.", { status: 500 });
  }
}

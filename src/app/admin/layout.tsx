import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { AdminNav } from "@/components/admin-nav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Administração",
  robots: { index: false, follow: false },
};

/**
 * O painel administrativo não é público: exige sessão com função ADMIN.
 * Não está ligado em nenhuma página pública nem em sitemap.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/entrar?next=/admin");
  if (user.role !== "ADMIN") redirect(user.role === "COURIER" ? "/entregador" : "/conta");

  const unread = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM notifications WHERE audience = 'ADMIN' AND read_at IS NULL`
  );

  return (
    <div className="dash">
      <AdminNav user={user} badge={Number(unread?.count ?? 0)} />
      <div className="dash__main">{children}</div>
    </div>
  );
}

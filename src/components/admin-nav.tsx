"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { SessionUser } from "@/lib/auth";

const SECTIONS: Array<{ group: string; links: Array<{ href: string; label: string }> }> = [
  {
    group: "Operação",
    links: [
      { href: "/admin", label: "Visão geral" },
      { href: "/admin/pedidos", label: "Pedidos" },
      { href: "/admin/transaccoes", label: "Transacções" },
    ],
  },
  {
    group: "Gestão",
    links: [
      { href: "/admin/produtos", label: "Produtos" },
      { href: "/admin/clientes", label: "Clientes" },
      { href: "/admin/entregadores", label: "Entregadores" },
    ],
  },
  {
    group: "Sistema",
    links: [
      { href: "/admin/relatorios", label: "Relatórios" },
      { href: "/admin/nevonpay", label: "Testes Nevon Pay" },
    ],
  },
];

export function AdminNav({ user, badge }: { user: SessionUser; badge: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <aside className="dash__side">
      <div style={{ padding: "0 12px 6px" }}>
        <strong style={{ fontSize: "0.92rem" }}>{user.name}</strong>
        <div className="small muted">Administrador</div>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.group}>
          <h4>{section.group}</h4>
          <nav>
            {section.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
              >
                {link.label}
                {link.href === "/admin" && badge > 0 ? (
                  <span className="nav__badge">{badge}</span>
                ) : null}
              </Link>
            ))}
          </nav>
        </div>
      ))}

      <div style={{ marginTop: 18, padding: "0 12px" }}>
        <button
          className="btn btn--ghost btn--sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await fetch("/api/auth/logout", { method: "POST" });
            router.push("/");
            router.refresh();
          }}
        >
          {busy ? "A sair…" : "Terminar sessão"}
        </button>
      </div>
    </aside>
  );
}

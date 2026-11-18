"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { SessionUser } from "@/lib/auth";

type Props = {
  user: SessionUser | null;
  cartCount: number;
};

const NAV = [
  { href: "/produtos", label: "Produtos" },
  { href: "/como-funciona", label: "Como funciona" },
  { href: "/contactos", label: "Contactos" },
  { href: "/acompanhar", label: "Acompanhar pedido" },
];

export function SiteHeader({ user, cartCount }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Os painéis privados usam a sua própria navegação.
  const isPanel =
    pathname.startsWith("/admin") || pathname.startsWith("/entregador") || pathname.startsWith("/checkout");

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (isPanel) {
    return (
      <header className="nav">
        <div className="container nav__inner">
          <Link href="/" className="brand" aria-label="Express Delivery — página inicial">
            <span className="brand__mark">
              E<span>D</span>
            </span>
            <span>
              Express Delivery
              <small>Maputo · Matola</small>
            </span>
          </Link>
          <div className="nav__actions">
            <Link href="/" className="btn btn--ghost btn--sm">
              Voltar ao site
            </Link>
            {user ? (
              <button className="btn btn--ghost btn--sm" onClick={logout} disabled={busy}>
                {busy ? "A sair…" : "Terminar sessão"}
              </button>
            ) : null}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className={`nav${open ? " nav--open" : ""}`}>
      <div className="container nav__inner">
        <Link href="/" className="brand" aria-label="Express Delivery — página inicial">
          <span className="brand__mark">
            E<span>D</span>
          </span>
          <span>
            Express Delivery
            <small>Maputo · Matola</small>
          </span>
        </Link>

        <nav className="nav__links" aria-label="Navegação principal">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="nav__actions">
          <Link href="/carrinho" className="btn btn--ghost btn--sm nav__cart" aria-label="Carrinho">
            Carrinho
            {cartCount > 0 ? <span className="nav__badge">{cartCount}</span> : null}
          </Link>
          {user ? (
            <>
              <Link
                href={user.role === "ADMIN" ? "/admin" : user.role === "COURIER" ? "/entregador" : "/conta"}
                className="btn btn--sm"
              >
                {user.role === "CUSTOMER" ? "A minha conta" : user.name.split(" ")[0]}
              </Link>
              <button className="btn btn--ghost btn--sm" onClick={logout} disabled={busy}>
                Sair
              </button>
            </>
          ) : (
            <>
              <Link href="/entrar" className="btn btn--ghost btn--sm">
                Entrar
              </Link>
              <Link href="/entrar?modo=registo" className="btn btn--green btn--sm">
                Criar conta
              </Link>
            </>
          )}
          <button className="nav__toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="Abrir menu">
            ☰
          </button>
        </div>
      </div>
    </header>
  );
}

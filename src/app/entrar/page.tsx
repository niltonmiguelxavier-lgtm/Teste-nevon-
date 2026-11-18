import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AuthForm } from "./auth-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar ou criar conta" };

type SearchParams = Promise<{ modo?: string; next?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const user = await currentUser();
  if (user) {
    redirect(user.role === "ADMIN" ? "/admin" : user.role === "COURIER" ? "/entregador" : "/conta");
  }

  const mode = params.modo === "registo" ? "registo" : "entrar";

  return (
    <div className="auth">
      <aside className="auth__aside">
        <span className="eyebrow" style={{ color: "#5ddba1" }}>
          Express Delivery
        </span>
        <h2 style={{ fontSize: "2rem", color: "#fff" }}>
          A tua conta, os teus pedidos, num só lugar.
        </h2>
        <p style={{ color: "#b9c2c0", maxWidth: "42ch" }}>
          Cria conta para guardar endereços, acompanhar entregas em tempo real e pagar de forma
          segura com Nevon Pay.
        </p>
        <ul style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <li style={{ color: "#d5dbd9", fontSize: "0.92rem" }}>✓ Histórico de pedidos e recibos</li>
          <li style={{ color: "#d5dbd9", fontSize: "0.92rem" }}>✓ Acompanhamento estado a estado</li>
          <li style={{ color: "#d5dbd9", fontSize: "0.92rem" }}>✓ Endereços guardados para próximas compras</li>
          <li style={{ color: "#d5dbd9", fontSize: "0.92rem" }}>✓ Pagamentos confirmados pela Nevon Pay</li>
        </ul>
      </aside>

      <div className="auth__form">
        <AuthForm initialMode={mode} next={params.next} />
      </div>
    </div>
  );
}

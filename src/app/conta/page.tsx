import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/format";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "A minha conta" };

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/entrar?next=/conta");
  if (user.role !== "CUSTOMER") redirect(user.role === "ADMIN" ? "/admin" : "/entregador");

  const [orders, addresses] = await Promise.all([
    query<{
      id: string;
      reference: string;
      status: string;
      payment_status: string;
      total_cents: number;
      created_at: string;
    }>(
      `SELECT id, reference, status, payment_status, total_cents, created_at
         FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [user.id]
    ),
    query<{ id: string; label: string | null; recipient: string; phone: string; street: string; number: string | null; city: string }>(
      `SELECT id, label, recipient, phone, street, number, city FROM addresses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 8`,
      [user.id]
    ),
  ]);

  const paidTotal = orders
    .filter((order) => order.payment_status === "PAID")
    .reduce((total, order) => total + order.total_cents, 0);

  return (
    <div className="dash">
      <aside className="dash__side">
        <h4>Conta</h4>
        <nav>
          <Link href="/conta" aria-current="page">
            Pedidos
          </Link>
          <Link href="/produtos">Comprar</Link>
          <Link href="/acompanhar">Acompanhar</Link>
          <Link href="/contactos">Apoio</Link>
        </nav>
        <h4>Sessão</h4>
        <LogoutButton />
      </aside>

      <div className="dash__main">
        <div className="dash__head">
          <div>
            <h1>Olá, {user.name.split(" ")[0]}</h1>
            <p>{user.email} · {user.phone ?? "sem telefone"}</p>
          </div>
          <Link href="/produtos" className="btn btn--green btn--sm">
            Fazer novo pedido
          </Link>
        </div>

        <div className="kpis">
          <div className="kpi">
            <span>Pedidos</span>
            <strong>{orders.length}</strong>
          </div>
          <div className="kpi">
            <span>Pagos</span>
            <strong>{orders.filter((order) => order.payment_status === "PAID").length}</strong>
          </div>
          <div className="kpi kpi--accent">
            <span>Total pago</span>
            <strong>{formatMoney(paidTotal)}</strong>
          </div>
          <div className="kpi">
            <span>Endereços</span>
            <strong>{addresses.length}</strong>
          </div>
        </div>

        <h2 style={{ fontSize: "1.1rem", marginBottom: 12 }}>Os meus pedidos</h2>
        {orders.length === 0 ? (
          <div className="empty">
            Ainda não tens pedidos.{" "}
            <Link href="/produtos" style={{ color: "var(--green-dark)", fontWeight: 600 }}>
              Começar a comprar
            </Link>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Referência</th>
                  <th>Criado</th>
                  <th>Estado</th>
                  <th>Pagamento</th>
                  <th className="right">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="mono">{order.reference}</td>
                    <td>{formatDateTime(order.created_at)}</td>
                    <td>
                      <span
                        className={`pill ${
                          order.status === "DELIVERED"
                            ? "pill--green"
                            : order.status === "CANCELLED"
                              ? "pill--red"
                              : "pill--grey"
                        }`}
                      >
                        {ORDER_STATUS_LABELS[order.status] ?? order.status}
                      </span>
                    </td>
                    <td>
                      <span className={`pill ${order.payment_status === "PAID" ? "pill--green" : "pill--amber"}`}>
                        {PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}
                      </span>
                    </td>
                    <td className="right">{formatMoney(order.total_cents)}</td>
                    <td className="right">
                      <Link href={`/pedido/${order.reference}`} className="btn btn--ghost btn--sm">
                        Abrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {addresses.length > 0 ? (
          <>
            <h2 style={{ fontSize: "1.1rem", margin: "28px 0 12px" }}>Endereços guardados</h2>
            <div className="grid grid--3">
              {addresses.map((address) => (
                <div key={address.id} className="card card--flat">
                  <strong style={{ fontSize: "0.92rem" }}>
                    {address.street}
                    {address.number ? `, ${address.number}` : ""}
                  </strong>
                  <p className="small muted" style={{ margin: "4px 0 0" }}>
                    {address.recipient} · {address.phone}
                    <br />
                    {address.city}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

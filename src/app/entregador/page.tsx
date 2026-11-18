import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { formatDateTime, formatMoney, ORDER_STATUS_LABELS } from "@/lib/format";
import { DeliveryActions } from "./delivery-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Painel do entregador" };

export default async function CourierPage() {
  const user = await currentUser();
  if (!user) redirect("/entrar?next=/entregador");
  if (user.role !== "COURIER" && user.role !== "ADMIN") redirect("/conta");

  const deliveries = await query<{
    id: string;
    reference: string;
    status: string;
    payment_status: string;
    delivery_recipient: string;
    delivery_phone: string;
    delivery_street: string;
    delivery_number: string | null;
    delivery_neighbourhood: string | null;
    delivery_city: string;
    delivery_reference: string | null;
    notes: string | null;
    total_cents: number;
    assigned_at: string | null;
  }>(
    `SELECT id, reference, status, payment_status, delivery_recipient, delivery_phone,
            delivery_street, delivery_number, delivery_neighbourhood, delivery_city,
            delivery_reference, notes, total_cents, assigned_at
       FROM orders
      WHERE courier_id = $1 AND status <> 'CANCELLED'
      ORDER BY CASE status WHEN 'OUT_FOR_DELIVERY' THEN 0 WHEN 'PREPARING' THEN 1
                           WHEN 'PAYMENT_CONFIRMED' THEN 2 WHEN 'DELIVERED' THEN 3 ELSE 4 END,
               assigned_at DESC NULLS LAST
      LIMIT 60`,
    [user.id]
  );

  const active = deliveries.filter((delivery) => delivery.status !== "DELIVERED");
  const done = deliveries.filter((delivery) => delivery.status === "DELIVERED");

  return (
    <div className="dash">
      <aside className="dash__side">
        <h4>Entregas</h4>
        <nav>
          <a href="#activas" aria-current="page">
            Activas ({active.length})
          </a>
          <a href="#concluidas">Concluídas ({done.length})</a>
        </nav>
        <h4>Conta</h4>
        <div style={{ padding: "4px 12px" }} className="small muted">
          {user.name}
          <br />
          {user.email}
        </div>
      </aside>

      <div className="dash__main">
        <div className="dash__head">
          <div>
            <h1>Entregas atribuídas</h1>
            <p>{active.length} activa(s) · {done.length} concluída(s)</p>
          </div>
        </div>

        <section id="activas">
          <h2 style={{ fontSize: "1.05rem", marginBottom: 12 }}>Activas</h2>
          {active.length === 0 ? (
            <div className="empty">Sem entregas activas de momento.</div>
          ) : (
            <div className="stack">
              {active.map((delivery) => (
                <article key={delivery.id} className="card">
                  <div className="row row--between" style={{ marginBottom: 8 }}>
                    <strong className="mono">{delivery.reference}</strong>
                    <span
                      className={`pill ${
                        delivery.status === "OUT_FOR_DELIVERY" ? "pill--ink" : "pill--grey"
                      }`}
                    >
                      {ORDER_STATUS_LABELS[delivery.status] ?? delivery.status}
                    </span>
                  </div>

                  <div className="row" style={{ gap: 24, alignItems: "flex-start", marginBottom: 10 }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div className="small muted">Cliente</div>
                      <div style={{ fontWeight: 600 }}>{delivery.delivery_recipient}</div>
                      <a
                        href={`tel:${delivery.delivery_phone}`}
                        className="mono"
                        style={{ color: "var(--green-dark)", fontWeight: 600 }}
                      >
                        {delivery.delivery_phone}
                      </a>
                    </div>
                    <div style={{ flex: 1.4, minWidth: 240 }}>
                      <div className="small muted">Endereço</div>
                      <div>
                        {delivery.delivery_street}
                        {delivery.delivery_number ? `, ${delivery.delivery_number}` : ""}
                      </div>
                      <div className="small muted">
                        {delivery.delivery_neighbourhood ? `${delivery.delivery_neighbourhood}, ` : ""}
                        {delivery.delivery_city}
                        {delivery.delivery_reference ? ` · ${delivery.delivery_reference}` : ""}
                      </div>
                    </div>
                    <div style={{ minWidth: 120 }}>
                      <div className="small muted">Valor (pago)</div>
                      <strong>{formatMoney(delivery.total_cents)}</strong>
                      <div className="small muted">{formatDateTime(delivery.assigned_at)}</div>
                    </div>
                  </div>

                  {delivery.notes ? (
                    <div className="notice notice--info" style={{ marginBottom: 10 }}>
                      <span>Nota do cliente: {delivery.notes}</span>
                    </div>
                  ) : null}

                  {delivery.status === "PAYMENT_CONFIRMED" || delivery.status === "PREPARING" ? (
                    <DeliveryActions orderId={delivery.id} status={delivery.status} action="OUT_FOR_DELIVERY" />
                  ) : (
                    <DeliveryActions orderId={delivery.id} status={delivery.status} action="DELIVERED" />
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section id="concluidas" style={{ marginTop: 34 }}>
          <h2 style={{ fontSize: "1.05rem", marginBottom: 12 }}>Concluídas recentemente</h2>
          {done.length === 0 ? (
            <div className="empty">Ainda sem entregas concluídas.</div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Referência</th>
                    <th>Cliente</th>
                    <th>Endereço</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {done.map((delivery) => (
                    <tr key={delivery.id}>
                      <td className="mono">{delivery.reference}</td>
                      <td>{delivery.delivery_recipient}</td>
                      <td>
                        {delivery.delivery_street}
                        {delivery.delivery_number ? `, ${delivery.delivery_number}` : ""} ·{" "}
                        {delivery.delivery_city}
                      </td>
                      <td>{formatMoney(delivery.total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

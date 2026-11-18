import { query } from "@/lib/db";
import { formatDateTime, formatMoney, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/format";
import { OrderRowActions } from "./order-actions";

export const dynamic = "force-dynamic";

type Search = Promise<{ estado?: string; pagamento?: string; referencia?: string }>;

export default async function AdminOrdersPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;

  const filters = ["1=1"];
  const values: unknown[] = [];
  if (params.estado) {
    values.push(params.estado);
    filters.push(`o.status = $${values.length}`);
  }
  if (params.pagamento) {
    values.push(params.pagamento);
    filters.push(`o.payment_status = $${values.length}`);
  }
  if (params.referencia) {
    values.push(params.referencia.toUpperCase());
    filters.push(`upper(o.reference) = $${values.length}`);
  }

  const [orders, couriers] = await Promise.all([
    query<{
      id: string;
      reference: string;
      status: string;
      payment_status: string;
      customer_name: string;
      customer_phone: string;
      delivery_recipient: string;
      delivery_phone: string;
      delivery_street: string;
      delivery_number: string | null;
      delivery_city: string;
      total_cents: number;
      created_at: string;
      courier_id: string | null;
      courier_name: string | null;
      tx_status: string | null;
      provider_payment_id: string | null;
    }>(
      `SELECT o.id, o.reference, o.status, o.payment_status, o.customer_name, o.customer_phone,
              o.delivery_recipient, o.delivery_phone, o.delivery_street, o.delivery_number,
              o.delivery_city, o.total_cents, o.created_at, o.courier_id,
              u.name AS courier_name, t.status AS tx_status, t.provider_payment_id
         FROM orders o
         LEFT JOIN users u ON u.id = o.courier_id
         LEFT JOIN LATERAL (
           SELECT status, provider_payment_id FROM transactions
            WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
         ) t ON true
        WHERE ${filters.join(" AND ")}
        ORDER BY o.created_at DESC LIMIT 120`,
      values
    ),
    query<{ id: string; name: string }>(
      `SELECT id, name FROM users WHERE role = 'COURIER' AND active ORDER BY name`
    ),
  ]);

  const tabs = [
    { label: "Todos", href: "/admin/pedidos" },
    { label: "Pendentes", href: "/admin/pedidos?pagamento=PENDING" },
    { label: "Pagos", href: "/admin/pedidos?pagamento=PAID" },
    { label: "Em preparação", href: "/admin/pedidos?estado=PREPARING" },
    { label: "Em distribuição", href: "/admin/pedidos?estado=OUT_FOR_DELIVERY" },
    { label: "Entregues", href: "/admin/pedidos?estado=DELIVERED" },
  ];

  return (
    <>
      <div className="dash__head">
        <div>
          <h1>Pedidos</h1>
          <p>{orders.length} pedido(s) listado(s)</p>
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 18 }}>
        {tabs.map((tab) => {
          const active =
            (tab.href === "/admin/pedidos" && !params.estado && !params.pagamento) ||
            (params.estado && tab.href.includes(`estado=${params.estado}`)) ||
            (params.pagamento && tab.href.includes(`pagamento=${params.pagamento}`));
          return (
            <a key={tab.href} href={tab.href} className={`btn btn--sm ${active ? "" : "btn--ghost"}`}>
              {tab.label}
            </a>
          );
        })}
      </div>

      {orders.length === 0 ? (
        <div className="empty">Nenhum pedido com estes filtros.</div>
      ) : (
        <div className="stack">
          {orders.map((order) => (
            <article key={order.id} className="card">
              <div className="row row--between" style={{ marginBottom: 6 }}>
                <div className="row" style={{ gap: 10 }}>
                  <strong className="mono">{order.reference}</strong>
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
                  <span className={`pill ${order.payment_status === "PAID" ? "pill--green" : "pill--amber"}`}>
                    {PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}
                  </span>
                </div>
                <strong>{formatMoney(order.total_cents)}</strong>
              </div>

              <div className="row" style={{ gap: 26, alignItems: "flex-start", marginBottom: 12 }}>
                <div style={{ minWidth: 190 }}>
                  <div className="small muted">Cliente</div>
                  <div style={{ fontWeight: 600 }}>{order.customer_name}</div>
                  <div className="small mono">{order.customer_phone}</div>
                </div>
                <div style={{ minWidth: 230 }}>
                  <div className="small muted">Entrega</div>
                  <div>
                    {order.delivery_street}
                    {order.delivery_number ? `, ${order.delivery_number}` : ""} · {order.delivery_city}
                  </div>
                  <div className="small mono">{order.delivery_phone}</div>
                </div>
                <div style={{ minWidth: 170 }}>
                  <div className="small muted">Pagamento Nevon Pay</div>
                  <div className="small mono">{order.provider_payment_id ?? "—"}</div>
                  <div className="small muted">{order.tx_status ?? "sem transacção"}</div>
                </div>
                <div style={{ minWidth: 130 }}>
                  <div className="small muted">Criado</div>
                  <div className="small">{formatDateTime(order.created_at)}</div>
                </div>
              </div>

              <OrderRowActions
                orderId={order.id}
                status={order.status}
                paymentStatus={order.payment_status}
                courierId={order.courier_id}
                couriers={couriers}
              />
            </article>
          ))}
        </div>
      )}
    </>
  );
}

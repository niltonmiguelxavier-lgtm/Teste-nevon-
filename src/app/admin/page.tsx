import Link from "next/link";
import { query, queryOne } from "@/lib/db";
import { formatDateTime, formatMoney, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/format";
import { nevonConfig } from "@/lib/nevonpay";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const [statusCounts, paymentCounts, revenue, recentOrders, notifications, couriersPending] =
    await Promise.all([
      query<{ status: string; count: string }>(`SELECT status, count(*)::text AS count FROM orders GROUP BY status`),
      query<{ payment_status: string; count: string }>(
        `SELECT payment_status, count(*)::text AS count FROM orders GROUP BY payment_status`
      ),
      queryOne<{ paid_total: string; paid_orders: string; avg_ticket: string }>(
        `SELECT coalesce(sum(total_cents),0)::text AS paid_total,
                count(*)::text AS paid_orders,
                coalesce(round(avg(total_cents)),0)::text AS avg_ticket
           FROM orders WHERE payment_status = 'PAID'`
      ),
      query<{
        id: string;
        reference: string;
        status: string;
        payment_status: string;
        customer_name: string;
        total_cents: number;
        created_at: string;
      }>(`SELECT id, reference, status, payment_status, customer_name, total_cents, created_at
            FROM orders ORDER BY created_at DESC LIMIT 8`),
      query<{ id: string; title: string; body: string | null; created_at: string; read_at: string | null }>(
        `SELECT id, title, body, created_at, read_at FROM notifications
          WHERE audience = 'ADMIN' ORDER BY created_at DESC LIMIT 6`
      ),
      queryOne<{ count: string }>(
        `SELECT count(*)::text AS count FROM orders
          WHERE status IN ('PAYMENT_CONFIRMED','PREPARING') AND courier_id IS NULL`
      ),
    ]);

  const byStatus = (status: string) => Number(statusCounts.find((row) => row.status === status)?.count ?? 0);
  const byPayment = (status: string) => Number(paymentCounts.find((row) => row.payment_status === status)?.count ?? 0);
  const nevon = nevonConfig();

  return (
    <>
      <div className="dash__head">
        <div>
          <h1>Visão geral</h1>
          <p>Operação em tempo real · actualizado {formatDateTime(new Date())}</p>
        </div>
        <div className="row">
          <span className={`pill ${nevon.environment === "PRODUCTION" ? "pill--amber" : "pill--green"}`}>
            Nevon Pay · {nevon.environment === "PRODUCTION" ? "produção" : "sandbox"}
          </span>
          <Link href="/admin/nevonpay" className="btn btn--ghost btn--sm">
            Diagnóstico
          </Link>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span>Total de pedidos</span>
          <strong>{statusCounts.reduce((total, row) => total + Number(row.count), 0)}</strong>
        </div>
        <div className="kpi">
          <span>Pendentes de pagamento</span>
          <strong>{byPayment("PENDING")}</strong>
        </div>
        <div className="kpi">
          <span>Pagos</span>
          <strong>{byPayment("PAID")}</strong>
        </div>
        <div className="kpi">
          <span>Em preparação</span>
          <strong>{byStatus("PREPARING")}</strong>
        </div>
        <div className="kpi">
          <span>Em distribuição</span>
          <strong>{byStatus("OUT_FOR_DELIVERY")}</strong>
        </div>
        <div className="kpi">
          <span>Entregues</span>
          <strong>{byStatus("DELIVERED")}</strong>
        </div>
        <div className="kpi kpi--accent">
          <span>Receita confirmada</span>
          <strong>{formatMoney(Number(revenue?.paid_total ?? 0))}</strong>
        </div>
      </div>

      {Number(couriersPending?.count ?? 0) > 0 ? (
        <div className="notice notice--warn">
          <span>
            {couriersPending?.count} pedido(s) pago(s) ainda sem entregador atribuído.{" "}
            <Link href="/admin/pedidos?pagamento=PAID" style={{ fontWeight: 700, textDecoration: "underline" }}>
              Atribuir agora
            </Link>
          </span>
        </div>
      ) : null}

      <div className="grid grid--2" style={{ alignItems: "start" }}>
        <div>
          <h2 style={{ fontSize: "1.05rem", marginBottom: 12 }}>Pedidos recentes</h2>
          <div className="table-wrap">
            <table className="data" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>Referência</th>
                  <th>Cliente</th>
                  <th>Estado</th>
                  <th className="right">Total</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link href={`/admin/pedidos?referencia=${order.reference}`} className="mono">
                        {order.reference}
                      </Link>
                    </td>
                    <td>{order.customer_name}</td>
                    <td>
                      <span
                        className={`pill ${
                          order.payment_status === "PAID" ? "pill--green" : "pill--amber"
                        }`}
                      >
                        {ORDER_STATUS_LABELS[order.status] ?? order.status}
                      </span>
                    </td>
                    <td className="right">{formatMoney(order.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 style={{ fontSize: "1.05rem", marginBottom: 12 }}>Notificações da equipa</h2>
          <div className="card card--flat">
            {notifications.length === 0 ? (
              <p className="muted small">Sem notificações.</p>
            ) : (
              notifications.map((notification) => (
                <div key={notification.id} style={{ padding: "9px 0", borderBottom: "1px solid #eef0ed" }}>
                  <div className="row row--between">
                    <strong style={{ fontSize: "0.88rem" }}>{notification.title}</strong>
                    {!notification.read_at ? <span className="pill pill--green">nova</span> : null}
                  </div>
                  {notification.body ? (
                    <div className="small muted">{notification.body}</div>
                  ) : null}
                  <div className="small muted">{formatDateTime(notification.created_at)}</div>
                </div>
              ))
            )}
          </div>

          <div className="card card--flat" style={{ marginTop: 14 }}>
            <strong style={{ fontSize: "0.9rem" }}>Pagamentos</strong>
            <div className="stack" style={{ marginTop: 8 }}>
              {["PAID", "PENDING", "FAILED", "EXPIRED"].map((status) => (
                <div key={status} className="row row--between small">
                  <span className="muted">{PAYMENT_STATUS_LABELS[status]}</span>
                  <strong>{byPayment(status)}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

import { query } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const [daily, byMethod, topProducts, ledger, totals] = await Promise.all([
    query<{ day: string; paid_orders: string; revenue_cents: string; pending_cents: string; fees_cents: string }>(
      `SELECT to_char(date_trunc('day', created_at), 'DD/MM') AS day,
              count(*) FILTER (WHERE payment_status = 'PAID')::text AS paid_orders,
              coalesce(sum(total_cents) FILTER (WHERE payment_status = 'PAID'), 0)::text AS revenue_cents,
              coalesce(sum(total_cents) FILTER (WHERE payment_status = 'PENDING'), 0)::text AS pending_cents,
              coalesce(sum(delivery_fee_cents) FILTER (WHERE payment_status = 'PAID'), 0)::text AS fees_cents
         FROM orders
        WHERE created_at >= now() - interval '30 days'
        GROUP BY date_trunc('day', created_at) ORDER BY date_trunc('day', created_at) DESC`
    ),
    query<{ method: string; status: string; count: string; total_cents: string }>(
      `SELECT method, status, count(*)::text AS count, coalesce(sum(amount_cents),0)::text AS total_cents
         FROM transactions GROUP BY 1,2 ORDER BY 1`
    ),
    query<{ name: string; units: string; revenue_cents: string }>(
      `SELECT oi.name, sum(oi.quantity)::text AS units, coalesce(sum(oi.line_total_cents),0)::text AS revenue_cents
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.payment_status = 'PAID'
        GROUP BY oi.name ORDER BY sum(oi.line_total_cents) DESC LIMIT 10`
    ),
    query<{ created_at: string; actor_role: string | null; action: string; resource_id: string | null; metadata: unknown }>(
      `SELECT created_at, actor_role, action, resource_id, metadata FROM audit_log
        WHERE action LIKE 'payment.%' OR action LIKE 'order.%' OR action LIKE 'nevonpay.%'
        ORDER BY created_at DESC LIMIT 40`
    ),
    query<{
      revenue: string;
      fees: string;
      discount: string;
      paid: string;
      avg: string;
    }>(
      `SELECT coalesce(sum(total_cents) FILTER (WHERE payment_status='PAID'),0)::text AS revenue,
              coalesce(sum(delivery_fee_cents) FILTER (WHERE payment_status='PAID'),0)::text AS fees,
              coalesce(sum(discount_cents) FILTER (WHERE payment_status='PAID'),0)::text AS discount,
              count(*) FILTER (WHERE payment_status='PAID')::text AS paid,
              coalesce(round(avg(total_cents) FILTER (WHERE payment_status='PAID')),0)::text AS avg
         FROM orders`
    ),
  ]);

  const total = totals[0];

  return (
    <>
      <div className="dash__head">
        <div>
          <h1>Relatórios financeiros</h1>
          <p>Últimos 30 dias · apenas pagamentos confirmados pela Nevon Pay</p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi kpi--accent">
          <span>Receita confirmada</span>
          <strong>{formatMoney(Number(total?.revenue ?? 0))}</strong>
        </div>
        <div className="kpi">
          <span>Pedidos pagos</span>
          <strong>{total?.paid ?? 0}</strong>
        </div>
        <div className="kpi">
          <span>Ticket médio</span>
          <strong>{formatMoney(Number(total?.avg ?? 0))}</strong>
        </div>
        <div className="kpi">
          <span>Taxas de entrega</span>
          <strong>{formatMoney(Number(total?.fees ?? 0))}</strong>
        </div>
        <div className="kpi">
          <span>Descontos</span>
          <strong>{formatMoney(Number(total?.discount ?? 0))}</strong>
        </div>
      </div>

      <h2 style={{ fontSize: "1.02rem", margin: "6px 0 12px" }}>Por dia</h2>
      {daily.length === 0 ? (
        <div className="empty">Sem dados no período.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Dia</th>
                <th className="right">Pedidos pagos</th>
                <th className="right">Receita</th>
                <th className="right">Taxas entrega</th>
                <th className="right">Pendente</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((row) => (
                <tr key={row.day}>
                  <td className="mono">{row.day}</td>
                  <td className="right">{row.paid_orders}</td>
                  <td className="right">{formatMoney(Number(row.revenue_cents))}</td>
                  <td className="right">{formatMoney(Number(row.fees_cents))}</td>
                  <td className="right muted">{formatMoney(Number(row.pending_cents))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid--2" style={{ marginTop: 24, alignItems: "start" }}>
        <div>
          <h2 style={{ fontSize: "1.02rem", marginBottom: 12 }}>Transacções por método</h2>
          <div className="table-wrap">
            <table className="data" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>Método</th>
                  <th>Estado</th>
                  <th className="right">Qtd</th>
                  <th className="right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {byMethod.map((row) => (
                  <tr key={`${row.method}-${row.status}`}>
                    <td>{row.method}</td>
                    <td>
                      <span className={`pill ${row.status === "COMPLETED" ? "pill--green" : "pill--grey"}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="right">{row.count}</td>
                    <td className="right">{formatMoney(Number(row.total_cents))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 style={{ fontSize: "1.02rem", marginBottom: 12 }}>Produtos mais vendidos</h2>
          <div className="table-wrap">
            <table className="data" style={{ minWidth: 0 }}>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="right">Unidades</th>
                  <th className="right">Receita</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td className="right">{row.units}</td>
                    <td className="right">{formatMoney(Number(row.revenue_cents))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: "1.02rem", margin: "26px 0 12px" }}>Registo de operações financeiras</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Data</th>
              <th>Função</th>
              <th>Operação</th>
              <th>Recurso</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((row, index) => (
              <tr key={`${row.action}-${index}`}>
                <td className="small">{formatDateTime(row.created_at)}</td>
                <td className="small">{row.actor_role ?? "SYSTEM"}</td>
                <td className="mono small">{row.action}</td>
                <td className="small muted">{row.resource_id?.slice(0, 12) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

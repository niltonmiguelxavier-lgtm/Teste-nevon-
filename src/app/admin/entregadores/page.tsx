import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { CourierManager } from "./courier-manager";

export const dynamic = "force-dynamic";

export default async function AdminCouriersPage() {
  const couriers = await query<{
    id: string;
    name: string;
    email: string;
    phone: string | null;
    active: boolean;
    created_at: string;
    last_login_at: string | null;
    deliveries: string;
    delivered: string;
    active_deliveries: string;
  }>(
    `SELECT u.id, u.name, u.email, u.phone, u.active, u.created_at, u.last_login_at,
            count(o.id)::text AS deliveries,
            count(o.id) FILTER (WHERE o.status = 'DELIVERED')::text AS delivered,
            count(o.id) FILTER (WHERE o.status IN ('PAYMENT_CONFIRMED','PREPARING','OUT_FOR_DELIVERY'))::text AS active_deliveries
       FROM users u LEFT JOIN orders o ON o.courier_id = u.id
      WHERE u.role = 'COURIER'
      GROUP BY u.id ORDER BY u.name`
  );

  return (
    <>
      <div className="dash__head">
        <div>
          <h1>Gestão de entregadores</h1>
          <p>{couriers.length} entregador(es) · contas com acesso ao painel de entregas</p>
        </div>
      </div>

      <CourierManager couriers={couriers.map((c) => ({ ...c }))} />

      <div className="card card--flat" style={{ marginTop: 20 }}>
        <strong style={{ fontSize: "0.9rem" }}>Desempenho</strong>
        <div className="table-wrap" style={{ marginTop: 10, border: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Entregador</th>
                <th className="right">Total</th>
                <th className="right">Entregues</th>
                <th className="right">Activas</th>
                <th>Último acesso</th>
              </tr>
            </thead>
            <tbody>
              {couriers.map((courier) => (
                <tr key={courier.id}>
                  <td>{courier.name}</td>
                  <td className="right">{courier.deliveries}</td>
                  <td className="right">{courier.delivered}</td>
                  <td className="right">{courier.active_deliveries}</td>
                  <td className="small">{formatDateTime(courier.last_login_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

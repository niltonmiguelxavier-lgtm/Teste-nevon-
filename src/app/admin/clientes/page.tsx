import { query } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminCustomersPage() {
  const customers = await query<{
    id: string;
    name: string;
    email: string;
    phone: string | null;
    active: boolean;
    created_at: string;
    last_login_at: string | null;
    orders: string;
    spent_cents: string;
    last_order_at: string | null;
  }>(
    `SELECT u.id, u.name, u.email, u.phone, u.active, u.created_at, u.last_login_at,
            count(o.id)::text AS orders,
            coalesce(sum(o.total_cents) FILTER (WHERE o.payment_status = 'PAID'), 0)::text AS spent_cents,
            max(o.created_at) AS last_order_at
       FROM users u LEFT JOIN orders o ON o.user_id = u.id
      WHERE u.role = 'CUSTOMER'
      GROUP BY u.id ORDER BY u.created_at DESC`
  );

  return (
    <>
      <div className="dash__head">
        <div>
          <h1>Gestão de clientes</h1>
          <p>{customers.length} cliente(s) registado(s)</p>
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="empty">Ainda não existem clientes registados.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contacto</th>
                <th className="right">Pedidos</th>
                <th className="right">Total pago</th>
                <th>Registo</th>
                <th>Último pedido</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <strong style={{ fontSize: "0.88rem" }}>{customer.name}</strong>
                    {!customer.active ? <span className="pill pill--red">inactivo</span> : null}
                  </td>
                  <td className="small">
                    {customer.email}
                    <br />
                    <span className="mono">{customer.phone ?? "—"}</span>
                  </td>
                  <td className="right">{customer.orders}</td>
                  <td className="right">{formatMoney(Number(customer.spent_cents))}</td>
                  <td className="small">{formatDateTime(customer.created_at)}</td>
                  <td className="small">{formatDateTime(customer.last_order_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="notice notice--info" style={{ marginTop: 18 }}>
        <span>
          Dados de pagamento: a Express Delivery não armazena números de cartão. O histórico
          financeiro está em <a href="/admin/transaccoes" style={{ fontWeight: 700 }}>Transacções</a>{" "}
          e o registo de operações em <a href="/admin/relatorios" style={{ fontWeight: 700 }}>Relatórios</a>.
        </span>
      </div>
    </>
  );
}

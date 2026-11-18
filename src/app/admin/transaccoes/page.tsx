import { query } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminTransactionsPage() {
  const [transactions, stats] = await Promise.all([
    query<{
      id: string;
      reference: string;
      method: string;
      status: string;
      amount_cents: number;
      currency: string;
      environment: string;
      provider_payment_id: string | null;
      provider_ref: string | null;
      checkout_session_id: string | null;
      confirmed_at: string | null;
      last_error: string | null;
      created_at: string;
      order_reference: string;
    }>(
      `SELECT t.id, o.reference AS order_reference, t.method, t.status, t.amount_cents, t.currency,
              t.environment, t.provider_payment_id, t.provider_ref, t.checkout_session_id,
              t.confirmed_at, t.last_error, t.created_at
         FROM transactions t JOIN orders o ON o.id = t.order_id
        ORDER BY t.created_at DESC LIMIT 100`
    ),
    query<{ status: string; count: string; total: string }>(
      `SELECT status, count(*)::text AS count, coalesce(sum(amount_cents),0)::text AS total
         FROM transactions GROUP BY status`
    ),
  ]);

  return (
    <>
      <div className="dash__head">
        <div>
          <h1>Histórico de transacções</h1>
          <p>Registo das cobranças criadas na Nevon Pay (ambiente sandbox)</p>
        </div>
      </div>

      <div className="kpis">
        {stats.map((row) => (
          <div key={row.status} className="kpi">
            <span>{row.status}</span>
            <strong>{row.count}</strong>
            <div className="small muted">{formatMoney(Number(row.total))}</div>
          </div>
        ))}
      </div>

      {transactions.length === 0 ? (
        <div className="empty">Ainda não existem transacções.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Pedido</th>
                <th>ID Nevon Pay</th>
                <th>Método</th>
                <th>Estado</th>
                <th>Criada</th>
                <th>Confirmada</th>
                <th className="right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td className="mono">{transaction.order_reference}</td>
                  <td className="mono small">{transaction.provider_payment_id ?? "—"}</td>
                  <td>{transaction.method}</td>
                  <td>
                    <span
                      className={`pill ${
                        transaction.status === "COMPLETED"
                          ? "pill--green"
                          : ["FAILED", "EXPIRED", "CANCELLED"].includes(transaction.status)
                            ? "pill--red"
                            : "pill--amber"
                      }`}
                    >
                      {transaction.status}
                    </span>
                    {transaction.last_error ? (
                      <div className="small muted" style={{ maxWidth: 220 }}>
                        {transaction.last_error.slice(0, 90)}
                      </div>
                    ) : null}
                  </td>
                  <td className="small">{formatDateTime(transaction.created_at)}</td>
                  <td className="small">{formatDateTime(transaction.confirmed_at)}</td>
                  <td className="right">{formatMoney(transaction.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

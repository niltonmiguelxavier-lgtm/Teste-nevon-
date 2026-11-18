import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { formatDateTime, formatMoney, ORDER_FLOW, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/format";
import { latestTransaction, type OrderRow } from "@/lib/orders";
import { PaymentPanel } from "./payment-panel";

export const dynamic = "force-dynamic";

type Params = Promise<{ reference: string }>;
type Search = Promise<{ pagamento?: string }>;

export default async function OrderPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { reference } = await params;
  const search = await searchParams;
  const user = await currentUser();
  if (!user) redirect(`/entrar?next=/pedido/${reference}`);

  const order = await queryOne<OrderRow>(`SELECT * FROM orders WHERE reference = $1`, [reference]);
  if (!order) {
    return (
      <div className="section">
        <div className="container">
          <div className="empty">
            Pedido não encontrado.{" "}
            <Link href="/acompanhar" style={{ color: "var(--green-dark)" }}>
              Procurar outro pedido
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const allowed =
    order.user_id === user.id || user.role === "ADMIN" || (user.role === "COURIER" && order.courier_id === user.id);
  if (!allowed) redirect("/conta");

  const [items, events, tx, courier] = await Promise.all([
    query<{ id: string; name: string; quantity: number; unit_price_cents: number; line_total_cents: number }>(
      `SELECT id, name, quantity, unit_price_cents, line_total_cents FROM order_items WHERE order_id = $1`,
      [order.id]
    ),
    query<{ status: string; note: string | null; created_at: string; actor_role: string | null }>(
      `SELECT status, note, created_at, actor_role FROM order_events WHERE order_id = $1 ORDER BY created_at ASC`,
      [order.id]
    ),
    latestTransaction(order.id),
    order.courier_id
      ? queryOne<{ name: string; phone: string | null }>(`SELECT name, phone FROM users WHERE id = $1`, [
          order.courier_id,
        ])
      : Promise.resolve(null),
  ]);

  const flowIndex = ORDER_FLOW.indexOf(order.status as (typeof ORDER_FLOW)[number]);
  const isPaid = order.payment_status === "PAID";
  const canPay = !isPaid && order.status !== "CANCELLED" && order.status !== "DELIVERED";

  const paymentNotice =
    search.pagamento === "retorno"
      ? {
          kind: "info" as const,
          text: "Regressaste do ambiente de pagamento. O estado abaixo só muda quando a Nevon Pay confirmar o pagamento ao nosso servidor.",
        }
      : search.pagamento === "cancelado"
        ? { kind: "warn" as const, text: "O pagamento foi cancelado. Podes tentar novamente quando quiseres." }
        : null;

  return (
    <div className="section">
      <div className="container">
        <div className="section-head">
          <div>
            <span className="eyebrow">Pedido</span>
            <h1 style={{ fontSize: "clamp(1.6rem, 3vw, 2.2rem)" }} className="mono">
              {order.reference}
            </h1>
            <p className="lead">
              Criado em {formatDateTime(order.created_at)} · {ORDER_STATUS_LABELS[order.status] ?? order.status}
            </p>
          </div>
          <div className="row">
            <span className={`pill ${isPaid ? "pill--green" : order.payment_status === "PENDING" ? "pill--amber" : "pill--red"}`}>
              {PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}
            </span>
            <Link href="/acompanhar" className="btn btn--ghost btn--sm">
              Acompanhar outro pedido
            </Link>
          </div>
        </div>

        {paymentNotice ? (
          <div className={`notice notice--${paymentNotice.kind}`}>
            <span>{paymentNotice.text}</span>
          </div>
        ) : null}

        <div className="cart-layout">
          <div className="stack">
            <div className="card">
              <h3>Acompanhamento</h3>
              <div className="tracker">
                {ORDER_FLOW.map((status, index) => {
                  const state =
                    flowIndex > index ? "done" : flowIndex === index ? "current" : "pending";
                  const event = events.find((item) => item.status === status);
                  return (
                    <div
                      key={status}
                      className={`tracker__item tracker__item--${state}`}
                    >
                      <span className="tracker__dot">{state === "done" ? "✓" : index + 1}</span>
                      <div>
                        <b>{ORDER_STATUS_LABELS[status]}</b>
                        <span>
                          {event
                            ? `${formatDateTime(event.created_at)}${event.note ? ` · ${event.note}` : ""}`
                            : state === "pending"
                              ? "A aguardar"
                              : "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {order.status === "CANCELLED" ? (
                <div className="notice notice--error" style={{ marginTop: 16 }}>
                  <span>Este pedido foi cancelado em {formatDateTime(order.paid_at)}.</span>
                </div>
              ) : null}
            </div>

            <div className="card">
              <h3>Artigos</h3>
              {items.map((item) => (
                <div key={item.id} className="summary__row">
                  <span>
                    {item.quantity}× {item.name}
                  </span>
                  <span>{formatMoney(item.line_total_cents)}</span>
                </div>
              ))}
              <div className="summary__row">
                <span>Subtotal</span>
                <span>{formatMoney(order.subtotal_cents)}</span>
              </div>
              {order.discount_cents > 0 ? (
                <div className="summary__row" style={{ color: "var(--green-dark)" }}>
                  <span>Desconto {order.promo_code ? `(${order.promo_code})` : ""}</span>
                  <span>−{formatMoney(order.discount_cents)}</span>
                </div>
              ) : null}
              <div className="summary__row">
                <span>Entrega</span>
                <span>
                  {order.delivery_fee_cents === 0 ? "Grátis" : formatMoney(order.delivery_fee_cents)}
                </span>
              </div>
              <div className="summary__row summary__row--total">
                <span>Total</span>
                <span>{formatMoney(order.total_cents)}</span>
              </div>
            </div>

            <div className="card">
              <h3>Entrega</h3>
              <div className="summary__row">
                <span>Destinatário</span>
                <span>{order.delivery_recipient}</span>
              </div>
              <div className="summary__row">
                <span>Telefone</span>
                <span className="mono">{order.delivery_phone}</span>
              </div>
              <div className="summary__row">
                <span>Endereço</span>
                <span className="right">
                  {order.delivery_street}
                  {order.delivery_number ? `, ${order.delivery_number}` : ""}
                  <br />
                  {order.delivery_neighbourhood ? `${order.delivery_neighbourhood}, ` : ""}
                  {order.delivery_city}
                </span>
              </div>
              {order.delivery_reference ? (
                <div className="summary__row">
                  <span>Referência</span>
                  <span className="right">{order.delivery_reference}</span>
                </div>
              ) : null}
              {courier ? (
                <div className="summary__row">
                  <span>Entregador</span>
                  <span>
                    {courier.name}
                    {courier.phone ? ` · ${courier.phone}` : ""}
                  </span>
                </div>
              ) : null}
              {order.notes ? (
                <div className="summary__row">
                  <span>Notas</span>
                  <span className="right">{order.notes}</span>
                </div>
              ) : null}
            </div>

            <div className="card card--flat">
              <h3>Histórico</h3>
              {events.map((event, index) => (
                <div key={`${event.status}-${index}`} className="summary__row">
                  <span>
                    <strong style={{ color: "var(--ink)" }}>
                      {ORDER_STATUS_LABELS[event.status] ?? event.status}
                    </strong>
                    {event.note ? <span className="muted small"> · {event.note}</span> : null}
                  </span>
                  <span className="small muted">{formatDateTime(event.created_at)}</span>
                </div>
              ))}
            </div>
          </div>

          <aside className="stack">
            <PaymentPanel
              reference={order.reference}
              canPay={canPay}
              isPaid={isPaid}
              transaction={
                tx
                  ? {
                      status: tx.status,
                      method: tx.method,
                      provider_payment_id: tx.provider_payment_id,
                      checkout_url: tx.checkout_url,
                      confirmed_at: tx.confirmed_at,
                      created_at: tx.created_at,
                    }
                  : null
              }
              total={order.total_cents}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}

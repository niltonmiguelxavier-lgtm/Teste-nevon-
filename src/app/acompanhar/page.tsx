import Link from "next/link";
import { query } from "@/lib/db";
import { formatDateTime, ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Acompanhar pedido" };

type Search = Promise<{ referencia?: string }>;

export default async function TrackPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const reference = params.referencia?.trim().toUpperCase() ?? "";

  // Consulta pública mínima: mostra apenas o estado, nunca dados pessoais ou
  // valores. O detalhe completo exige sessão iniciada (página do pedido).
  const rows = reference
    ? await query<{ reference: string; status: string; payment_status: string; updated_at: string }>(
        `SELECT reference, status, payment_status, updated_at FROM orders WHERE upper(reference) = $1`,
        [reference]
      )
    : [];
  const found = rows[0];

  return (
    <div className="section">
      <div className="container" style={{ maxWidth: 720 }}>
        <div className="section-head">
          <div>
            <span className="eyebrow">Acompanhamento</span>
            <h1 style={{ fontSize: "clamp(1.7rem, 3vw, 2.3rem)" }}>Onde está o meu pedido?</h1>
            <p className="lead">Introduz a referência que recebeste ao criar o pedido (ex.: EX-2026-8F3K2A).</p>
          </div>
        </div>

        <form className="row" action="/acompanhar" style={{ gap: 10, marginBottom: 26 }}>
          <input
            name="referencia"
            defaultValue={reference}
            placeholder="EX-2026-8F3K2A"
            aria-label="Referência do pedido"
            className="mono"
            style={{
              flex: 1,
              minWidth: 220,
              padding: "12px 14px",
              border: "1px solid var(--paper-line)",
              borderRadius: 9,
              textTransform: "uppercase",
            }}
          />
          <button className="btn btn--green" type="submit">
            Procurar
          </button>
        </form>

        {reference && !found ? (
          <div className="empty">
            Não encontrámos nenhum pedido com a referência <strong className="mono">{reference}</strong>.
            Confirma os caracteres ou inicia sessão para ver todos os teus pedidos.
          </div>
        ) : null}

        {found ? (
          <div className="card">
            <div className="row row--between" style={{ marginBottom: 8 }}>
              <strong className="mono">{found.reference}</strong>
              <span className={`pill ${found.payment_status === "PAID" ? "pill--green" : "pill--amber"}`}>
                {PAYMENT_STATUS_LABELS[found.payment_status] ?? found.payment_status}
              </span>
            </div>
            <h3 style={{ marginBottom: 4 }}>{ORDER_STATUS_LABELS[found.status] ?? found.status}</h3>
            <p className="small muted">Actualizado em {formatDateTime(found.updated_at)}</p>
            <div className="divider" />
            <div className="row row--between">
              <span className="small muted">
                Para ver artigos, endereço e histórico completo, inicia sessão.
              </span>
              <Link href={`/entrar?next=/pedido/${found.reference}`} className="btn btn--sm">
                Ver detalhe
              </Link>
            </div>
          </div>
        ) : null}

        <div className="card card--flat" style={{ marginTop: 22 }}>
          <strong style={{ fontSize: "0.92rem" }}>Estados possíveis</strong>
          <div className="stack" style={{ marginTop: 10 }}>
            {["RECEIVED", "PAYMENT_CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"].map(
              (status, index) => (
                <div key={status} className="row" style={{ gap: 10 }}>
                  <span className="pill pill--grey">{index + 1}</span>
                  <span className="small">{ORDER_STATUS_LABELS[status]}</span>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { query } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { nevonConfig } from "@/lib/nevonpay";
import { DiagnosticsPanel } from "./diagnostics-panel";

export const dynamic = "force-dynamic";

export default async function NevonPayPage() {
  const config = nevonConfig();
  const [events, webhooks] = await Promise.all([
    query<{
      id: string;
      kind: string;
      method: string | null;
      path: string | null;
      status_code: number | null;
      ok: boolean | null;
      duration_ms: number | null;
      request_ref: string | null;
      message: string | null;
      created_at: string;
    }>(
      `SELECT id, kind, method, path, status_code, ok, duration_ms, request_ref, message, created_at
         FROM provider_events ORDER BY created_at DESC LIMIT 40`
    ),
    query<{
      id: string;
      event_id: string;
      signature_ok: boolean;
      processed: boolean;
      error: string | null;
      received_at: string;
    }>(
      `SELECT id, event_id, signature_ok, processed, error, received_at
         FROM webhook_events ORDER BY received_at DESC LIMIT 20`
    ),
  ]);

  const webhookUrlHint = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://o-seu-dominio"}/api/payments/webhook`;

  return (
    <>
      <div className="dash__head">
        <div>
          <h1>Testes da integração Nevon Pay</h1>
          <p>Área interna de diagnóstico — ambiente de testes (sandbox)</p>
        </div>
        <span className={`pill ${config.environment === "PRODUCTION" ? "pill--amber" : "pill--green"}`}>
          {config.environment === "PRODUCTION" ? "produção" : "sandbox"}
        </span>
      </div>

      <div className="notice notice--warn">
        <span>
          Nenhuma acção desta página mostra a chave secreta. O diagnóstico executa pedidos reais à
          API Nevon Pay configurada em <code className="mono">NEVONPAY_BASE_URL</code> e regista
          todas as respostas em <em>Registos de integração</em>, com dados sensíveis removidos.
        </span>
      </div>

      <DiagnosticsPanel webhookUrl={webhookUrlHint} />

      <h2 style={{ fontSize: "1.02rem", margin: "26px 0 12px" }}>Registos de integração</h2>
      {events.length === 0 ? (
        <div className="empty">Ainda não existem chamadas registadas. Execute um teste acima.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Pedido</th>
                <th>HTTP</th>
                <th>Duração</th>
                <th>Mensagem</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="small">{formatDateTime(event.created_at)}</td>
                  <td>
                    <span
                      className={`pill ${
                        event.kind === "ERROR"
                          ? "pill--red"
                          : event.kind === "WEBHOOK"
                            ? "pill--ink"
                            : "pill--grey"
                      }`}
                    >
                      {event.kind}
                    </span>
                  </td>
                  <td className="mono small">
                    {event.method ?? ""} {event.path ?? ""}
                    {event.request_ref ? <div className="muted">{event.request_ref}</div> : null}
                  </td>
                  <td className="small">{event.status_code ?? "—"}</td>
                  <td className="small">{event.duration_ms ? `${event.duration_ms} ms` : "—"}</td>
                  <td className="small muted" style={{ maxWidth: 340 }}>
                    {event.message ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ fontSize: "1.02rem", margin: "26px 0 12px" }}>Webhooks recebidos</h2>
      <div className="notice notice--info">
        <span>
          A documentação pública da Nevon Pay não descreve webhooks nem assinatura. Este endpoint
          existe, verifica a assinatura HMAC quando <code className="mono">NEVONPAY_WEBHOOK_SECRET</code>{" "}
          está definido e, em qualquer caso, reconfirma o estado por consulta autenticada à API antes
          de alterar o pedido. URL: <code className="mono">{webhookUrlHint}</code>
        </span>
      </div>
      {webhooks.length === 0 ? (
        <div className="empty">Nenhum webhook recebido.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Recebido</th>
                <th>Evento</th>
                <th>Assinatura</th>
                <th>Processado</th>
                <th>Erro</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((hook) => (
                <tr key={hook.id}>
                  <td className="small">{formatDateTime(hook.received_at)}</td>
                  <td className="mono small">{hook.event_id}</td>
                  <td>
                    <span className={`pill ${hook.signature_ok ? "pill--green" : "pill--amber"}`}>
                      {hook.signature_ok ? "válida" : "não verificada"}
                    </span>
                  </td>
                  <td>
                    <span className={`pill ${hook.processed ? "pill--green" : "pill--grey"}`}>
                      {hook.processed ? "sim" : "não"}
                    </span>
                  </td>
                  <td className="small muted">{hook.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

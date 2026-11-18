"use client";

import { useState } from "react";

type Step = {
  id: string;
  label: string;
  status: "ok" | "error" | "warning" | "skipped";
  detail: string;
  httpStatus?: number;
  durationMs?: number;
  response?: unknown;
};

type Result = {
  environment: {
    configured: string;
    base_url: string;
    key_present: boolean;
    key_kind: string;
    key_length: number;
    key_preview: string | null;
    webhook_secret_configured: boolean;
    timeout_ms: number;
    documented_endpoints: string[];
    documented_methods: string[];
    webhook_documented: boolean;
  };
  steps: Step[];
  checked_at: string;
};

const BADGE: Record<Step["status"], string> = {
  ok: "pill--green",
  error: "pill--red",
  warning: "pill--amber",
  skipped: "pill--grey",
};

export function DiagnosticsPanel({ webhookUrl }: { webhookUrl: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(withTransaction: boolean) {
    setBusy(withTransaction ? "transacao" : "ligacao");
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/nevonpay/diagnostics${withTransaction ? "?teste=transacao" : ""}`,
        { cache: "no-store" }
      );
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error?.message ?? "Não foi possível executar o diagnóstico.");
        return;
      }
      setResult(json.data as Result);
    } catch {
      setError("Falha de rede ao executar o diagnóstico.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <div className="row row--between" style={{ marginBottom: 12 }}>
        <strong style={{ fontSize: "0.95rem" }}>Diagnóstico</strong>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn--green btn--sm" onClick={() => run(false)} disabled={Boolean(busy)}>
            {busy === "ligacao" ? <span className="spinner" /> : null}
            Testar ligação e autenticação
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => run(true)} disabled={Boolean(busy)}>
            {busy === "transacao" ? <span className="spinner" style={{ borderTopColor: "var(--ink)" }} /> : null}
            Criar transacção de teste
          </button>
        </div>
      </div>

      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}

      {!result ? (
        <p className="muted small">
          Executa o diagnóstico para verificar a ligação ao servidor Nevon Pay, o ambiente em uso, a
          autenticação com a chave secreta e, opcionalmente, criar e consultar uma transacção de
          teste.
        </p>
      ) : (
        <>
          <div className="grid grid--3" style={{ marginTop: 8 }}>
            <div className="kpi">
              <span>Ambiente</span>
              <strong style={{ fontSize: "1.1rem" }}>{result.environment.configured}</strong>
            </div>
            <div className="kpi">
              <span>Chave</span>
              <strong style={{ fontSize: "1.1rem" }}>{result.environment.key_kind}</strong>
              <div className="small muted">
                {result.environment.key_present
                  ? `${result.environment.key_length} caracteres · ${result.environment.key_preview}`
                  : "ausente"}
              </div>
            </div>
            <div className="kpi">
              <span>Webhook secret</span>
              <strong style={{ fontSize: "1.1rem" }}>
                {result.environment.webhook_secret_configured ? "configurado" : "não configurado"}
              </strong>
            </div>
          </div>

          <div className="small muted" style={{ margin: "10px 0 16px" }}>
            Host: <code className="mono">{result.environment.base_url}</code> · timeout{" "}
            {result.environment.timeout_ms} ms · verificado em{" "}
            {new Date(result.checked_at).toLocaleString("pt-PT")}
          </div>

          <div className="stack">
            {result.steps.map((step) => (
              <div key={step.id} className="card card--flat" style={{ padding: 16 }}>
                <div className="row row--between" style={{ marginBottom: 6 }}>
                  <strong style={{ fontSize: "0.9rem" }}>{step.label}</strong>
                  <div className="row" style={{ gap: 8 }}>
                    {step.httpStatus ? <span className="pill pill--grey">HTTP {step.httpStatus}</span> : null}
                    {step.durationMs ? <span className="pill pill--grey">{step.durationMs} ms</span> : null}
                    <span className={`pill ${BADGE[step.status]}`}>{step.status}</span>
                  </div>
                </div>
                <div className="small">{step.detail}</div>
                {step.response ? (
                  <details style={{ marginTop: 10 }}>
                    <summary className="small muted" style={{ cursor: "pointer" }}>
                      Ver resposta da API
                    </summary>
                    <pre
                      className="mono"
                      style={{
                        background: "var(--ink)",
                        color: "#d7e2dd",
                        padding: 14,
                        borderRadius: 10,
                        overflow: "auto",
                        fontSize: "0.76rem",
                        marginTop: 8,
                        maxHeight: 320,
                      }}
                    >
                      {JSON.stringify(step.response, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="divider" />

      <details>
        <summary className="small muted" style={{ cursor: "pointer" }}>
          Endpoints documentados e configuração
        </summary>
        <div className="stack" style={{ marginTop: 10 }}>
          <div>
            <strong className="small">Endpoints (README oficial)</strong>
            <ul className="small mono" style={{ marginTop: 4 }}>
              {(result?.environment.documented_endpoints ?? []).map((endpoint) => (
                <li key={endpoint}>{endpoint}</li>
              ))}
            </ul>
          </div>
          <div>
            <strong className="small">Métodos de pagamento</strong>
            <div className="small">
              {(result?.environment.documented_methods ?? ["sandbox", "mpesa", "emola"]).join(" · ")} —
              no sandbox apenas <code className="mono">sandbox</code> está activo; mpesa/emola
              respondem 503 PROVIDER_NOT_CONFIGURED.
            </div>
          </div>
          <div>
            <strong className="small">Webhook (não documentado)</strong>
            <div className="small">
              Endpoint da aplicação: <code className="mono">{webhookUrl}</code>. Sem{" "}
              <code className="mono">NEVONPAY_WEBHOOK_SECRET</code>, a assinatura não é verificável e o
              estado é sempre reconfirmado por consulta autenticada.
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

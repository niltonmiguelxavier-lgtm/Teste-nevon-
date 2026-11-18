"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatDateTime, formatMoney } from "@/lib/format";

type Transaction = {
  status: string;
  method: string;
  provider_payment_id: string | null;
  checkout_url: string | null;
  confirmed_at: string | null;
  created_at: string;
};

type Props = {
  reference: string;
  canPay: boolean;
  isPaid: boolean;
  transaction: Transaction | null;
  total: number;
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Aberto",
  PENDING: "À espera do pagamento",
  PROCESSING: "Em processamento",
  COMPLETED: "Concluído na Nevon Pay",
  FAILED: "Falhou",
  CANCELLED: "Cancelado",
  EXPIRED: "Expirado",
};

export function PaymentPanel({ reference, canPay, isPaid, transaction, total }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<string | null>(null);

  // Verificação automática enquanto o pagamento está pendente. O servidor
  // consulta a Nevon Pay — nada é confirmado localmente.
  useEffect(() => {
    if (isPaid || !transaction || transaction.status === "FAILED" || transaction.status === "EXPIRED") return;
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      try {
        const response = await fetch("/api/payments/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference }),
        });
        const json = await response.json();
        if (cancelled) return;
        setLastCheck(new Date().toISOString());
        if (response.ok && json?.data?.paid) router.refresh();
      } catch {
        /* silencioso: o estado continua a ser o último conhecido */
      }
    };
    run();
    const timer = setInterval(run, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isPaid, reference, router, transaction]);

  async function verifyNow() {
    setChecking(true);
    setError(null);
    try {
      const response = await fetch("/api/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference }),
      });
      const json = await response.json();
      setLastCheck(new Date().toISOString());
      if (!response.ok) {
        setError(json?.error?.message ?? "Não foi possível verificar agora.");
        return;
      }
      router.refresh();
    } finally {
      setChecking(false);
    }
  }

  async function payAgain() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, method: "SANDBOX" }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error?.message ?? "Não foi possível iniciar o pagamento.");
        return;
      }
      if (json.data.already_paid) {
        router.refresh();
        return;
      }
      window.location.href = json.data.checkout_url as string;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Pagamento</h3>

      {isPaid ? (
        <div className="notice notice--ok">
          <span>
            Pagamento confirmado pela Nevon Pay
            {transaction?.confirmed_at ? ` em ${formatDateTime(transaction.confirmed_at)}` : ""}.
          </span>
        </div>
      ) : (
        <p className="muted small">
          Total a pagar: <strong style={{ color: "var(--ink)" }}>{formatMoney(total)}</strong>
        </p>
      )}

      {transaction ? (
        <div style={{ marginTop: 8 }}>
          <div className="summary__row">
            <span>Estado na Nevon Pay</span>
            <span>{STATUS_LABELS[transaction.status] ?? transaction.status}</span>
          </div>
          <div className="summary__row">
            <span>Método</span>
            <span>{transaction.method}</span>
          </div>
          {transaction.provider_payment_id ? (
            <div className="summary__row">
              <span>ID do pagamento</span>
              <span className="mono small">{transaction.provider_payment_id}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="hint">Ainda não foi criada nenhuma cobrança para este pedido.</p>
      )}

      {error ? (
        <div className="form-error" style={{ marginTop: 12 }} role="alert">
          {error}
        </div>
      ) : null}

      {canPay ? (
        <div className="stack" style={{ marginTop: 14 }}>
          {transaction?.checkout_url &&
          ["OPEN", "PENDING"].includes(transaction.status) &&
          transaction.status !== "PROCESSING" ? (
            <a href={transaction.checkout_url} className="btn btn--green btn--block">
              Continuar pagamento
            </a>
          ) : null}
          {transaction && !["OPEN", "PENDING"].includes(transaction.status) ? (
            <p className="hint" style={{ marginTop: 4 }}>
              A sessão de pagamento anterior já não está activa ({STATUS_LABELS[transaction.status] ?? transaction.status}).
              Gera um novo pagamento para tentar outra vez.
            </p>
          ) : null}
          <button className="btn btn--green btn--block" onClick={payAgain} disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {transaction ? "Gerar novo pagamento" : "Pagar com Nevon Pay"}
          </button>
          <button className="btn btn--ghost btn--block" onClick={verifyNow} disabled={checking}>
            {checking ? <span className="spinner" style={{ borderTopColor: "var(--ink)" }} /> : null}
            Verificar estado agora
          </button>
        </div>
      ) : null}

      {!isPaid && transaction ? (
        <div className="notice notice--warn" style={{ marginTop: 12 }}>
          <span>
            <strong>Ambiente de testes.</strong> A página de pagamento da Nevon Pay é, por agora,
            apenas informativa: mostra o valor e o estado, mas <strong>não tem formulário de
            pagamento</strong> e não conclui cobranças (M-Pesa e e-Mola ainda não estão activados
            na gateway). Por isso o pedido fica em <em>Aguarda pagamento</em> — nada é marcado como
            pago sem uma confirmação real da Nevon Pay.
          </span>
        </div>
      ) : null}

      {!isPaid && transaction ? (
        <p className="hint" style={{ marginTop: 12 }}>
          Verificação automática a cada 15 segundos.
          {lastCheck ? ` Última: ${formatDateTime(lastCheck)}.` : ""} A confirmação vem sempre da API
          da Nevon Pay, nunca do simples regresso a esta página.
        </p>
      ) : null}
    </div>
  );
}

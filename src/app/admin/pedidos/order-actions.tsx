"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  orderId: string;
  status: string;
  paymentStatus: string;
  courierId: string | null;
  couriers: Array<{ id: string; name: string }>;
};

const NEXT_STATUS: Record<string, Array<{ value: string; label: string }>> = {
  RECEIVED: [{ value: "PREPARING", label: "Em preparação" }],
  PAYMENT_CONFIRMED: [{ value: "PREPARING", label: "Em preparação" }],
  PREPARING: [{ value: "OUT_FOR_DELIVERY", label: "Saiu para entrega" }],
  OUT_FOR_DELIVERY: [{ value: "DELIVERED", label: "Entregue" }],
};

export function OrderRowActions({ orderId, status, paymentStatus, courierId, couriers }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);

  async function call(url: string, body: unknown, method = "PATCH") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error?.message ?? "Operação recusada.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Falha de rede.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function verifyPayment() {
    setBusy(true);
    setError(null);
    setVerifyResult(null);
    try {
      // Confirmação apenas por consulta autenticada à Nevon Pay.
      const response = await fetch(`/api/payments/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: "" }),
      });
      const json = await response.json();
      setVerifyResult(
        response.ok
          ? `Estado na Nevon Pay: ${json.data.provider_status}`
          : (json?.error?.message ?? "Não foi possível verificar.")
      );
    } finally {
      setBusy(false);
    }
  }

  const options = NEXT_STATUS[status] ?? [];

  return (
    <div>
      <div className="row" style={{ gap: 8 }}>
        {options.map((option) => (
          <button
            key={option.value}
            className="btn btn--sm"
            disabled={busy}
            onClick={() => call(`/api/admin/orders/${orderId}`, { status: option.value })}
          >
            {option.label}
          </button>
        ))}

        {status !== "DELIVERED" && status !== "CANCELLED" ? (
          <button
            className="btn btn--sm btn--danger"
            disabled={busy}
            onClick={() => call(`/api/admin/orders/${orderId}`, { status: "CANCELLED" })}
          >
            Cancelar
          </button>
        ) : null}

        <select
          className="btn btn--ghost btn--sm"
          value={courierId ?? ""}
          disabled={busy}
          onChange={(event) =>
            call(`/api/admin/orders/${orderId}`, { courierId: event.target.value || null }, "POST")
          }
          aria-label="Atribuir entregador"
          style={{ paddingRight: 8 }}
        >
          <option value="">Sem entregador</option>
          {couriers.map((courier) => (
            <option key={courier.id} value={courier.id}>
              {courier.name}
            </option>
          ))}
        </select>

        {paymentStatus !== "PAID" ? (
          <button className="btn btn--ghost btn--sm" disabled={busy} onClick={verifyPayment}>
            Verificar na Nevon Pay
          </button>
        ) : null}
      </div>

      {verifyResult ? (
        <div className="notice notice--info" style={{ marginTop: 10 }}>
          <span>{verifyResult}</span>
        </div>
      ) : null}
      {error ? (
        <div className="form-error" style={{ marginTop: 10 }} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

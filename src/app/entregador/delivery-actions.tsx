"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  orderId: string;
  status: string;
  action: "OUT_FOR_DELIVERY" | "DELIVERED";
};

export function DeliveryActions({ orderId, status, action }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/courier/deliveries/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action, note: note || undefined }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error?.message ?? "Não foi possível actualizar.");
        return;
      }
      setNote("");
      router.refresh();
    } catch {
      setError("Falha de rede.");
    } finally {
      setBusy(false);
    }
  }

  const label =
    action === "OUT_FOR_DELIVERY"
      ? status === "PREPARING"
        ? "Marcar como recolhido"
        : "Marcar como em trânsito"
      : "Marcar como entregue";

  return (
    <div>
      <div className="row" style={{ gap: 8 }}>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Observação (opcional)"
          aria-label="Observação da entrega"
          style={{
            flex: 1,
            minWidth: 180,
            padding: "9px 12px",
            border: "1px solid var(--paper-line)",
            borderRadius: 8,
          }}
        />
        <button className="btn btn--green btn--sm" onClick={submit} disabled={busy}>
          {busy ? <span className="spinner" /> : null}
          {label}
        </button>
      </div>
      {error ? (
        <div className="form-error" style={{ marginTop: 10 }} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

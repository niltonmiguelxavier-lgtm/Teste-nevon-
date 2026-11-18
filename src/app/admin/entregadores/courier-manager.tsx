"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Courier = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  active: boolean;
  deliveries: string;
  delivered: string;
  active_deliveries: string;
};

export function CourierManager({ couriers }: { couriers: Courier[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/couriers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error?.message ?? "Não foi possível criar o entregador.");
        return;
      }
      setMessage("Entregador criado com acesso ao painel em /entregador.");
      setForm({ name: "", email: "", phone: "", password: "" });
      router.refresh();
    } catch {
      setError("Falha de rede.");
    } finally {
      setBusy(false);
    }
  }

  async function update(id: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/couriers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...payload }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error?.message ?? "Não foi possível actualizar.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="card" onSubmit={create} noValidate>
        <strong style={{ fontSize: "0.95rem" }}>Novo entregador</strong>
        <div className="field-row field-row--3" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="c-name">Nome</label>
            <input
              id="c-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="c-email">Email</label>
            <input
              id="c-email"
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="c-phone">Telefone</label>
            <input
              id="c-phone"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              placeholder="84 123 4567"
              required
            />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="c-password">Palavra-passe inicial</label>
            <input
              id="c-password"
              type="text"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              placeholder="Mínimo 8 caracteres"
              required
            />
          </div>
        </div>

        {error ? <div className="form-error" role="alert">{error}</div> : null}
        {message ? <div className="form-ok">{message}</div> : null}

        <button className="btn btn--green btn--sm" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : null}
          Criar entregador
        </button>
      </form>

      <div className="table-wrap" style={{ marginTop: 20 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Entregador</th>
              <th>Contacto</th>
              <th className="right">Entregas</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {couriers.map((courier) => (
              <tr key={courier.id}>
                <td>
                  <strong style={{ fontSize: "0.88rem" }}>{courier.name}</strong>
                </td>
                <td className="small">
                  {courier.email}
                  <br />
                  <span className="mono">{courier.phone ?? "—"}</span>
                </td>
                <td className="right">
                  {courier.delivered}/{courier.deliveries}
                  <div className="small muted">{courier.active_deliveries} activas</div>
                </td>
                <td>
                  <span className={`pill ${courier.active ? "pill--green" : "pill--red"}`}>
                    {courier.active ? "activo" : "suspenso"}
                  </span>
                </td>
                <td className="right">
                  <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                    <button
                      className="btn btn--ghost btn--sm"
                      disabled={busy}
                      onClick={() => update(courier.id, { active: !courier.active })}
                    >
                      {courier.active ? "Suspender" : "Reactivar"}
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => setResetFor(resetFor === courier.id ? null : courier.id)}
                    >
                      Nova palavra-passe
                    </button>
                  </div>
                  {resetFor === courier.id ? (
                    <div className="row" style={{ gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
                      <input
                        type="text"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        placeholder="Nova palavra-passe"
                        style={{
                          padding: "7px 10px",
                          border: "1px solid var(--paper-line)",
                          borderRadius: 8,
                          width: 170,
                        }}
                      />
                      <button
                        className="btn btn--sm"
                        disabled={busy || newPassword.length < 8}
                        onClick={async () => {
                          await update(courier.id, { password: newPassword });
                          setNewPassword("");
                          setResetFor(null);
                        }}
                      >
                        Guardar
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatMoney, type CartLine } from "@/lib/format";

type Method = { id: string; label: string; description: string; requirement: string | null };

type SavedAddress = {
  label: string | null;
  recipient: string;
  phone: string;
  street: string;
  number: string | null;
  neighbourhood: string | null;
  city: string;
  reference: string | null;
};

type Props = {
  lines: CartLine[];
  subtotal: number;
  fee: number;
  promoCode: string;
  methods: Method[];
  customer: { name: string; email: string; phone: string };
  savedAddresses: SavedAddress[];
};

export function CheckoutForm({ lines, subtotal, fee, promoCode, methods, customer, savedAddresses }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"dados" | "pagamento">("dados");
  const [order, setOrder] = useState<{ reference: string; id: string } | null>(null);
  const [method, setMethod] = useState("SANDBOX");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [delivery, setDelivery] = useState({
    recipient: customer.name,
    phone: customer.phone,
    street: "",
    number: "",
    neighbourhood: "",
    city: "Maputo",
    reference: "",
  });
  const [notes, setNotes] = useState("");

  const total = subtotal + fee;

  function useSavedAddress(address: SavedAddress) {
    setDelivery({
      recipient: address.recipient,
      phone: address.phone,
      street: address.street,
      number: address.number ?? "",
      neighbourhood: address.neighbourhood ?? "",
      city: address.city,
      reference: address.reference ?? "",
    });
  }

  async function createOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
          delivery,
          notes,
          promoCode: promoCode || undefined,
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        if (Array.isArray(json?.error?.details)) {
          const map: Record<string, string> = {};
          for (const detail of json.error.details) map[detail.field] = detail.problem;
          setFieldErrors(map);
        }
        setError(json?.error?.message ?? "Não foi possível criar o pedido.");
        return;
      }
      setOrder({ reference: json.data.order.reference, id: json.data.order.id });
      setStep("pagamento");
      // Limpa o carrinho no servidor (novo cookie sem linhas)
      await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      router.refresh();
    } catch {
      setError("Falha de rede ao criar o pedido.");
    } finally {
      setBusy(false);
    }
  }

  async function startPayment() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: order.reference, method }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json?.error?.message ?? "Não foi possível iniciar o pagamento.");
        return;
      }
      if (json.data.already_paid) {
        router.push(`/pedido/${order.reference}`);
        return;
      }
      // Redirecciona para o checkout hospedado da Nevon Pay. Nota: o regresso
      // desta página NÃO confirma o pagamento.
      window.location.href = json.data.checkout_url as string;
    } catch {
      setError("Falha de rede ao iniciar o pagamento.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "pagamento" && order) {
    return (
      <div className="cart-layout">
        <div>
          <div className="notice notice--ok">
            <span>
              Pedido <strong className="mono">{order.reference}</strong> criado e registado. Falta
              apenas o pagamento.
            </span>
          </div>

          <div className="card">
            <h3>Método de pagamento</h3>
            <p className="muted small">
              Métodos documentados pela API Nevon Pay. No ambiente sandbox apenas o método{" "}
              <code className="mono">sandbox</code> está activo.
            </p>

            <div className="pay-methods" style={{ marginTop: 14 }}>
              {methods.map((item) => (
                <label
                  key={item.id}
                  className={`pay-method ${method === item.id ? "pay-method--active" : ""}`}
                >
                  <input
                    type="radio"
                    name="method"
                    value={item.id}
                    checked={method === item.id}
                    onChange={() => setMethod(item.id)}
                  />
                  <span>
                    <b>{item.label}</b>
                    <span>{item.description}</span>
                    {item.requirement ? <em>⚠ {item.requirement}</em> : null}
                  </span>
                </label>
              ))}
            </div>

            {error ? (
              <div className="form-error" style={{ marginTop: 14 }} role="alert">
                {error}
              </div>
            ) : null}

            <div style={{ marginTop: 18 }}>
              <button className="btn btn--green btn--block" onClick={startPayment} disabled={busy}>
                {busy ? <span className="spinner" /> : null}
                Pagar {formatMoney(total)} com Nevon Pay
              </button>
            </div>
            <p className="hint" style={{ marginTop: 12 }}>
              Vais ser encaminhado para o ambiente de pagamento da Nevon Pay. O pedido só será
              marcado como pago após confirmação autenticada da Nevon Pay ao nosso servidor.
            </p>
          </div>
        </div>

        <aside className="summary">
          <h3 style={{ marginBottom: 12 }}>Pedido {order.reference}</h3>
          <div className="summary__row">
            <span>Subtotal</span>
            <span>{formatMoney(subtotal)}</span>
          </div>
          <div className="summary__row">
            <span>Entrega</span>
            <span>{fee === 0 ? "Grátis" : formatMoney(fee)}</span>
          </div>
          <div className="summary__row summary__row--total">
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>
          <a href={`/pedido/${order.reference}`} className="btn btn--ghost btn--block" style={{ marginTop: 16 }}>
            Ver estado do pedido
          </a>
        </aside>
      </div>
    );
  }

  return (
    <div className="cart-layout">
      <form onSubmit={createOrder} method="post" noValidate>
        {savedAddresses.length > 0 ? (
          <div className="card card--flat" style={{ marginBottom: 16 }}>
            <strong style={{ fontSize: "0.9rem" }}>Endereços guardados</strong>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              {savedAddresses.map((address, index) => (
                <button
                  key={`${address.street}-${index}`}
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => useSavedAddress(address)}
                >
                  {address.street}
                  {address.number ? `, ${address.number}` : ""} · {address.city}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="card">
          <h3>Endereço de entrega</h3>
          <div className="field-row">
            <div className="field">
              <label htmlFor="recipient">Quem recebe</label>
              <input
                id="recipient"
                name="recipient" autoComplete="name"
                value={delivery.recipient}
                onChange={(event) => setDelivery({ ...delivery, recipient: event.target.value })}
                required
              />
              {fieldErrors["delivery.recipient"] ? (
                <span className="field__error">{fieldErrors["delivery.recipient"]}</span>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="phone">Telefone de contacto</label>
              <input
                id="phone"
                name="delivery_phone" autoComplete="tel"
                value={delivery.phone}
                onChange={(event) => setDelivery({ ...delivery, phone: event.target.value })}
                placeholder="84 123 4567"
                required
              />
              {fieldErrors["delivery.phone"] ? (
                <span className="field__error">{fieldErrors["delivery.phone"]}</span>
              ) : null}
            </div>
          </div>

          <div className="field-row--3 field-row">
            <div className="field">
              <label htmlFor="street">Avenida / Rua</label>
              <input
                id="street"
                name="street" autoComplete="address-line1"
                value={delivery.street}
                onChange={(event) => setDelivery({ ...delivery, street: event.target.value })}
                placeholder="Av. Julius Nyerere"
                required
              />
              {fieldErrors["delivery.street"] ? (
                <span className="field__error">{fieldErrors["delivery.street"]}</span>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="number">Nº</label>
              <input
                id="number"
                name="number" autoComplete="address-line2"
                value={delivery.number}
                onChange={(event) => setDelivery({ ...delivery, number: event.target.value })}
                placeholder="1240"
              />
            </div>
            <div className="field">
              <label htmlFor="neighbourhood">Bairro</label>
              <input
                id="neighbourhood"
                name="neighbourhood" autoComplete="address-level3"
                value={delivery.neighbourhood}
                onChange={(event) => setDelivery({ ...delivery, neighbourhood: event.target.value })}
                placeholder="Sommerschield"
              />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="city">Cidade</label>
              <select
                id="city"
                name="city" autoComplete="address-level2"
                value={delivery.city}
                onChange={(event) => setDelivery({ ...delivery, city: event.target.value })}
              >
                <option>Maputo</option>
                <option>Matola</option>
                <option>Marracuene</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="reference">Ponto de referência</label>
              <input
                id="reference"
                value={delivery.reference}
                onChange={(event) => setDelivery({ ...delivery, reference: event.target.value })}
                placeholder="Portão verde, ao lado da farmácia"
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="notes">Notas para o entregador (opcional)</label>
            <textarea
              id="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Ex.: ligar quando chegar à portaria"
            />
          </div>

          {error ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}

          <button className="btn btn--green btn--block" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            Confirmar pedido · {formatMoney(total)}
          </button>
        </div>
      </form>

      <aside className="summary">
        <h3 style={{ marginBottom: 12 }}>Resumo</h3>
        {lines.map((line) => (
          <div key={line.productId} className="summary__row">
            <span>
              {line.quantity}× {line.name}
            </span>
            <span>{formatMoney(line.priceCents * line.quantity)}</span>
          </div>
        ))}
        <div className="summary__row">
          <span>Subtotal</span>
          <span>{formatMoney(subtotal)}</span>
        </div>
        <div className="summary__row">
          <span>Entrega</span>
          <span>{fee === 0 ? "Grátis" : formatMoney(fee)}</span>
        </div>
        {promoCode ? (
          <div className="summary__row">
            <span>Código</span>
            <span className="mono">{promoCode}</span>
          </div>
        ) : null}
        <div className="summary__row summary__row--total">
          <span>Total</span>
          <span>{formatMoney(total)}</span>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          Descontos promocionais são aplicados no servidor ao confirmar o pedido.
        </p>
      </aside>
    </div>
  );
}

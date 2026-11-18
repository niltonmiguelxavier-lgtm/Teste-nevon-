"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatMoney, type CartLine } from "@/lib/format";

type Props = {
  initialLines: CartLine[];
  initialPromo: string;
  initialSubtotal: number;
  initialFee: number;
};

export function CartEditor({ initialLines, initialPromo, initialSubtotal, initialFee }: Props) {
  const router = useRouter();
  const [lines, setLines] = useState(initialLines);
  const [promo, setPromo] = useState(initialPromo);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const subtotal = useMemo(
    () => lines.reduce((total, line) => total + line.priceCents * line.quantity, 0),
    [lines]
  );
  const fee = subtotal >= 150_000 || subtotal === 0 ? 0 : 15_000;
  const total = subtotal + fee;

  async function setQuantity(productId: string, quantity: number) {
    setBusy(productId);
    setMessage(null);
    try {
      const response = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set", productId, quantity }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "Não foi possível actualizar.");
      setLines(json.data.lines);
      router.refresh();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Erro" });
    } finally {
      setBusy(null);
    }
  }

  async function remove(productId: string) {
    setBusy(productId);
    try {
      const response = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", productId }),
      });
      const json = await response.json();
      if (response.ok) {
        setLines(json.data.lines);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function applyPromo() {
    setBusy("promo");
    setMessage(null);
    try {
      await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-promo", promoCode: promo }),
      });
      setMessage({
        kind: "ok",
        text: promo
          ? "Código guardado. Será validado no servidor ao confirmar o pedido."
          : "Código removido.",
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="cart-layout">
      <div>
        <div className="card card--flat" style={{ padding: "4px 20px" }}>
          {lines.map((line) => (
            <div key={line.productId} className="cart-line">
              <div className="cart-line__media">
                {line.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={line.imageUrl} alt={line.name} />
                ) : (
                  "📦"
                )}
              </div>
              <div>
                <strong style={{ fontSize: "0.95rem" }}>{line.name}</strong>
                <div className="small muted">{formatMoney(line.priceCents)} / unidade</div>
              </div>
              <div className="qty">
                <button
                  type="button"
                  aria-label={`Diminuir ${line.name}`}
                  disabled={busy === line.productId}
                  onClick={() => setQuantity(line.productId, line.quantity - 1)}
                >
                  −
                </button>
                <span>{line.quantity}</span>
                <button
                  type="button"
                  aria-label={`Aumentar ${line.name}`}
                  disabled={busy === line.productId}
                  onClick={() => setQuantity(line.productId, line.quantity + 1)}
                >
                  +
                </button>
              </div>
              <div className="right">
                <strong>{formatMoney(line.priceCents * line.quantity)}</strong>
                <div>
                  <button
                    type="button"
                    className="small"
                    style={{
                      background: "none",
                      border: 0,
                      color: "var(--red)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                    onClick={() => remove(line.productId)}
                  >
                    Remover
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="row row--between" style={{ marginTop: 18 }}>
          <form
            className="row"
            style={{ gap: 8 }}
            onSubmit={(event) => {
              event.preventDefault();
              applyPromo();
            }}
          >
            <input
              value={promo}
              onChange={(event) => setPromo(event.target.value.toUpperCase())}
              placeholder="Código promocional"
              aria-label="Código promocional"
              style={{
                padding: "10px 12px",
                border: "1px solid var(--paper-line)",
                borderRadius: 9,
                minWidth: 200,
              }}
            />
            <button className="btn btn--ghost btn--sm" type="submit" disabled={busy === "promo"}>
              Aplicar
            </button>
          </form>
          <Link href="/produtos" className="btn btn--ghost btn--sm">
            + Adicionar produtos
          </Link>
        </div>

        {message ? (
          <div className={`notice ${message.kind === "ok" ? "notice--ok" : "notice--error"}`} style={{ marginTop: 14 }}>
            <span>{message.text}</span>
          </div>
        ) : null}
      </div>

      <aside className="summary">
        <h3 style={{ marginBottom: 14 }}>Resumo</h3>
        <div className="summary__row">
          <span>Subtotal</span>
          <span>{formatMoney(subtotal)}</span>
        </div>
        <div className="summary__row">
          <span>Entrega</span>
          <span>{fee === 0 ? "Grátis" : formatMoney(fee)}</span>
        </div>
        <div className="summary__row">
          <span>Código promocional</span>
          <span>{promo || "—"}</span>
        </div>
        <div className="summary__row summary__row--total">
          <span>Total</span>
          <span>{formatMoney(total)}</span>
        </div>
        <div style={{ marginTop: 18 }}>
          <Link href="/finalizar" className="btn btn--green btn--block">
            Finalizar pedido
          </Link>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          O valor final é recalculado no servidor com os preços actuais e o código promocional é
          validado antes do pagamento.
        </p>
      </aside>
    </div>
  );
}

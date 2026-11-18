import Link from "next/link";
import { cookies } from "next/headers";
import { CART_COOKIE, readCartFromCookie } from "@/lib/cart";
import { deliveryFeeFor, formatMoney, subtotalOf } from "@/lib/format";
import { CartEditor } from "./cart-editor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Carrinho" };

export default async function CartPage() {
  const store = await cookies();
  const cart = readCartFromCookie(store.get(CART_COOKIE)?.value);
  const subtotal = subtotalOf(cart.lines);
  const fee = deliveryFeeFor(subtotal);

  return (
    <div className="section">
      <div className="container">
        <div className="section-head">
          <div>
            <span className="eyebrow">Carrinho</span>
            <h1 style={{ fontSize: "clamp(1.7rem, 3vw, 2.3rem)" }}>O teu pedido</h1>
          </div>
          <Link href="/produtos" className="btn btn--ghost btn--sm">
            Continuar a comprar
          </Link>
        </div>

        {cart.lines.length === 0 ? (
          <div className="empty">
            O carrinho está vazio.
            <div style={{ marginTop: 16 }}>
              <Link href="/produtos" className="btn btn--green">
                Ver produtos
              </Link>
            </div>
          </div>
        ) : (
          <CartEditor
            initialLines={cart.lines}
            initialPromo={cart.promoCode ?? ""}
            initialSubtotal={subtotal}
            initialFee={fee}
          />
        )}

        <div className="notice notice--info" style={{ marginTop: 26 }}>
          <span>
            O custo de entrega é calculado no servidor: <strong>150 MT</strong> e gratuito em
            encomendas acima de <strong>1.500 MT</strong>. Zoneamos Maputo cidade, Matola e arredores.
          </span>
        </div>
      </div>
    </div>
  );
}

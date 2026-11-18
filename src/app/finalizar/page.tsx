import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { CART_COOKIE, readCartFromCookie } from "@/lib/cart";
import { query } from "@/lib/db";
import { deliveryFeeFor, formatMoney, subtotalOf } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/payments";
import { CheckoutForm } from "./checkout-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Finalizar pedido" };

export default async function CheckoutPage() {
  const user = await currentUser();
  if (!user) redirect("/entrar?next=/finalizar");
  if (user.role !== "CUSTOMER") redirect(user.role === "ADMIN" ? "/admin" : "/entregador");

  const store = await cookies();
  const cart = readCartFromCookie(store.get(CART_COOKIE)?.value);
  if (cart.lines.length === 0) redirect("/carrinho");

  // Preços sempre relidos da base de dados
  const products = await query<{ id: string; name: string; price_cents: number; stock: number; active: boolean }>(
    `SELECT id, name, price_cents, stock, active FROM products WHERE id = ANY($1::uuid[])`,
    [cart.lines.map((line) => line.productId)]
  );
  const byId = new Map(products.map((product) => [product.id, product]));

  const lines = cart.lines
    .map((line) => {
      const product = byId.get(line.productId);
      if (!product || !product.active) return null;
      return { ...line, name: product.name, priceCents: product.price_cents };
    })
    .filter(Boolean) as typeof cart.lines;

  if (lines.length === 0) redirect("/carrinho");

  const subtotal = subtotalOf(lines);
  const fee = deliveryFeeFor(subtotal);

  const addresses = await query<{
    label: string | null;
    recipient: string;
    phone: string;
    street: string;
    number: string | null;
    neighbourhood: string | null;
    city: string;
    reference: string | null;
  }>(
    `SELECT label, recipient, phone, street, number, neighbourhood, city, reference
       FROM addresses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [user.id]
  );

  const methods = PAYMENT_METHODS.map((method) => ({
    id: method.id,
    label: method.label,
    description: method.description,
    requirement: method.requirement ?? null,
  }));

  return (
    <div className="section">
      <div className="container">
        <div className="section-head">
          <div>
            <span className="eyebrow">Passo final</span>
            <h1 style={{ fontSize: "clamp(1.7rem, 3vw, 2.3rem)" }}>Finalizar pedido</h1>
            <p className="lead">Confirma o endereço, o telefone e o método de pagamento.</p>
          </div>
          <Link href="/carrinho" className="btn btn--ghost btn--sm">
            Voltar ao carrinho
          </Link>
        </div>

        <CheckoutForm
          lines={lines}
          subtotal={subtotal}
          fee={fee}
          promoCode={cart.promoCode ?? ""}
          methods={methods}
          customer={{ name: user.name, email: user.email, phone: user.phone ?? "" }}
          savedAddresses={addresses}
        />

        <div className="notice notice--info" style={{ marginTop: 24 }}>
          <span>
            <strong>Como o pagamento é confirmado:</strong> depois de criares o pedido, vais pagar no
            ambiente seguro da Nevon Pay. O pedido só passa a <em>Pagamento confirmado</em> quando a
            Nevon Pay devolve, numa resposta autenticada ao nosso servidor, o estado{" "}
            <code className="mono">COMPLETED</code>. Voltar à página de sucesso não confirma nada.
          </span>
        </div>
      </div>

      <div className="container" style={{ marginTop: 18 }}>
        <div className="card card--flat">
          <strong style={{ fontSize: "0.92rem" }}>Resumo dos artigos</strong>
          <div style={{ marginTop: 10 }}>
            {lines.map((line) => (
              <div key={line.productId} className="summary__row">
                <span>
                  {line.quantity}× {line.name}
                </span>
                <span>{formatMoney(line.priceCents * line.quantity)}</span>
              </div>
            ))}
            <div className="summary__row">
              <span>Entrega</span>
              <span>{fee === 0 ? "Grátis" : formatMoney(fee)}</span>
            </div>
            <div className="summary__row summary__row--total">
              <span>Total a pagar</span>
              <span>{formatMoney(subtotal + fee)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

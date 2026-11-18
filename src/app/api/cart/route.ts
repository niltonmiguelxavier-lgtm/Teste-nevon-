import { cookies } from "next/headers";
import { CART_COOKIE, readCartFromCookie, serializeCart, emptyCart } from "@/lib/cart";
import { query } from "@/lib/db";
import { deliveryFeeFor, subtotalOf, type CartState } from "@/lib/format";
import { errorJson, okJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

/**
 * Carrinho. Os preços enviados pelo cliente são ignorados: em cada operação
 * voltamos a ler o preço real da base de dados.
 */
export async function GET() {
  const store = await cookies();
  const cart = readCartFromCookie(store.get(CART_COOKIE)?.value);
  if (cart.lines.length === 0) {
    return okJson({ lines: [], subtotal_cents: 0, delivery_fee_cents: 0, total_cents: 0 });
  }

  const products = await query<{ id: string; name: string; price_cents: number; active: boolean; stock: number }>(
    `SELECT id, name, price_cents, active, stock FROM products WHERE id = ANY($1::uuid[])`,
    [cart.lines.map((line) => line.productId)]
  );
  const byId = new Map(products.map((product) => [product.id, product]));

  const lines = cart.lines
    .filter((line) => byId.get(line.productId)?.active)
    .map((line) => {
      const product = byId.get(line.productId)!;
      return {
        ...line,
        name: product.name,
        priceCents: product.price_cents,
        available: product.stock >= line.quantity,
      };
    });

  const subtotal = subtotalOf(lines);
  const deliveryFee = deliveryFeeFor(subtotal);

  return okJson({
    lines,
    subtotal_cents: subtotal,
    delivery_fee_cents: deliveryFee,
    total_cents: subtotal + deliveryFee,
  });
}

export async function POST(request: Request) {
  const store = await cookies();
  const cart = readCartFromCookie(store.get(CART_COOKIE)?.value);

  let body: { action?: string; productId?: string; quantity?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorJson("VALIDATION_ERROR", "Corpo inválido.", { status: 400 });
  }

  if (body.action === "clear") {
    store.set(CART_COOKIE, serializeCart(emptyCart()), COOKIE_OPTIONS);
    return okJson({ lines: [], cart_count: 0 });
  }

  if (body.action === "set-promo") {
    const code = (body as { promoCode?: string }).promoCode?.trim().toUpperCase() || null;
    const nextCart: CartState = { ...cart, promoCode: code };
    store.set(CART_COOKIE, serializeCart(nextCart), COOKIE_OPTIONS);
    return okJson({ promo_code: code });
  }

  const productId = body.productId;
  const quantity = Number(body.quantity ?? 1);
  if (!productId || !Number.isFinite(quantity)) {
    return errorJson("VALIDATION_ERROR", "Produto ou quantidade inválidos.", { status: 400 });
  }
  // `set` define a quantidade exacta (usado pelos botões − / +). Quantidade 0
  // remove a linha. `add` incrementa a partir do valor actual.
  const mode = body.action === "set" ? "set" : "add";
  if (mode === "add" && quantity < 1) {
    return errorJson("VALIDATION_ERROR", "Produto ou quantidade inválidos.", { status: 400 });
  }

  const product = await query<{
    id: string;
    name: string;
    slug: string;
    price_cents: number;
    image_url: string | null;
    stock: number;
    active: boolean;
  }>(`SELECT id, name, slug, price_cents, image_url, stock, active FROM products WHERE id = $1`, [productId]);

  const found = product[0];
  if (!found || !found.active) {
    return errorJson("PRODUCT_UNAVAILABLE", "Produto indisponível.", { status: 404 });
  }

  const lines = [...cart.lines];
  const index = lines.findIndex((line) => line.productId === productId);

  if (body.action === "remove" || (mode === "set" && quantity <= 0)) {
    if (index >= 0) lines.splice(index, 1);
  } else if (mode === "set") {
    const nextQuantity = Math.min(Math.trunc(quantity), Math.min(found.stock, 99));
    if (index >= 0) {
      lines[index] = { ...lines[index], quantity: nextQuantity, priceCents: found.price_cents, name: found.name };
    } else if (nextQuantity > 0) {
      lines.push({
        productId: found.id,
        slug: found.slug,
        name: found.name,
        priceCents: found.price_cents,
        quantity: nextQuantity,
        imageUrl: found.image_url,
      });
    }
  } else if (index >= 0) {
    lines[index] = {
      ...lines[index],
      quantity: Math.min(lines[index].quantity + Math.trunc(quantity), Math.min(found.stock, 99)),
      priceCents: found.price_cents,
      name: found.name,
    };
  } else {
    lines.push({
      productId: found.id,
      slug: found.slug,
      name: found.name,
      priceCents: found.price_cents,
      quantity: Math.min(Math.trunc(quantity), Math.min(found.stock, 99)) || 1,
      imageUrl: found.image_url,
    });
  }

  const nextCart: CartState = { ...cart, lines };
  store.set(CART_COOKIE, serializeCart(nextCart), COOKIE_OPTIONS);

  return okJson({
    lines,
    cart_count: lines.reduce((total, line) => total + line.quantity, 0),
    subtotal_cents: subtotalOf(lines),
  });
}

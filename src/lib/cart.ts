import type { CartLine, CartState } from "./format";

/** Carrinho guardado num cookie (apenas ids, quantidades e preços de referência). */

export const CART_COOKIE = "express_cart";

export function emptyCart(): CartState {
  return { lines: [], promoCode: null, discountCents: 0 };
}

export function readCartFromCookie(raw: string | undefined): CartState {
  if (!raw) return emptyCart();
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as CartState;
    if (!Array.isArray(parsed.lines)) return emptyCart();
    const lines: CartLine[] = parsed.lines
      .filter((line) => line && typeof line.productId === "string" && typeof line.quantity === "number")
      .map((line) => ({
        productId: line.productId,
        slug: String(line.slug ?? ""),
        name: String(line.name ?? ""),
        priceCents: Number(line.priceCents) || 0,
        quantity: Math.min(Math.max(Math.trunc(line.quantity), 1), 99),
        imageUrl: line.imageUrl ?? null,
      }))
      .slice(0, 50);
    return {
      lines,
      promoCode: parsed.promoCode ?? null,
      discountCents: Number(parsed.discountCents ?? 0),
    };
  } catch {
    return emptyCart();
  }
}

export function serializeCart(cart: CartState) {
  return encodeURIComponent(JSON.stringify(cart));
}

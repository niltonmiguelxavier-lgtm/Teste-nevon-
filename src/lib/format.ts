import type { SessionUser } from "./auth";

/** Formatação e regras partilhadas entre servidor e cliente. */

export const CURRENCY = "MZN";

export function formatMoney(cents: number, currency = CURRENCY) {
  const value = (cents / 100).toLocaleString("pt-MZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value} MT`;
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  RECEIVED: "Pedido recebido",
  PAYMENT_CONFIRMED: "Pagamento confirmado",
  PREPARING: "Em preparação",
  OUT_FOR_DELIVERY: "Saiu para entrega",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelado",
};

export const ORDER_FLOW = [
  "RECEIVED",
  "PAYMENT_CONFIRMED",
  "PREPARING",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Aguardando pagamento",
  PAID: "Pago",
  FAILED: "Falhou",
  CANCELLED: "Cancelado",
  EXPIRED: "Expirado",
};

export const ROLE_LABELS: Record<string, string> = {
  CUSTOMER: "Cliente",
  COURIER: "Entregador",
  ADMIN: "Administrador",
};

export type CartLine = {
  productId: string;
  slug: string;
  name: string;
  priceCents: number;
  quantity: number;
  imageUrl?: string | null;
};

export type CartState = {
  lines: CartLine[];
  promoCode?: string | null;
  discountCents?: number;
};

export function subtotalOf(lines: CartLine[]) {
  return lines.reduce((total, line) => total + line.priceCents * line.quantity, 0);
}

/** Taxa de entrega: gratuita acima de 1500 MT, caso contrário 150 MT. */
export function deliveryFeeFor(subtotalCents: number) {
  if (subtotalCents <= 0) return 0;
  return subtotalCents >= 150_000 ? 0 : 15_000;
}

/** Limite de uma encomenda codificada no cookie do carrinho. */
export type SessionLike = Pick<SessionUser, "id" | "role" | "name" | "email">;

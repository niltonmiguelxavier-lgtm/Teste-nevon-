import { ZodError } from "zod";
import { currentUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { deliveryFeeFor } from "@/lib/format";
import { clientIp, errorJson, okJson, rateLimit, validationError } from "@/lib/http";
import { addOrderEvent, audit, newOrderReference, notify, type OrderRow } from "@/lib/orders";
import { createOrderSchema } from "@/lib/validation";
import { CURRENCY } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cria um pedido. O total é calculado exclusivamente no servidor com os preços
 * da base de dados — o cliente nunca envia valores monetários.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return errorJson("UNAUTHENTICATED", "Inicie sessão para concluir o pedido.", { status: 401 });
  }
  const limit = rateLimit(`order:${user.id}`, 12, 120);
  if (!limit.allowed) {
    return errorJson("RATE_LIMITED", "Demasiados pedidos em pouco tempo. Aguarde um instante.", {
      status: 429,
    });
  }

  try {
    const input = createOrderSchema.parse(await request.json());

    // Consolida linhas repetidas do mesmo produto
    const quantities = new Map<string, number>();
    for (const item of input.items) {
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    }
    const productIds = [...quantities.keys()];

    const products = await query<{
      id: string;
      name: string;
      price_cents: number;
      stock: number;
      active: boolean;
    }>(`SELECT id, name, price_cents, stock, active FROM products WHERE id = ANY($1::uuid[])`, [
      productIds,
    ]);

    if (products.length !== productIds.length) {
      return errorJson("PRODUCT_NOT_FOUND", "Um dos produtos já não está disponível.", { status: 409 });
    }
    const inactive = products.find((p) => !p.active);
    if (inactive) {
      return errorJson("PRODUCT_UNAVAILABLE", `O produto "${inactive.name}" está indisponível.`, {
        status: 409,
      });
    }
    const outOfStock = products.find((p) => p.stock < (quantities.get(p.id) ?? 0));
    if (outOfStock) {
      return errorJson("OUT_OF_STOCK", `Stock insuficiente para "${outOfStock.name}".`, { status: 409 });
    }

    const lines = products.map((product) => {
      const quantity = quantities.get(product.id)!;
      return {
        productId: product.id,
        name: product.name,
        unitPriceCents: product.price_cents,
        quantity,
        lineTotalCents: product.price_cents * quantity,
      };
    });

    const subtotal = lines.reduce((total, line) => total + line.lineTotalCents, 0);

    // Promoções: apenas códigos COUPON válidos, validados no servidor.
    let discount = 0;
    let appliedPromo: string | null = null;
    if (input.promoCode) {
      const promo = await query<{
        code: string;
        percent_off: number | null;
        amount_off_cents: number | null;
        min_total_cents: number;
      }>(
        `SELECT code, percent_off, amount_off_cents, min_total_cents
           FROM promos
          WHERE active AND kind = 'COUPON' AND upper(code) = upper($1)
            AND (starts_at IS NULL OR starts_at <= now())
            AND (ends_at IS NULL OR ends_at >= now())
          LIMIT 1`,
        [input.promoCode]
      );
      const found = promo[0];
      if (!found) {
        return errorJson("INVALID_PROMO", "Código promocional inválido ou expirado.", { status: 400 });
      }
      if (subtotal < found.min_total_cents) {
        return errorJson(
          "PROMO_MIN_TOTAL",
          `Este código exige um subtotal mínimo de ${(found.min_total_cents / 100).toFixed(2)} MT.`,
          { status: 400 }
        );
      }
      discount = found.percent_off
        ? Math.round((subtotal * found.percent_off) / 100)
        : Math.min(found.amount_off_cents ?? 0, subtotal);
      appliedPromo = found.code;
    }

    const deliveryFee = deliveryFeeFor(subtotal - discount);
    const total = Math.max(0, subtotal - discount) + deliveryFee;
    const reference = newOrderReference();

    const order = await withTransaction(async (client) => {
      const inserted = await client.query<OrderRow>(
        `INSERT INTO orders
           (reference, user_id, customer_name, customer_email, customer_phone,
            delivery_recipient, delivery_phone, delivery_street, delivery_number,
            delivery_neighbourhood, delivery_city, delivery_reference, notes,
            subtotal_cents, delivery_fee_cents, discount_cents, total_cents, currency, promo_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING *`,
        [
          reference,
          user.id,
          user.name,
          user.email,
          user.phone ?? input.delivery.phone,
          input.delivery.recipient,
          input.delivery.phone.replace(/[\s-]/g, ""),
          input.delivery.street,
          input.delivery.number || null,
          input.delivery.neighbourhood || null,
          input.delivery.city,
          input.delivery.reference || null,
          input.notes || null,
          subtotal,
          deliveryFee,
          discount,
          total,
          CURRENCY,
          appliedPromo,
        ]
      );
      const created = inserted.rows[0];

      for (const line of lines) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, name, unit_price_cents, quantity, line_total_cents)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [created.id, line.productId, line.name, line.unitPriceCents, line.quantity, line.lineTotalCents]
        );
        await client.query(`UPDATE products SET stock = stock - $2 WHERE id = $1`, [
          line.productId,
          line.quantity,
        ]);
      }

      await client.query(
        `INSERT INTO order_events (order_id, status, note, actor_id, actor_role)
         VALUES ($1, 'RECEIVED', 'Pedido criado pelo cliente. Aguarda pagamento.', $2, 'CUSTOMER')`,
        [created.id, user.id]
      );

      return created;
    });

    // Endereço guardado no livro de endereços do cliente (sem duplicar)
    await query(
      `INSERT INTO addresses (user_id, label, recipient, phone, street, number, neighbourhood, city, reference)
       SELECT $1, 'Entrega', $2, $3, $4, $5, $6, $7, $8
        WHERE NOT EXISTS (
          SELECT 1 FROM addresses
           WHERE user_id = $1 AND street = $4 AND coalesce(number,'') = coalesce($5,'') AND city = $7
        )`,
      [
        user.id,
        input.delivery.recipient,
        input.delivery.phone.replace(/[\s-]/g, ""),
        input.delivery.street,
        input.delivery.number || null,
        input.delivery.neighbourhood || null,
        input.delivery.city,
        input.delivery.reference || null,
      ]
    );

    await notify({
      audience: "ADMIN",
      orderId: order.id,
      type: "order.created",
      title: `Novo pedido ${order.reference}`,
      body: `${order.customer_name} · ${(total / 100).toFixed(2)} MT · aguarda pagamento`,
    });
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "order.created",
      resource: "orders",
      resourceId: order.id,
      metadata: { reference, total_cents: total, items: lines.length },
      ip: clientIp(request),
    });

    return okJson({ order, items: lines }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    console.error("[orders.create]", error);
    return errorJson("INTERNAL_ERROR", "Não foi possível criar o pedido.", { status: 500 });
  }
}

/** Lista os pedidos do cliente autenticado. */
export async function GET() {
  const user = await currentUser();
  if (!user) return errorJson("UNAUTHENTICATED", "Inicie sessão.", { status: 401 });

  const rows = await query<OrderRow>(
    `SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [user.id]
  );
  return okJson({ orders: rows });
}

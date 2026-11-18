import { query } from "@/lib/db";
import { CURRENCY, deliveryFeeFor } from "@/lib/format";
import { errorJson, okJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Catálogo público: categorias, produtos activos e promoções em vigor. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const category = url.searchParams.get("categoria");
    const search = url.searchParams.get("q")?.trim();

    const categories = await query<{ id: string; name: string; slug: string; description: string | null; icon: string | null }>(
      `SELECT id, name, slug, description, icon FROM categories WHERE active ORDER BY position, name`
    );

    const params: unknown[] = [];
    const filters: string[] = ["p.active"];
    if (category) {
      params.push(category);
      filters.push(`c.slug = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
    }

    const products = await query<{
      id: string;
      name: string;
      slug: string;
      description: string | null;
      price_cents: number;
      image_url: string | null;
      stock: number;
      unit: string;
      featured: boolean;
      category_slug: string | null;
      category_name: string | null;
    }>(
      `SELECT p.id, p.name, p.slug, p.description, p.price_cents, p.image_url, p.stock, p.unit, p.featured,
              c.slug AS category_slug, c.name AS category_name
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${filters.join(" AND ")}
        ORDER BY p.featured DESC, p.name ASC`,
      params
    );

    const promos = await query<{
      id: string;
      code: string | null;
      title: string;
      description: string | null;
      kind: string;
      percent_off: number | null;
      amount_off_cents: number | null;
      min_total_cents: number;
      ends_at: string | null;
    }>(
      `SELECT id, code, title, description, kind, percent_off, amount_off_cents, min_total_cents, ends_at
         FROM promos
        WHERE active
          AND (starts_at IS NULL OR starts_at <= now())
          AND (ends_at IS NULL OR ends_at >= now())
        ORDER BY created_at DESC`
    );

    return okJson({
      categories,
      products,
      promos,
      currency: CURRENCY,
      delivery_policy: {
        free_from_cents: 150_000,
        fee_cents: deliveryFeeFor(1),
      },
    });
  } catch (error) {
    console.error("[catalog]", error);
    return errorJson("INTERNAL_ERROR", "Não foi possível carregar o catálogo.", { status: 500 });
  }
}

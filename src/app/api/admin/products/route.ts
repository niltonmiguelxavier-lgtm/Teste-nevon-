import { ZodError } from "zod";
import { query, queryOne } from "@/lib/db";
import { ADMIN_ONLY, guard } from "@/lib/guard";
import { errorJson, okJson, validationError } from "@/lib/http";
import { audit } from "@/lib/orders";
import { productSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  const products = await query(
    `SELECT p.*, c.name AS category_name FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.name`
  );
  const categories = await query(`SELECT id, name, slug FROM categories ORDER BY position, name`);
  return okJson({ products, categories });
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export async function POST(request: Request) {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  try {
    const input = productSchema.parse(await request.json());
    const base = slugify(input.name);
    let slug = base;
    let suffix = 1;
    while (await queryOne(`SELECT 1 FROM products WHERE slug = $1`, [slug])) {
      slug = `${base}-${++suffix}`;
    }

    const product = await queryOne(
      `INSERT INTO products (category_id, name, slug, description, price_cents, image_url, stock, unit, featured, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        input.categoryId,
        input.name,
        slug,
        input.description || null,
        input.priceCents,
        input.imageUrl || null,
        input.stock,
        input.unit,
        input.featured,
        input.active,
      ]
    );

    await audit({
      actorId: auth.user.id,
      actorRole: "ADMIN",
      action: "product.created",
      resource: "products",
      resourceId: String((product as { id?: string })?.id ?? ""),
    });

    return okJson({ product }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    console.error("[admin.products.create]", error);
    return errorJson("INTERNAL_ERROR", "Não foi possível criar o produto.", { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await guard(ADMIN_ONLY);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as { id?: string } & Record<string, unknown>;
    if (!body.id || typeof body.id !== "string") {
      return errorJson("VALIDATION_ERROR", "Indique o produto a actualizar.", { status: 400 });
    }
    const input = productSchema.partial().parse(body);

    const existing = await queryOne<{ id: string }>(`SELECT id FROM products WHERE id = $1`, [body.id]);
    if (!existing) return errorJson("NOT_FOUND", "Produto não encontrado.", { status: 404 });

    const fields: string[] = [];
    const params: unknown[] = [body.id];
    const set = (column: string, value: unknown) => {
      params.push(value);
      fields.push(`${column} = $${params.length}`);
    };
    if (input.name !== undefined) set("name", input.name);
    if (input.description !== undefined) set("description", input.description || null);
    if (input.priceCents !== undefined) set("price_cents", input.priceCents);
    if (input.stock !== undefined) set("stock", input.stock);
    if (input.unit !== undefined) set("unit", input.unit);
    if (input.categoryId !== undefined) set("category_id", input.categoryId);
    if (input.imageUrl !== undefined) set("image_url", input.imageUrl || null);
    if (input.featured !== undefined) set("featured", input.featured);
    if (input.active !== undefined) set("active", input.active);

    if (fields.length === 0) return errorJson("VALIDATION_ERROR", "Nada para actualizar.", { status: 400 });

    const product = await queryOne(
      `UPDATE products SET ${fields.join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
      params
    );

    await audit({
      actorId: auth.user.id,
      actorRole: "ADMIN",
      action: "product.updated",
      resource: "products",
      resourceId: body.id,
      metadata: input,
    });

    return okJson({ product });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    console.error("[admin.products.update]", error);
    return errorJson("INTERNAL_ERROR", "Não foi possível actualizar o produto.", { status: 500 });
  }
}

import Link from "next/link";
import { query } from "@/lib/db";
import { deliveryFeeFor, formatMoney } from "@/lib/format";
import { AddToCart } from "@/components/add-to-cart";

export const dynamic = "force-dynamic";
export const metadata = { title: "Produtos" };

const PRODUCT_EMOJI: Record<string, string> = {
  mercearia: "🛒",
  farmacia: "💊",
  comida: "🍽️",
  bebidas: "🥤",
  casa: "🧺",
  documentos: "📄",
};

type SearchParams = Promise<{ categoria?: string; q?: string }>;

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const category = params.categoria ?? null;
  const search = params.q?.trim() ?? "";

  const categories = await query<{ id: string; name: string; slug: string }>(
    `SELECT id, name, slug FROM categories WHERE active ORDER BY position, name`
  );

  const filters = ["p.active"];
  const values: unknown[] = [];
  if (category) {
    values.push(category);
    filters.push(`c.slug = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    filters.push(`(p.name ILIKE $${values.length} OR p.description ILIKE $${values.length})`);
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
    category_slug: string | null;
    category_name: string | null;
  }>(
    `SELECT p.id, p.name, p.slug, p.description, p.price_cents, p.image_url, p.stock, p.unit,
            c.slug AS category_slug, c.name AS category_name
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${filters.join(" AND ")}
      ORDER BY c.position NULLS LAST, p.name`,
    values
  );

  const activeCategory = categories.find((item) => item.slug === category);

  return (
    <div className="section">
      <div className="container">
        <div className="section-head">
          <div>
            <span className="eyebrow">Catálogo</span>
            <h1 style={{ fontSize: "clamp(1.8rem, 3.4vw, 2.6rem)" }}>
              {activeCategory ? activeCategory.name : "Todos os produtos"}
            </h1>
            <p className="lead">
              {products.length} produto{products.length === 1 ? "" : "s"} disponível
              {products.length === 1 ? "" : "is"}. Entrega {deliveryFeeFor(1) === 0 ? "grátis" : "a partir de 150 MT"} ·
              grátis acima de 1.500 MT.
            </p>
          </div>
          <form action="/produtos" className="row" style={{ gap: 8 }}>
            {category ? <input type="hidden" name="categoria" value={category} /> : null}
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="Procurar produto…"
              aria-label="Procurar produto"
              style={{
                padding: "10px 13px",
                border: "1px solid var(--paper-line)",
                borderRadius: 9,
                minWidth: 220,
              }}
            />
            <button className="btn btn--sm" type="submit">
              Procurar
            </button>
          </form>
        </div>

        <div className="row" style={{ gap: 8, marginBottom: 26 }}>
          <Link
            href="/produtos"
            className={`btn btn--sm ${!category ? "" : "btn--ghost"}`}
          >
            Todas
          </Link>
          {categories.map((item) => (
            <Link
              key={item.id}
              href={`/produtos?categoria=${item.slug}`}
              className={`btn btn--sm ${category === item.slug ? "" : "btn--ghost"}`}
            >
              {item.name}
            </Link>
          ))}
        </div>

        {products.length === 0 ? (
          <div className="empty">
            Nenhum produto encontrado.{" "}
            <Link href="/produtos" style={{ color: "var(--green-dark)", fontWeight: 600 }}>
              Ver todo o catálogo
            </Link>
          </div>
        ) : (
          <div className="grid grid--4">
            {products.map((product) => (
              <article key={product.id} className="product">
                <div className="product__media">
                  {product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.image_url} alt={product.name} loading="lazy" />
                  ) : (
                    <span className="product__emoji">
                      {PRODUCT_EMOJI[product.category_slug ?? ""] ?? "📦"}
                    </span>
                  )}
                  {product.stock > 0 && product.stock <= 5 ? (
                    <span className="product__tag">Últimas unidades</span>
                  ) : null}
                </div>
                <div className="product__body">
                  <span className="product__cat">{product.category_name ?? "Geral"}</span>
                  <span className="product__name">{product.name}</span>
                  <span className="product__desc">{product.description ?? "—"}</span>
                  <div className="product__foot">
                    <span className="product__price">
                      {formatMoney(product.price_cents)}
                      <small>por {product.unit}</small>
                    </span>
                    <AddToCart productId={product.id} disabled={product.stock <= 0} compact />
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

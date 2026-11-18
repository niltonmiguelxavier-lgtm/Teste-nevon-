import { query } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { ProductManager } from "./product-manager";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const [products, categories] = await Promise.all([
    query<{
      id: string;
      name: string;
      description: string | null;
      price_cents: number;
      stock: number;
      unit: string;
      featured: boolean;
      active: boolean;
      category_id: string | null;
      category_name: string | null;
    }>(
      `SELECT p.id, p.name, p.description, p.price_cents, p.stock, p.unit, p.featured, p.active,
              p.category_id, c.name AS category_name
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
        ORDER BY p.name`
    ),
    query<{ id: string; name: string }>(`SELECT id, name FROM categories ORDER BY position, name`),
  ]);

  return (
    <>
      <div className="dash__head">
        <div>
          <h1>Gestão de produtos</h1>
          <p>{products.length} produto(s) · stock e preços em tempo real</p>
        </div>
      </div>

      <ProductManager
        initialProducts={products.map((product) => ({ ...product, price_cents: product.price_cents }))}
        categories={categories}
      />

      <div className="card card--flat" style={{ marginTop: 20 }}>
        <strong style={{ fontSize: "0.9rem" }}>Resumo do catálogo</strong>
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="row row--between small">
            <span className="muted">Valor total em stock</span>
            <strong>
              {formatMoney(products.reduce((total, product) => total + product.price_cents * product.stock, 0))}
            </strong>
          </div>
          <div className="row row--between small">
            <span className="muted">Produtos esgotados</span>
            <strong>{products.filter((product) => product.stock === 0).length}</strong>
          </div>
          <div className="row row--between small">
            <span className="muted">Produtos em destaque</span>
            <strong>{products.filter((product) => product.featured).length}</strong>
          </div>
        </div>
      </div>
    </>
  );
}

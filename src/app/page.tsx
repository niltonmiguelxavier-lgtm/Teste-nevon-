import Link from "next/link";
import { query } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { AddToCart } from "@/components/add-to-cart";

export const dynamic = "force-dynamic";

const CATEGORY_ICONS: Record<string, string> = {
  mercearia: "🛒",
  farmacia: "💊",
  comida: "🍽️",
  bebidas: "🥤",
  casa: "🧺",
  documentos: "📄",
};

const PRODUCT_EMOJI: Record<string, string> = {
  mercearia: "🛒",
  farmacia: "💊",
  comida: "🍽️",
  bebidas: "🥤",
  casa: "🧺",
  documentos: "📄",
};

export default async function HomePage() {
  const [categories, products, promos] = await Promise.all([
    query<{ id: string; name: string; slug: string; description: string | null }>(
      `SELECT id, name, slug, description FROM categories WHERE active ORDER BY position, name`
    ),
    query<{
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
        WHERE p.active AND p.featured
        ORDER BY p.name LIMIT 8`
    ),
    query<{ id: string; code: string | null; title: string; description: string | null; percent_off: number | null }>(
      `SELECT id, code, title, description, percent_off FROM promos
        WHERE active AND kind = 'BANNER'
          AND (starts_at IS NULL OR starts_at <= now())
          AND (ends_at IS NULL OR ends_at >= now())
        ORDER BY created_at DESC LIMIT 1`
    ),
  ]);

  const promo = promos[0];

  return (
    <>
      {/* ------------------------------------------------------------ hero */}
      <section className="hero">
        <div className="container hero__grid">
          <div>
            <span className="eyebrow" style={{ color: "#5ddba1" }}>
              Entregas em Maputo e Matola
            </span>
            <h1>
              O que precisas, <em>entregue hoje</em>. Sem complicações.
            </h1>
            <p>
              Compras de supermercado, farmácia, comida e documentos entregues à porta. Fazes o pedido
              em minutos, pagas com Nevon Pay e acompanhas cada passo até à entrega.
            </p>
            <div className="hero__actions">
              <Link href="/produtos" className="btn btn--green">
                Fazer pedido
              </Link>
              <Link href="/acompanhar" className="btn btn--outline-light">
                Acompanhar entrega
              </Link>
            </div>
            <div className="hero__meta">
              <div>
                <strong>45 min</strong>
                <span>tempo médio</span>
              </div>
              <div>
                <strong>2 cidades</strong>
                <span>Maputo · Matola</span>
              </div>
              <div>
                <strong>150 MT</strong>
                <span>entrega · grátis acima de 1.500 MT</span>
              </div>
            </div>
          </div>

          <aside className="hero__panel">
            <h3>Como funciona</h3>
            <div className="hero__step">
              <b>1</b>
              <p>
                Escolhe os produtos
                <span>Catálogo com stock actualizado</span>
              </p>
            </div>
            <div className="hero__step">
              <b>2</b>
              <p>
                Confirma endereço e telefone
                <span>Custo de entrega calculado antes de pagar</span>
              </p>
            </div>
            <div className="hero__step">
              <b>3</b>
              <p>
                Paga com Nevon Pay
                <span>Confirmação enviada pela própria Nevon Pay</span>
              </p>
            </div>
            <div className="hero__step">
              <b>4</b>
              <p>
                Acompanha a entrega
                <span>Estados em tempo real até à porta</span>
              </p>
            </div>
          </aside>
        </div>
      </section>

      {/* ------------------------------------------------------- categorias */}
      <section className="section" id="categorias">
        <div className="container">
          <div className="section-head">
            <div>
              <span className="eyebrow">Categorias</span>
              <h2>Começa por aqui</h2>
              <p className="lead">Selecciona uma categoria e adiciona ao carrinho em segundos.</p>
            </div>
            <Link href="/produtos" className="btn btn--ghost btn--sm">
              Ver catálogo completo
            </Link>
          </div>

          <div className="cats">
            {categories.map((category) => (
              <Link key={category.id} href={`/produtos?categoria=${category.slug}`} className="cat">
                <span className="cat__icon">{CATEGORY_ICONS[category.slug] ?? "📦"}</span>
                <span className="cat__name">{category.name}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- produtos */}
      <section className="section section--dim" id="populares">
        <div className="container">
          <div className="section-head">
            <div>
              <span className="eyebrow">Populares</span>
              <h2>Os pedidos mais frequentes</h2>
              <p className="lead">Produtos seleccionados pelos nossos clientes em Maputo e Matola.</p>
            </div>
          </div>

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

          {products.length === 0 ? (
            <div className="empty">O catálogo está a ser actualizado. Volte em instantes.</div>
          ) : null}
        </div>
      </section>

      {/* -------------------------------------------------------- promoções */}
      {promo ? (
        <section className="section--tight" style={{ background: "var(--paper)" }}>
          <div className="container">
            <div className="promo">
              <div>
                <span className="eyebrow" style={{ color: "#5ddba1" }}>
                  Promoção activa
                </span>
                <h2 style={{ marginBottom: 6 }}>{promo.title}</h2>
                <p style={{ color: "#c9e8d8", margin: 0 }}>{promo.description}</p>
                <p className="promo__hint" style={{ marginTop: 8 }}>
                  {promo.percent_off
                    ? `${promo.percent_off}% de desconto no subtotal`
                    : "Desconto aplicado no checkout"}
                </p>
              </div>
              {promo.code ? (
                <div style={{ textAlign: "right" }}>
                  <span className="promo__code">{promo.code}</span>
                  <p className="promo__hint" style={{ marginTop: 8 }}>
                    Introduz o código no carrinho
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* --------------------------------------------------- como funciona */}
      <section className="section" id="como-funciona">
        <div className="container">
          <div className="section-head">
            <div>
              <span className="eyebrow">Processo</span>
              <h2>Quatro passos, zero fricção</h2>
            </div>
          </div>
          <div className="steps">
            <div className="step">
              <h3>Escolhe e adiciona</h3>
              <p>Selecciona produtos no catálogo. O carrinho guarda tudo até finalizares.</p>
            </div>
            <div className="step">
              <h3>Define a entrega</h3>
              <p>Indica endereço, telefone e referência. Vês o custo antes de pagar.</p>
            </div>
            <div className="step">
              <h3>Paga com Nevon Pay</h3>
              <p>O pagamento é criado no servidor e confirmado directamente pela Nevon Pay.</p>
            </div>
            <div className="step">
              <h3>Acompanha o pedido</h3>
              <p>Recebemos, preparamos, saímos para entrega e confirmamos a entrega.</p>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- confiança */}
      <section className="section section--dark">
        <div className="container">
          <div className="grid grid--3">
            <div>
              <h3 style={{ color: "#fff" }}>Pagamento verificado</h3>
              <p className="lead" style={{ fontSize: "0.94rem" }}>
                Nenhum pedido é marcado como pago apenas porque o cliente voltou à página de sucesso.
                A confirmação depende sempre de uma resposta autenticada da Nevon Pay.
              </p>
            </div>
            <div>
              <h3 style={{ color: "#fff" }}>Dados protegidos</h3>
              <p className="lead" style={{ fontSize: "0.94rem" }}>
                A chave da Nevon Pay existe apenas no servidor. Não guardamos dados de cartões
                bancários — o pagamento é feito no ambiente da Nevon Pay.
              </p>
            </div>
            <div>
              <h3 style={{ color: "#fff" }}>Equipa local</h3>
              <p className="lead" style={{ fontSize: "0.94rem" }}>
                Entregadores próprios em Maputo e Matola, com contacto directo por telefone durante
                toda a entrega.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- contactos */}
      <section className="section" id="contactos">
        <div className="container contact">
          <div>
            <span className="eyebrow">Contactos</span>
            <h2>Fala com a nossa equipa</h2>
            <p className="lead">
              Estamos disponíveis de segunda a sábado, das 08h00 às 20h00, para pedidos, dúvidas e
              apoio durante a entrega.
            </p>
            <ul className="contact__list">
              <li>
                <div>
                  <b>Telefone / WhatsApp</b>
                  <span>+258 84 123 4567</span>
                </div>
              </li>
              <li>
                <div>
                  <b>Email</b>
                  <span>geral@expressdelivery.co.mz</span>
                </div>
              </li>
              <li>
                <div>
                  <b>Armazém e escritório</b>
                  <span>Av. Julius Nyerere 1240, Maputo</span>
                </div>
              </li>
              <li>
                <div>
                  <b>Zona de cobertura</b>
                  <span>Maputo cidade, Matola e arredores</span>
                </div>
              </li>
            </ul>
          </div>
          <div className="map">
            <div className="map__fallback" aria-hidden="true">
              <strong>Express Delivery</strong>
              <span>Av. Julius Nyerere 1240, Maputo</span>
              <span className="small">Maputo · Matola · Marracuene</span>
            </div>
            <iframe
              title="Localização Express Delivery — Maputo"
              src="https://www.openstreetmap.org/export/embed.html?bbox=32.5545%2C-25.9800%2C32.6145%2C-25.9300&layer=mapnik&marker=-25.9550%2C32.5845"
              loading="lazy"
            />
          </div>
        </div>
      </section>
    </>
  );
}

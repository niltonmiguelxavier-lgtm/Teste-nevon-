/**
 * Seed inicial: categorias, produtos, promoções e contas base.
 *
 *   node scripts/seed.mjs
 *
 * As palavras-passe vêm de variáveis de ambiente, com valores por omissão
 * apenas para o ambiente de demonstração. Muda-as em produção.
 */
import { createRequire } from "node:module";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL não definida.");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
  options: "-c search_path=express,public",
});

const CATEGORIES = [
  ["Mercearia", "mercearia", "Bens essenciais do dia-a-dia", "🛒", 1],
  ["Farmácia", "farmacia", "Medicamentos e cuidados de saúde", "💊", 2],
  ["Comida", "comida", "Refeições prontas de restaurantes locais", "🍽️", 3],
  ["Bebidas", "bebidas", "Águas, sumos e refrigerantes", "🥤", 4],
  ["Casa", "casa", "Limpeza e utilidades domésticas", "🧺", 5],
  ["Documentos", "documentos", "Recolha e entrega de documentos", "📄", 6],
];

const PRODUCTS = [
  ["Saco de arroz 5 kg", "mercearia", "Arroz agulha de grão longo, qualidade superior.", 65000, 120, "saco", true],
  ["Óleo alimentar 3 L", "mercearia", "Óleo vegetal refinado para uso doméstico.", 45000, 80, "un", true],
  ["Açúcar 1 kg", "mercearia", "Açúcar branco cristalizado.", 12000, 200, "kg", false],
  ["Farinha de trigo 1 kg", "mercearia", "Farinha de trigo para pão e bolos.", 9500, 90, "kg", false],
  ["Paracetamol 500 mg (20 comp.)", "farmacia", "Analgésico e antipirético de venda livre.", 8500, 60, "cx", true],
  ["Máscaras cirúrgicas (50 un.)", "farmacia", "Máscaras descartáveis de três camadas.", 25000, 40, "cx", false],
  ["Soro fisiológico 500 ml", "farmacia", "Soro fisiológico estéril.", 6000, 35, "un", false],
  ["Frango grelhado com batata", "comida", "Refeição pronta, embalada para transporte.", 45000, 25, "un", true],
  ["Matapa com arroz", "comida", "Prato tradicional moçambicano, porção individual.", 38000, 20, "un", true],
  ["Pizza familiar", "comida", "Pizza de 32 cm com queijo e fiambre.", 55000, 15, "un", false],
  ["Água mineral 1,5 L (pack 6)", "bebidas", "Pack de seis garrafas de água mineral.", 18000, 150, "pack", true],
  ["Sumo de laranja 1 L", "bebidas", "Sumo natural refrigerado.", 15000, 60, "un", false],
  ["Detergente multiusos 1 L", "casa", "Limpa superfícies e pavimentos.", 13000, 70, "un", true],
  ["Papel higiénico (12 rolos)", "casa", "Papel higiénico de duas folhas.", 22000, 85, "pack", false],
  ["Sacolas de lixo 50 un.", "casa", "Sacolas resistentes de 60 litros.", 8500, 100, "pack", false],
  ["Entrega de documentos — Maputo", "documentos", "Recolha e entrega de documentos no mesmo dia.", 20000, 999, "serviço", true],
  ["Recolha de encomenda na loja", "documentos", "Recolhemos a encomenda e entregamos em casa.", 25000, 999, "serviço", false],
];

const PROMOS = [
  ["BEMVINDO10", "10% no primeiro pedido", "Desconto de 10% aplicado ao subtotal do primeiro pedido.", "COUPON", 10, null, 50000],
  ["ENTREGA5000", "5.000 MT de desconto", "Desconto fixo de 5.000 MT em pedidos acima de 80.000 MT.", "COUPON", null, 500000, 8000000],
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const [name, slug, description, icon, position] of CATEGORIES) {
      await client.query(
        `INSERT INTO categories (name, slug, description, icon, position)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
        [name, slug, description, icon, position]
      );
    }

    for (const [name, categorySlug, description, priceCents, stock, unit, featured] of PRODUCTS) {
      const slug = name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      await client.query(
        `INSERT INTO products (category_id, name, slug, description, price_cents, stock, unit, featured)
         SELECT c.id, $1, $2, $3, $4, $5, $6, $7 FROM categories c WHERE c.slug = $8
         ON CONFLICT (slug) DO UPDATE
           SET price_cents = EXCLUDED.price_cents, description = EXCLUDED.description,
               stock = GREATEST(products.stock, EXCLUDED.stock), featured = EXCLUDED.featured`,
        [name, slug, description, priceCents, stock, unit, featured, categorySlug]
      );
    }

    for (const [code, title, description, kind, percentOff, amountOff, minTotal] of PROMOS) {
      await client.query(
        `INSERT INTO promos (code, title, description, kind, percent_off, amount_off_cents, min_total_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description`,
        [code, title, description, kind, percentOff, amountOff, minTotal]
      );
    }

    await client.query(
      `INSERT INTO promos (title, description, kind)
       SELECT 'Entrega grátis acima de 1.500 MT', 'Todas as encomendas acima de 1.500 MT têm entrega gratuita em Maputo e Matola.', 'BANNER'
       WHERE NOT EXISTS (SELECT 1 FROM promos WHERE kind = 'BANNER')`
    );

    const adminPassword = process.env.SEED_ADMIN_PASSWORD || "ExpressAdmin2026";
    const courierPassword = process.env.SEED_COURIER_PASSWORD || "Entregador2026";
    const customerPassword = process.env.SEED_CUSTOMER_PASSWORD || "Cliente2026";

    const accounts = [
      ["Nilton Miguel", "niltonmiguelxavier@gmail.com", "841234567", adminPassword, "ADMIN"],
      ["Equipa Express", "admin@expressdelivery.co.mz", "841111111", adminPassword, "ADMIN"],
      ["Carlos Mabunda", "carlos@expressdelivery.co.mz", "842222222", courierPassword, "COURIER"],
      ["Amina Sulemane", "amina@expressdelivery.co.mz", "843333333", courierPassword, "COURIER"],
      ["Cliente Demo", "cliente@expressdelivery.co.mz", "844444444", customerPassword, "CUSTOMER"],
    ];

    for (const [name, email, phone, password, role] of accounts) {
      const hash = await bcrypt.hash(password, 12);
      await client.query(
        `INSERT INTO users (name, email, phone, password_hash, role)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (lower(email)) DO NOTHING`,
        [name, email, phone, hash, role]
      );
    }

    await client.query(
      `INSERT INTO settings (key, value) VALUES
        ('delivery', '{"fee_cents":15000,"free_from_cents":150000,"cities":["Maputo","Matola","Marracuene"]}'::jsonb),
        ('company', '{"name":"Express Delivery, Lda","phone":"+258 84 123 4567","email":"geral@expressdelivery.co.mz","address":"Av. Julius Nyerere 1240, Maputo"}'::jsonb)
       ON CONFLICT (key) DO NOTHING`
    );

    await client.query("COMMIT");
    console.log("Seed concluído.");
    console.log("Contas criadas/reutilizadas:");
    for (const [, email, , , role] of accounts) console.log(` - ${role.padEnd(8)} ${email}`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Falha no seed:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();

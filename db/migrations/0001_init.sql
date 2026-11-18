-- Express Delivery — esquema inicial
-- Todas as tabelas vivem no schema `express`, isolado das tabelas de outras
-- aplicações que partilham este projecto Supabase.

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  email           text NOT NULL,
  phone           text,
  password_hash   text NOT NULL,
  role            text NOT NULL DEFAULT 'CUSTOMER'
                  CHECK (role IN ('CUSTOMER', 'COURIER', 'ADMIN')),
  active          boolean NOT NULL DEFAULT true,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id          text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent  text,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,
  label         text,
  recipient     text NOT NULL,
  phone         text NOT NULL,
  street        text NOT NULL,
  number        text,
  neighbourhood text,
  city          text NOT NULL,
  reference     text,
  latitude      numeric(10, 7),
  longitude     numeric(10, 7),
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS addresses_user_idx ON addresses (user_id);

CREATE TABLE IF NOT EXISTS categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  description text,
  icon        text,
  position    integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid REFERENCES categories(id) ON DELETE SET NULL,
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,
  description  text,
  price_cents  integer NOT NULL CHECK (price_cents >= 0),
  image_url    text,
  sku          text,
  stock        integer NOT NULL DEFAULT 0,
  unit         text NOT NULL DEFAULT 'un',
  featured     boolean NOT NULL DEFAULT false,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category_id);

CREATE TABLE IF NOT EXISTS promos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text UNIQUE,
  title       text NOT NULL,
  description text,
  kind        text NOT NULL DEFAULT 'BANNER' CHECK (kind IN ('BANNER', 'COUPON')),
  percent_off integer CHECK (percent_off BETWEEN 0 AND 100),
  amount_off_cents integer CHECK (amount_off_cents >= 0),
  min_total_cents  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference           text NOT NULL UNIQUE,          -- EX-2026-000123
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'RECEIVED'
                      CHECK (status IN ('RECEIVED','PAYMENT_CONFIRMED','PREPARING','OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
  payment_status      text NOT NULL DEFAULT 'PENDING'
                      CHECK (payment_status IN ('PENDING','PAID','FAILED','CANCELLED','EXPIRED')),
  customer_name       text NOT NULL,
  customer_email      text NOT NULL,
  customer_phone      text NOT NULL,
  delivery_recipient  text NOT NULL,
  delivery_phone      text NOT NULL,
  delivery_street     text NOT NULL,
  delivery_number     text,
  delivery_neighbourhood text,
  delivery_city       text NOT NULL,
  delivery_reference  text,
  notes               text,
  subtotal_cents      integer NOT NULL CHECK (subtotal_cents >= 0),
  delivery_fee_cents  integer NOT NULL DEFAULT 0,
  discount_cents      integer NOT NULL DEFAULT 0,
  total_cents         integer NOT NULL CHECK (total_cents >= 0),
  currency            text NOT NULL DEFAULT 'MZN',
  promo_code          text,
  courier_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at         timestamptz,
  paid_at             timestamptz,
  delivered_at        timestamptz,
  cancelled_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
CREATE INDEX IF NOT EXISTS orders_courier_idx ON orders (courier_id);

CREATE TABLE IF NOT EXISTS order_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      uuid REFERENCES products(id) ON DELETE SET NULL,
  name            text NOT NULL,
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  quantity        integer NOT NULL CHECK (quantity > 0),
  line_total_cents integer NOT NULL CHECK (line_total_cents >= 0)
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

-- Histórico de estados (auditoria visível ao cliente e à equipa)
CREATE TABLE IF NOT EXISTS order_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status      text NOT NULL,
  note        text,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events (order_id, created_at);

-- Transacções Nevon Pay. `idempotency_key` garante que um pedido nunca gera
-- duas cobranças, mesmo com pedidos HTTP repetidos ou concorrentes.
CREATE TABLE IF NOT EXISTS transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider            text NOT NULL DEFAULT 'NEVONPAY',
  environment         text NOT NULL DEFAULT 'SANDBOX' CHECK (environment IN ('SANDBOX','PRODUCTION')),
  method              text NOT NULL CHECK (method IN ('SANDBOX','MPESA','EMOLA')),
  status              text NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN','PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED','EXPIRED')),
  amount_cents        integer NOT NULL CHECK (amount_cents > 0),
  currency            text NOT NULL DEFAULT 'MZN',
  idempotency_key     text NOT NULL UNIQUE,
  checkout_session_id text,
  checkout_url        text,
  provider_ref        text,
  provider_payment_id text,
  success_url         text,
  cancel_url          text,
  expires_at          timestamptz,
  confirmed_at        timestamptz,
  last_error          text,
  metadata            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- Um pedido só pode ter uma transacção activa de cada vez.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_active_order_idx
  ON transactions (order_id)
  WHERE status IN ('OPEN','PENDING','PROCESSING');
CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions (status);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_session_idx ON transactions (checkout_session_id);

-- Registo técnico de cada chamada à API Nevon Pay (diagnóstico, sem segredos)
CREATE TABLE IF NOT EXISTS provider_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL DEFAULT 'NEVONPAY',
  kind          text NOT NULL,              -- REQUEST | RESPONSE | ERROR | WEBHOOK | VERIFY
  method        text,
  path          text,                       -- caminho relativo, sem host nem chave
  status_code   integer,
  ok            boolean,
  duration_ms   integer,
  request_ref   text,                       -- referência/pedido, nunca a chave
  message       text,
  payload       jsonb,                      -- corpo da resposta com dados sensíveis removidos
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_events_created_idx ON provider_events (created_at DESC);

-- Webhooks recebidos. `event_id` impede processamento duplicado.
CREATE TABLE IF NOT EXISTS webhook_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL DEFAULT 'NEVONPAY',
  event_id      text NOT NULL,
  signature_ok  boolean NOT NULL DEFAULT false,
  processed     boolean NOT NULL DEFAULT false,
  payload       jsonb NOT NULL,
  error         text,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  UNIQUE (provider, event_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience    text NOT NULL CHECK (audience IN ('ADMIN','COURIER','CUSTOMER')),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  order_id    uuid REFERENCES orders(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_audience_idx ON notifications (audience, created_at DESC);

-- Registo de operações sensíveis (financeiro, permissões, alterações de estado)
CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role  text,
  action      text NOT NULL,
  resource    text,
  resource_id text,
  metadata    jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);

-- Configurações operacionais (taxa de entrega, contactos, limites)
CREATE TABLE IF NOT EXISTS settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Permissões: a aplicação usa exclusivamente o role `express_app`
GRANT USAGE ON SCHEMA express TO express_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA express TO express_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA express GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO express_app;

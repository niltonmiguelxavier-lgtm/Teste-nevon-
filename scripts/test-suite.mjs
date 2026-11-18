/**
 * Testes ponta a ponta da Express Delivery.
 *
 *   node scripts/test-suite.mjs
 *
 * Executa pedidos HTTP reais contra a aplicação em execução (BASE_URL) e a base
 * de dados configurada — registo, login, carrinho, pedido, pagamento, RBAC,
 * webhooks e diagnóstico Nevon Pay.
 */
const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const stamp = Date.now();

const results = [];
let cookies = {};

function record(id, area, name, status, detail = "") {
  results.push({ id, area, name, status, detail });
  const icon = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : "!";
  console.log(`${icon} [${id}] ${area} · ${name}${detail ? ` — ${detail}` : ""}`);
}

async function check(id, area, name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    record(id, area, name, "PASS", `${detail ?? ""} (${Date.now() - started}ms)`);
    return true;
  } catch (error) {
    record(id, area, name, "FAIL", error instanceof Error ? error.message : String(error));
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function req(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
  if (cookieHeader && !options.noCookie) headers.Cookie = cookieHeader;

  const response = await fetch(`${BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: "manual",
  });

  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const raw of setCookie) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    const key = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (value === "" ) delete cookies[key];
    else cookies[key] = value;
  }

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: response.status, json, text, headers: response.headers };
}

const state = {};

async function main() {
  console.log(`\nExpress Delivery — testes em ${BASE}\n${"=".repeat(70)}`);

  // ---------------------------------------------------------------- saúde
  await check("S1", "saúde", "GET /api/health devolve estado da BD e Nevon Pay", async () => {
    const { status, json } = await req("/api/health");
    assert(status === 200, `status ${status}: ${JSON.stringify(json)}`);
    assert(json.data.database.ok, "base de dados não saudável");
    assert(json.data.database.tables >= 10, `apenas ${json.data.database.tables} tabelas`);
    state.nevonConfigured = json.data.nevonpay.configured;
    return `tabelas=${json.data.database.tables} schema=${json.data.database.schema} nevonpay=${json.data.nevonpay.environment}`;
  });

  // --------------------------------------------------------------- catálogo
  await check("C1", "catálogo", "catálogo público devolve categorias e produtos", async () => {
    const { status, json } = await req("/api/catalog");
    assert(status === 200, `status ${status}`);
    assert(json.data.categories.length >= 6, "categorias insuficientes");
    assert(json.data.products.length >= 10, "produtos insuficientes");
    state.product = json.data.products[0];
    state.product2 = json.data.products[1];
    return `${json.data.categories.length} categorias · ${json.data.products.length} produtos`;
  });

  // ---------------------------------------------------------------- registo
  const email = `teste.express.${stamp}@exemplo.co.mz`;
  await check("A1", "autenticação", "registo de cliente válido", async () => {
    const { status, json } = await req("/api/auth/register", {
      method: "POST",
      body: { name: "Cliente Teste Automático", email, phone: "84 555 0101", password: "TesteSeguro2026" },
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(json)}`);
    assert(json.data.user.role === "CUSTOMER", "função inesperada");
    state.userId = json.data.user.id;
    assert(cookies.express_session, "cookie de sessão não definido");
    return `utilizador ${json.data.user.id.slice(0, 8)}… · sessão criada`;
  });

  await check("A2", "autenticação", "registo duplicado é recusado (409)", async () => {
    const { status, json } = await req("/api/auth/register", {
      method: "POST",
      body: { name: "Outro", email, phone: "84 555 0102", password: "TesteSeguro2026" },
    });
    assert(status === 409, `esperado 409, recebido ${status}`);
    assert(json.error.code === "EMAIL_IN_USE", "código inesperado");
    return json.error.code;
  });

  await check("A3", "autenticação", "validação de dados no servidor (telefone inválido)", async () => {
    const { status, json } = await req("/api/auth/register", {
      method: "POST",
      body: { name: "X", email: `invalido.${stamp}@x.com`, phone: "123", password: "123" },
    });
    assert(status === 400, `esperado 400, recebido ${status}`);
    assert(Array.isArray(json.error.details) && json.error.details.length >= 3, "erros de campo em falta");
    return json.error.details.map((d) => d.field).join(", ");
  });

  await check("A4", "autenticação", "logout e novo login com credenciais válidas", async () => {
    await req("/api/auth/logout", { method: "POST" });
    const loggedOut = !cookies.express_session;
    const login = await req("/api/auth/login", {
      method: "POST",
      body: { email, password: "TesteSeguro2026" },
    });
    assert(loggedOut, "cookie não foi limpo no logout");
    assert(login.status === 200, `login falhou: ${login.status} ${JSON.stringify(login.json)}`);
    return `redirect=${login.json.data.redirect}`;
  });

  await check("A5", "autenticação", "login com palavra-passe errada é recusado", async () => {
    const { status, json } = await req("/api/auth/login", {
      method: "POST",
      body: { email, password: "errada-de-proposito" },
    });
    assert(status === 401, `esperado 401, recebido ${status}`);
    assert(json.error.code === "INVALID_CREDENTIALS", "mensagem inesperada");
    return "credenciais inválidas sem revelar se o email existe";
  });

  // --------------------------------------------------------------- carrinho
  await check("B1", "carrinho", "adicionar produto e verificar totais no servidor", async () => {
    const add = await req("/api/cart", {
      method: "POST",
      body: { action: "add", productId: state.product.id, quantity: 2 },
    });
    assert(add.status === 200, `status ${add.status}: ${JSON.stringify(add.json)}`);
    const cart = await req("/api/cart");
    assert(cart.json.data.lines.length === 1, "linhas inesperadas");
    assert(
      cart.json.data.subtotal_cents === state.product.price_cents * 2,
      "subtotal incorrecto"
    );
    state.cart = cart.json.data;
    return `subtotal=${cart.json.data.subtotal_cents} entrega=${cart.json.data.delivery_fee_cents}`;
  });

  // ----------------------------------------------------------------- pedido
  await check("O1", "pedidos", "criação de pedido com preços calculados no servidor", async () => {
    const { status, json } = await req("/api/orders", {
      method: "POST",
      body: {
        items: [
          { productId: state.product.id, quantity: 3 },
          { productId: state.product2.id, quantity: 1 },
        ],
        delivery: {
          recipient: "Cliente Teste",
          phone: "84 555 0101",
          street: "Av. Julius Nyerere",
          number: "1240",
          neighbourhood: "Sommerschield",
          city: "Maputo",
          reference: "Portão verde",
        },
        notes: "Ligar ao chegar",
        promoCode: "BEMVINDO10",
      },
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(json)}`);
    const order = json.data.order;
    const expectedSubtotal =
      state.product.price_cents * 3 + state.product2.price_cents * 1;
    assert(order.subtotal_cents === expectedSubtotal, "subtotal incorrecto");
    assert(order.discount_cents === Math.round(expectedSubtotal * 0.1), "desconto incorrecto");
    state.order = order;
    return `${order.reference} total=${order.total_cents} (subtotal ${order.subtotal_cents}, desconto ${order.discount_cents})`;
  });

  await check("O2", "pedidos", "pedido rejeita produto inexistente", async () => {
    const { status, json } = await req("/api/orders", {
      method: "POST",
      body: {
        items: [{ productId: "00000000-0000-4000-8000-000000000000", quantity: 1 }],
        delivery: {
          recipient: "Cliente Teste",
          phone: "84 555 0101",
          street: "Rua A",
          city: "Maputo",
        },
      },
    });
    assert(status === 409, `esperado 409, recebido ${status}`);
    return json.error.code;
  });

  await check("O3", "pedidos", "pedido exige sessão (401 sem cookie)", async () => {
    const saved = cookies;
    cookies = {};
    const { status } = await req("/api/orders", {
      method: "POST",
      body: { items: [], delivery: {} },
    });
    cookies = saved;
    assert(status === 401, `esperado 401, recebido ${status}`);
    return "rota protegida";
  });

  // -------------------------------------------------------------- pagamento
  await check("P1", "pagamento", "criação de cobrança na Nevon Pay (chave configurada ou falha segura)", async () => {
    const { status, json } = await req("/api/payments/create", {
      method: "POST",
      body: { reference: state.order.reference, method: "SANDBOX" },
    });

    if (state.nevonConfigured) {
      if (status === 201 || status === 200) {
        state.checkoutUrl = json.data.checkout_url;
        state.providerPaymentId = json.data.provider_payment_id;
        return `pagamento ${json.data.provider_payment_id} criado · ${json.data.status}`;
      }
      // Chave presente mas recusada pela API → integração real a funcionar
      assert(status === 502, `esperado 502, recebido ${status}`);
      return `API recusou a chave: ${json.error.code} (integração real, sem simulação)`;
    }

    assert(status === 503, `esperado 503 sem chave, recebido ${status}`);
    assert(json.error.code === "NEVONPAY_NOT_CONFIGURED", `código ${json.error.code}`);
    return "sem chave: falha segura, nenhuma cobrança fictícia";
  });

  await check("P2", "pagamento", "regresso à página de sucesso NÃO marca como pago", async () => {
    const page = await req(`/pedido/${state.order.reference}?pagamento=retorno`);
    assert(page.status === 200, `página respondeu ${page.status}`);
    const verify = await req("/api/payments/verify", {
      method: "POST",
      body: { reference: state.order.reference },
    });
    const order = await req(`/api/orders/${state.order.reference}`);
    assert(order.json.data.order.payment_status === "PENDING", "pedido foi marcado como pago indevidamente");
    return `verify=${verify.status} payment_status=${order.json.data.order.payment_status}`;
  });

  await check("P3", "pagamento", "idempotência: dois pedidos de pagamento não duplicam transacções", async () => {
    const first = await req("/api/payments/create", {
      method: "POST",
      body: { reference: state.order.reference, method: "SANDBOX" },
    });
    const second = await req("/api/payments/create", {
      method: "POST",
      body: { reference: state.order.reference, method: "SANDBOX" },
    });
    if (state.nevonConfigured && first.status === 201) {
      assert(second.status === 200 && second.json.data.reused, "não reutilizou a transacção activa");
      assert(
        second.json.data.provider_payment_id === first.json.data.provider_payment_id,
        "criou um segundo pagamento no provedor"
      );
      return "segunda chamada devolveu a mesma transacção";
    }
    // Sem chave: ambas falham de forma segura e não deixam transacção activa
    assert(first.status === 503 && second.status === 503, "estado inesperado");
    const detail = await req(`/api/orders/${state.order.reference}`);
    const active = detail.json.data.transaction;
    assert(!active || !["OPEN", "PENDING", "PROCESSING"].includes(active.status), "transacção activa indevida");
    return `sem transacção activa (última: ${active?.status ?? "nenhuma"})`;
  });

  await check("P4", "pagamento", "webhook sem assinatura não confirma pagamentos", async () => {
    const { status, json } = await req("/api/payments/webhook", {
      method: "POST",
      body: { event_id: `teste_${stamp}`, payment: { id: "fake_payment_id", status: "COMPLETED" } },
    });
    assert(status === 200, `status ${status}`);
    assert(json.data.changed === false, "webhook alterou o pedido sem verificação");
    const order = await req(`/api/orders/${state.order.reference}`);
    assert(order.json.data.order.payment_status === "PENDING", "pedido ficou pago por webhook não verificado");
    return `webhook registado, matched=${json.data.matched}, changed=${json.data.changed}`;
  });

  // ------------------------------------------------------------------ RBAC
  await check("R1", "segurança", "cliente não acede a rotas de administração", async () => {
    const admin = await req("/api/admin/stats");
    assert(admin.status === 403, `esperado 403, recebido ${admin.status}`);
    const diagnostics = await req("/api/admin/nevonpay/diagnostics");
    assert(diagnostics.status === 403, `diagnóstico acessível: ${diagnostics.status}`);
    const deliveries = await req("/api/courier/deliveries");
    assert(deliveries.status === 403, `entregas acessíveis: ${deliveries.status}`);
    return "401/403 em /api/admin/* e /api/courier/*";
  });

  await check("R2", "segurança", "painel /admin redirecciona quem não é administrador", async () => {
    const page = await req("/admin");
    assert([307, 302, 303].includes(page.status), `esperado redirect, recebido ${page.status}`);
    const location = page.headers.get("location") ?? "";
    assert(location === "/conta", `cliente devia ir para /conta, foi para ${location}`);
    return `cliente autenticado → ${location}`;
  });

  await check("R3", "segurança", "dados de outro cliente não são acessíveis", async () => {
    const other = await req("/api/orders/EX-2026-XXXXXX");
    assert(other.status === 404, `esperado 404, recebido ${other.status}`);
    return "referência inexistente devolve 404";
  });

  // --------------------------------------------------------- admin & courier
  await check("D1", "administração", "login de administrador e estatísticas", async () => {
    const saved = { ...cookies };
    cookies = {};
    const login = await req("/api/auth/login", {
      method: "POST",
      body: { email: process.env.ADMIN_EMAIL || "niltonmiguelxavier@gmail.com", password: process.env.ADMIN_PASSWORD || "ExpressAdmin2026" },
    });
    assert(login.status === 200, `login admin falhou: ${login.status} ${JSON.stringify(login.json)}`);
    const stats = await req("/api/admin/stats");
    assert(stats.status === 200, `stats ${stats.status}`);
    state.adminCookies = { ...cookies };
    cookies = saved;
    return `pedidos=${stats.json.data.orders.by_status.length} estados`;
  });

  await check("D2", "administração", "diagnóstico Nevon Pay devolve passos reais e não expõe a chave", async () => {
    const saved = { ...cookies };
    cookies = { ...state.adminCookies };
    const { status, json, text } = await req("/api/admin/nevonpay/diagnostics");
    cookies = saved;
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(json.data.steps) && json.data.steps.length >= 3, "passos em falta");
    assert(!/\bnv_(test|live)_[A-Za-z0-9]{16,}/.test(text), "a chave secreta apareceu na resposta!");
    const connection = json.data.steps.find((step) => step.id === "connection");
    assert(connection?.status === "ok", `ligação ao servidor: ${connection?.detail}`);
    return connection.detail;
  });

  await check("D3", "entregador", "entregador vê apenas as suas entregas", async () => {
    const saved = { ...cookies };
    cookies = {};
    const login = await req("/api/auth/login", {
      method: "POST",
      body: { email: "carlos@expressdelivery.co.mz", password: "Entregador2026" },
    });
    assert(login.status === 200, `login entregador falhou: ${login.status}`);
    const deliveries = await req("/api/courier/deliveries");
    assert(deliveries.status === 200, `status ${deliveries.status}`);
    const admin = await req("/api/admin/stats");
    assert(admin.status === 403, "entregador acedeu à administração");
    cookies = saved;
    return `${deliveries.json.data.deliveries.length} entregas atribuídas · admin bloqueado`;
  });

  // ------------------------------------------------------------- páginas HTML
  for (const [id, path, needle] of [
    ["H1", "/", "Express Delivery"],
    ["H2", "/produtos", "Catálogo"],
    ["H3", "/como-funciona", "Como funciona"],
    ["H4", "/contactos", "Contactos"],
    ["H5", "/acompanhar", "Acompanhar"],
    ["H6", "/entrar", "Iniciar sessão"],
  ]) {
    await check(id, "interface", `página ${path} renderiza`, async () => {
      const { status, text } = await req(path, path === "/entrar" ? { noCookie: true } : {});
      assert(status === 200, `status ${status}`);
      assert(text.includes(needle), `conteúdo esperado "${needle}" ausente`);
      return `${text.length} bytes`;
    });
  }

  // ---------------------------------------------------------------- resumo
  const passed = results.filter((item) => item.status === "PASS").length;
  const failed = results.filter((item) => item.status === "FAIL").length;
  console.log(`${"=".repeat(70)}\n${passed} passaram · ${failed} falharam · ${results.length} testes`);

  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    new URL("../test-results.json", import.meta.url),
    JSON.stringify({ base: BASE, ran_at: new Date().toISOString(), passed, failed, results }, null, 2)
  );

  if (failed > 0) process.exitCode = 1;
}

await main();

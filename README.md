# Express Delivery

Plataforma de entregas ao domicílio para Maputo e Matola: catálogo, carrinho, pedidos,
pagamentos online via **Nevon Pay** (sandbox), acompanhamento de entregas em tempo real,
painel administrativo e painel do entregador.

- **Next.js 15** (App Router, TypeScript) + React 19
- **PostgreSQL (Supabase)** com `pg` — schema `express` isolado, role dedicado `express_app`
- **Autenticação própria**: bcrypt (custo 12) + sessões opacas em base de dados, cookie `HttpOnly`
- **Nevon Pay**: integração real com a API documentada, exclusivamente no servidor
- Deploy: **Vercel**

---

## 1. Como executar

```bash
npm install
cp .env.example .env.local     # preencher as variáveis
npm run db:migrate             # (opcional) aplica db/migrations/*.sql
npm run db:seed                # categorias, produtos, promoções e contas base
npm run dev                    # http://localhost:3000
npm run build && npm start     # produção
npm test                       # 27 testes ponta a ponta contra a app em execução
```

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | Connection string do pooler Supabase (role `express_app`) |
| `DATABASE_POOL_MAX` | não | Máximo de ligações (por omissão 5) |
| `DATABASE_SSL_CA` | não | CA do Supabase, para validação completa do certificado |
| `SESSION_SECRET` | sim | Segredo para derivar o hash do cookie de sessão |
| `NEXT_PUBLIC_APP_URL` | sim | URL público (usado nos URLs de retorno do checkout) |
| `NEVONPAY_SECRET_KEY` | sim | Chave da Nevon Pay (**nunca** exposta ao browser) |
| `NEVONPAY_BASE_URL` | não | Host da API (por omissão `https://nevon-pay.vercel.app`) |
| `NEVONPAY_TIMEOUT_MS` | não | Timeout das chamadas (por omissão 15000) |
| `NEVONPAY_WEBHOOK_SECRET` | não | Segredo HMAC para validar webhooks (ver §4) |

---

## 2. Base de dados

15 tabelas no schema `express`:

`users`, `sessions`, `addresses`, `categories`, `products`, `promos`, `orders`,
`order_items`, `order_events`, `transactions`, `provider_events`, `webhook_events`,
`notifications`, `audit_log`, `settings`.

Migração versionada em [`db/migrations/0001_init.sql`](db/migrations/0001_init.sql).

Pontos relevantes:

- `users.email` tem índice único sobre `lower(email)` — evita duplicados por capitalização.
- `orders.reference` (ex.: `EX-2026-8F3K2A`) é a referência pública.
- `transactions.idempotency_key` é único e enviado no cabeçalho `Idempotency-Key`.
- **`transactions` tem um índice único parcial** que garante no máximo **uma transacção
  activa** por pedido (`status IN ('OPEN','PENDING','PROCESSING')`) — protecção contra
  pagamentos duplicados ao nível da base de dados.
- `webhook_events` tem `UNIQUE (provider, event_id)` — idempotência de webhooks.
- `provider_events` guarda cada chamada à Nevon Pay com a resposta higienizada.
- `audit_log` registra operações financeiras e de permissões.

O schema `express` e o role `express_app` estão isolados das tabelas legadas do projecto
Supabase (`mhrdefisamaflkpkqmiu`), que não são tocadas.

---

## 3. Integração Nevon Pay (o núcleo do projecto)

Documentação usada: [`github.com/niltonmiguelxavier-lgtm/Nevon-pay-`](https://github.com/niltonmiguelxavier-lgtm/Nevon-pay-)
(README § *API pública (`/api/v1`)* e `lib/api/*`). Não foi inventado nenhum endpoint.

### Endpoints documentados (implementados)

| Método | Rota | Uso no projecto |
|---|---|---|
| `POST` | `/api/v1/payments` | **Criação da cobrança** com `Idempotency-Key` |
| `GET` | `/api/v1/payments/{id ou referência}` | **Fonte de verdade** da confirmação |
| `POST` | `/api/v1/checkout/session` | Sessão de checkout hospedada (`checkout_url`) |
| `GET` | `/api/v1/checkout/session/{id}` | Consulta da sessão |
| `POST` | `/api/v1/checkout/session/{id}/cancel` | Cancelamento da sessão |
| `GET` | `/api/v1/payments` | Diagnóstico de autenticação/listagem |

Autenticação: `Authorization: Bearer nv_test_…` (a documentação também aceita `x-api-key`).
Erros vêm em `{ success: false, error: { code, message } }` — todos tratados
(`MISSING_API_KEY`, `INVALID_API_KEY`, `PROVIDER_NOT_CONFIGURED`, `RATE_LIMITED`, etc.).

### Métodos de pagamento (apenas os documentados)

| Método | Estado no sandbox |
|---|---|
| `sandbox` | Activo — cria pagamento real na API de testes, sem movimentar dinheiro |
| `mpesa` | Documentado; responde `503 PROVIDER_NOT_CONFIGURED` até existir conta de programador |
| `emola` | Documentado; responde `503 PROVIDER_NOT_CONFIGURED` até acesso oficial |

A interface mostra exactamente estes três métodos, com o estado real de cada um.

### Fluxo implementado

1. Cliente confirma o pedido → total calculado **no servidor** (`POST /api/orders`).
2. `POST /api/payments/create` → o servidor cria a transacção em `transactions`
   (`OPEN`, com `Idempotency-Key`) e chama a Nevon Pay:
   `POST /api/v1/payments` → `POST /api/v1/checkout/session`.
3. O cliente é encaminhado para o `checkout_url` da Nevon Pay.
4. No regresso, `POST /api/payments/verify` **consulta a Nevon Pay com a chave secreta**
   (`GET /api/v1/payments/{provider_ref}`) e só se o estado for `COMPLETED`:
   `orders.payment_status = 'PAID'`, `orders.status = 'PAYMENT_CONFIRMED'`,
   `transactions.confirmed_at = now()`.
5. É criada uma notificação `ADMIN` («Preparar a entrega») e uma notificação ao cliente,
   e o evento fica em `order_events`.

Regra crítica aplicada: **voltar à página de sucesso não confirma nada**. O parâmetro
`?pagamento=retorno` só mostra um aviso informativo; o estado é sempre reconsultado na API.
Há também verificação automática a cada 15 s enquanto o pagamento está pendente.

### Protecção contra pagamentos duplicados

- Pedido já pago → devolve o estado existente, nunca cria nova cobrança.
- Transacção activa válida → é **reutilizada** (o `checkout_url` é o mesmo).
- Índice único parcial em `transactions(order_id)` para estados activos.
- `Idempotency-Key` em todas as criações no provedor.
- Botões de pagamento bloqueados durante o pedido e limitador de taxa por utilizador.

### Webhooks

A documentação pública **não descreve webhooks nem esquema de assinatura**. O endpoint
`POST /api/payments/webhook` existe e é seguro por construção:

1. Se `NEVONPAY_WEBHOOK_SECRET` estiver definido, valida HMAC-SHA256 do corpo cru
   (`X-Nevonpay-Signature` / `X-Signature`, hex ou `sha256=<hex>`).
2. Seja qual for o corpo recebido, **não confia no estado enviado**: usa o payload apenas
   para localizar a transacção e reconfirma o estado com `GET /api/v1/payments/{id}`
   autenticado. Só essa resposta pode marcar o pedido como pago.
3. `UNIQUE (provider, event_id)` evita processamento duplicado; tudo fica em `webhook_events`.

---

## 4. Segurança

- A chave da Nevon Pay só existe no servidor (`src/lib/nevonpay.ts` é importado apenas por
  route handlers; nenhum componente cliente a recebe).
- Validação de todos os dados no servidor com **Zod**; o cliente nunca envia preços.
- Sessões: token aleatório de 32 bytes; na BD fica apenas SHA-256 com `SESSION_SECRET`.
  Cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção.
- Permissões por função em todas as rotas privadas (`guard(["ADMIN"])`, `["COURIER"]`).
- `/admin` e `/entregador` redireccionam quem não tem a função; cabeçalho `X-Robots-Tag:
  noindex` e nenhum link público para o painel.
- Limitador de taxa em login, registo, criação de pedidos, pagamentos e webhooks.
- `audit_log` para operações financeiras, alterações de estado e permissões.
- **Nenhum dado de cartão é guardado** — o pagamento ocorre no ambiente da Nevon Pay;
  guardamos apenas referência, valor, método e estado.
- Respostas de diagnóstico passam por `sanitizePayload` (remove `secret`, `token`, `card`,
  `authorization`, …) e por `redactSecret`.
- Cabeçalhos de segurança em `next.config.ts` (HSTS, `nosniff`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`).
- Erros de login genéricos (não revelam se o email existe) e comparação bcrypt mesmo para
  emails inexistentes.

---

## 5. Diagnóstico Nevon Pay (admin)

`/admin/nevonpay` — apenas ADMIN:

- Ligação ao servidor (`GET /api/health` do provedor).
- Ambiente efectivo (derivado do prefixo da chave), host, tipo e comprimento da chave
  (nunca a chave).
- Autenticação exigida (pedido sem chave deve devolver `401 MISSING_API_KEY`).
- Autenticação com a chave secreta (`GET /api/v1/payments`).
- Criação de transacção de teste + consulta da mesma (`POST`/`GET /api/v1/payments`).
- Respostas completas da API (higienizadas) e registo de erros de integração.
- Lista de endpoints documentados e estado dos webhooks.

A chave nunca aparece nos resultados — há um teste automatizado que verifica isso.

---

## 6. Painéis

**Administração** (`/admin`): total de pedidos, pendentes, pagos, em preparação, em
distribuição, entregues, receita confirmada, notificações da equipa, atribuição de
entregador, mudança de estado com transições validadas, histórico de transacções, gestão de
produtos (criar/editar/activar/destacar/stock), clientes, entregadores (criar, suspender,
repor palavra-passe) e relatórios financeiros (diário, por método, top produtos, ledger).

**Entregador** (`/entregador`): entregas atribuídas, endereço, telefone do cliente (com
ligação directa), notas, histórico e actualização de estado — *marcar recolhido / em
trânsito* (`OUT_FOR_DELIVERY`) e *entregue* (`DELIVERED`), apenas se o pagamento estiver
confirmado.

**Cliente** (`/conta`): pedidos, totais, endereços guardados e detalhe com acompanhamento.

---

## 7. Testes

`npm test` (`scripts/test-suite.mjs`) executa 27 verificações reais contra a aplicação:

```
27 passaram · 0 falharam
```

Cobre: health/schema, catálogo, registo, duplicados, validação, login/logout, palavra-passe
errada, carrinho, criação de pedido com cálculo no servidor e promoções, produto inexistente,
rotas protegidas, criação de pagamento (sucesso real ou falha segura), garantia de que o
regresso à página de sucesso não marca como pago, idempotência, webhook não verificado,
RBAC cliente/entregador/admin, diagnóstico sem exposição da chave e renderização das páginas.

Resultados em `test-results.json`.

---

## 8. Limitações assumidas (integridade, não invenção)

- **A chave `NEVONPAY_SECRET_KEY` ainda não foi fornecida.** Sem ela, nenhuma cobrança é
  criada: `POST /api/payments/create` devolve `503 NEVONPAY_NOT_CONFIGURED` e o pedido fica
  pendente. Nada é simulado como pago. Assim que a chave `nv_test_…` for configurada, o
  fluxo fica completo sem alterações de código.
- A Nevon Pay exige também um *espaço de trabalho (comerciante)* criado na própria
  plataforma para a chave; se a chave existir mas não tiver comerciante activo, a API devolve
  `403/MERCHANT_INACTIVE` — o diagnóstico mostra a resposta exacta.
- `mpesa`/`emola` permanecem `503 PROVIDER_NOT_CONFIGURED` porque a própria Nevon Pay o
  indica na documentação; não foram inventados métodos alternativos.
- Webhooks não estão documentados; o handler é defensivo (ver §3).

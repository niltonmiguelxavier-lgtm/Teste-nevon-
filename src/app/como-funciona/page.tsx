import Link from "next/link";
import { formatMoney } from "@/lib/format";

export const metadata = { title: "Como funciona" };

export default function HowItWorksPage() {
  return (
    <div className="section">
      <div className="container">
        <div className="section-head">
          <div>
            <span className="eyebrow">Processo</span>
            <h1 style={{ fontSize: "clamp(1.9rem, 3.6vw, 2.7rem)" }}>Como funciona a entrega</h1>
            <p className="lead">
              Do pedido à porta, com estados claros e pagamento confirmado pela Nevon Pay.
            </p>
          </div>
        </div>

        <div className="grid grid--2" style={{ alignItems: "start" }}>
          <div className="card">
            <h3>1. Escolhe os produtos</h3>
            <p className="small muted">
              O catálogo mostra preço por unidade e stock actualizado. Adiciona ao carrinho e ajusta as
              quantidades — o carrinho fica guardado no teu dispositivo.
            </p>
            <div className="divider" />
            <h3>2. Define o endereço</h3>
            <p className="small muted">
              Indica quem recebe, telefone, rua, número, bairro, cidade e um ponto de referência. O
              custo de entrega é calculado antes de pagar: {formatMoney(15000)}, grátis acima de{" "}
              {formatMoney(150000)}.
            </p>
            <div className="divider" />
            <h3>3. Confirma o pedido</h3>
            <p className="small muted">
              O total é calculado no servidor com os preços reais dos produtos. Códigos promocionais
              são validados no servidor antes de aplicados.
            </p>
          </div>

          <div className="card">
            <h3>4. Paga com Nevon Pay</h3>
            <p className="small muted">
              O servidor cria uma transacção na Nevon Pay com uma chave de idempotência e encaminha-te
              para o ambiente de pagamento. A chave secreta nunca chega ao teu navegador.
            </p>
            <div className="divider" />
            <h3>5. O pagamento é confirmado</h3>
            <p className="small muted">
              Quando regressas ao site, o estado ainda não mudou. O sistema consulta a Nevon Pay com a
              chave secreta e só quando a resposta autenticada indica{" "}
              <code className="mono">COMPLETED</code> o pedido passa a <strong>Pagamento confirmado</strong>.
            </p>
            <div className="notice notice--info" style={{ marginTop: 14, marginBottom: 0 }}>
              <span>
                Nunca marcamos um pagamento como aprovado apenas porque voltaste à página de sucesso.
              </span>
            </div>
            <div className="divider" />
            <h3>6. Acompanha a entrega</h3>
            <p className="small muted">
              Recebido → Pagamento confirmado → Em preparação → Saiu para entrega → Entregue. Cada
              mudança fica registada com data e responsável.
            </p>
          </div>
        </div>

        <div className="section--tight">
          <h2 style={{ fontSize: "1.3rem" }}>Perguntas frequentes</h2>
          <div className="stack" style={{ marginTop: 14 }}>
            <details className="card card--flat">
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Que métodos de pagamento existem?</summary>
              <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
                A API Nevon Pay documenta três métodos: <code className="mono">sandbox</code>,{" "}
                <code className="mono">mpesa</code> e <code className="mono">emola</code>. No ambiente
                de testes apenas o sandbox está activo; M-Pesa e e-Mola devolvem 503 até a Nevon Pay
                disponibilizar o acesso oficial — não inventamos métodos que a API não oferece.
              </p>
            </details>
            <details className="card card--flat">
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>O pagamento pode ser cobrado duas vezes?</summary>
              <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
                Não. Cada pedido tem no máximo uma transacção activa (índice único na base de dados),
                os pedidos já pagos devolvem o estado existente e todas as chamadas enviam uma chave de
                idempotência à Nevon Pay.
              </p>
            </details>
            <details className="card card--flat">
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Guardam os dados do meu cartão?</summary>
              <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
                Não. O pagamento é efectuado no ambiente da Nevon Pay. A Express Delivery guarda apenas
                a referência da transacção, o valor e o estado.
              </p>
            </details>
            <details className="card card--flat">
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>O que acontece se o pagamento falhar?</summary>
              <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
                O pedido fica com pagamento pendente e podes gerar um novo pagamento na página do
                pedido. A transacção falhada fica registada no histórico para auditoria.
              </p>
            </details>
          </div>
        </div>

        <div className="row" style={{ marginTop: 24 }}>
          <Link href="/produtos" className="btn btn--green">
            Começar pedido
          </Link>
          <Link href="/acompanhar" className="btn btn--ghost">
            Acompanhar pedido
          </Link>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div>
            <Link href="/" className="brand" style={{ color: "#fff", marginBottom: 12 }}>
              <span className="brand__mark" style={{ background: "#12b76a", color: "#04231a" }} aria-hidden="true">
                ED
              </span>
              <span>
                Express Delivery
                <small style={{ color: "#8e9a97" }}>Maputo · Matola</small>
              </span>
            </Link>
            <p style={{ maxWidth: 320, fontSize: "0.88rem" }}>
              Entregas ao domicílio com acompanhamento em tempo real. Pagamentos online processados
              pela Nevon Pay em ambiente seguro.
            </p>
          </div>
          <div>
            <h4>Serviço</h4>
            <Link href="/produtos">Produtos</Link>
            <Link href="/como-funciona">Como funciona</Link>
            <Link href="/acompanhar">Acompanhar pedido</Link>
            <Link href="/carrinho">Carrinho</Link>
          </div>
          <div>
            <h4>Conta</h4>
            <Link href="/entrar">Iniciar sessão</Link>
            <Link href="/entrar?modo=registo">Criar conta</Link>
            <Link href="/conta">Os meus pedidos</Link>
            <Link href="/contactos">Apoio ao cliente</Link>
          </div>
          <div>
            <h4>Contactos</h4>
            <a href="tel:+258841234567">+258 84 123 4567</a>
            <a href="mailto:geral@expressdelivery.co.mz">geral@expressdelivery.co.mz</a>
            <span style={{ display: "block", padding: "4px 0" }}>Av. Julius Nyerere 1240, Maputo</span>
            <span style={{ display: "block", padding: "4px 0" }}>Seg–Sáb · 08h00–20h00</span>
          </div>
        </div>
        <div className="footer__bottom">
          <span>© {new Date().getFullYear()} Express Delivery, Lda. Todos os direitos reservados.</span>
          <span>
            Pagamentos: Nevon Pay · ambiente {process.env.NEVONPAY_SECRET_KEY?.startsWith("nv_live_") ? "produção" : "sandbox (testes)"}
          </span>
        </div>
      </div>
    </footer>
  );
}

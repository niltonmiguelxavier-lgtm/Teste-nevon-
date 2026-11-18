import Link from "next/link";

export const metadata = { title: "Contactos" };

export default function ContactsPage() {
  return (
    <div className="section">
      <div className="container">
        <div className="section-head">
          <div>
            <span className="eyebrow">Contactos</span>
            <h1 style={{ fontSize: "clamp(1.9rem, 3.6vw, 2.7rem)" }}>Estamos por aqui</h1>
            <p className="lead">
              Apoio ao cliente de segunda a sábado, 08h00–20h00. Para entregas em curso, liga
              directamente ao entregador indicado na página do pedido.
            </p>
          </div>
        </div>

        <div className="contact">
          <div>
            <ul className="contact__list">
              <li>
                <div>
                  <b>Telefone / WhatsApp</b>
                  <span>
                    <a href="tel:+258841234567" style={{ color: "var(--green-dark)", fontWeight: 600 }}>
                      +258 84 123 4567
                    </a>
                  </span>
                </div>
              </li>
              <li>
                <div>
                  <b>Email</b>
                  <span>
                    <a href="mailto:geral@expressdelivery.co.mz" style={{ color: "var(--green-dark)", fontWeight: 600 }}>
                      geral@expressdelivery.co.mz
                    </a>
                  </span>
                </div>
              </li>
              <li>
                <div>
                  <b>Escritório e armazém</b>
                  <span>Av. Julius Nyerere 1240, Maputo</span>
                </div>
              </li>
              <li>
                <div>
                  <b>Horário</b>
                  <span>Segunda a Sábado · 08h00–20h00 · Domingo 09h00–14h00</span>
                </div>
              </li>
              <li>
                <div>
                  <b>Zonas de entrega</b>
                  <span>Maputo cidade, Matola, Marracuene</span>
                </div>
              </li>
            </ul>

            <div className="row" style={{ marginTop: 20 }}>
              <Link href="/produtos" className="btn btn--green">
                Fazer pedido
              </Link>
              <Link href="/acompanhar" className="btn btn--ghost">
                Acompanhar entrega
              </Link>
            </div>
          </div>

          <div className="map">
            <div className="map__fallback" aria-hidden="true">
              <strong>Express Delivery</strong>
              <span>Av. Julius Nyerere 1240, Maputo — Maputo, Moçambique</span>
              <span className="small">Maputo · Matola · Marracuene</span>
            </div>
            <iframe
              title="Mapa da zona de entrega — Maputo"
              src="https://www.openstreetmap.org/export/embed.html?bbox=32.5200%2C-26.0200%2C32.6600%2C-25.8900&layer=mapnik&marker=-25.9667%2C32.5833"
              loading="lazy"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

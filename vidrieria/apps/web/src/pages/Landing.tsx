import { Link } from 'react-router-dom';

/** Portada de Lumina (cuando no se entra por el dominio de una vidriería). */
export function Landing() {
  return (
    <div className="landing">
      <header className="landing-top">
        <span className="auth-brand">
          <span className="brand-mark" aria-hidden="true" /> Lumina
        </span>
        <Link to="/login" className="btn small">
          Entrar
        </Link>
      </header>
      <main className="landing-main">
        <p className="eyebrow">Para vidrierías</p>
        <h1>Tu web que trae clientes y presupuestos en 2 minutos</h1>
        <p className="lead">
          Una página para tu vidriería donde te piden presupuesto con medidas y fotos, y un panel para armar presupuestos con tus precios en dólares, desperdicio, cantos, colocación y
          flete. Lo mandás por WhatsApp y el cliente lo acepta con un toque.
        </p>
        <div className="row wrap">
          <Link to="/crear-cuenta" className="btn primary">
            Crear cuenta para mi vidriería
          </Link>
          <Link to="/cristales-ariel" className="btn">
            Ver una web de ejemplo
          </Link>
        </div>
        <ul className="landing-points">
          <li>
            <strong>Presupuestos por plantilla.</strong> Mampara, box, espejo, cambio de vidrio, barandas: cargás ancho × alto y sale el precio.
          </li>
          <li>
            <strong>Dólar al día.</strong> Tus precios en dólares se pasan solos a pesos.
          </li>
          <li>
            <strong>Seguimiento.</strong> Te avisa qué presupuestos no respondieron y les escribís con un toque.
          </li>
          <li>
            <strong>Lista del proveedor.</strong> La importás desde Excel y subís precios por porcentaje.
          </li>
        </ul>
      </main>
      <footer className="panel-foot">Hecho por Lumina</footer>
    </div>
  );
}

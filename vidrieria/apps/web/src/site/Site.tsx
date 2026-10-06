import { useMutation, useQuery } from '@tanstack/react-query';
import { type CSSProperties, useEffect, useState } from 'react';
import { waLink } from '@vidrieria/shared';
import { ApiError, api, errMsg } from '../api';
import { Loading } from '../components/ui';
import { shrinkToDataUrl } from '../lib/image';
import type { PublicBusiness } from '../lib/types';

/** Si una imagen no carga (ej. todavía no se subió), no se muestra el ícono roto. */
const hideBroken = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.display = 'none';
};

interface SiteData {
  business: PublicBusiness;
  jobKinds: string[];
}

/** Web pública de una vidriería: presenta el negocio y lleva a pedir presupuesto. Sin precios. */
export function Site({ slug }: { slug: string }) {
  const q = useQuery({ queryKey: ['site', slug], queryFn: () => api<SiteData>(`/public/site/${encodeURIComponent(slug)}`) });
  useEffect(() => {
    if (q.data) document.title = `${q.data.business.name} · ${q.data.business.site.headline}`;
  }, [q.data]);
  if (q.isLoading) return <Loading />;
  if (q.error instanceof ApiError && q.error.status === 404)
    return (
      <div className="auth">
        <div className="auth-card">
          <h1>No encontramos esta página</h1>
          <p className="muted">Revisá el link.</p>
        </div>
      </div>
    );
  if (!q.data) return <p className="error pad">{errMsg(q.error)}</p>;
  const b = q.data.business;
  const s = b.site;
  const style = { '--brand': s.primaryColor, '--brand-accent': s.accentColor } as CSSProperties;
  const wa = waLink(b.whatsapp, `¡Hola ${b.name}! Quería hacer una consulta.`);

  return (
    <div className="site" style={style}>
      <header className="site-top">
        <a href="#inicio" className="site-brand">
          {b.logo ? <img src={b.logo} alt="" /> : <span className="site-mark" aria-hidden="true" />}
          <span>{b.name}</span>
        </a>
        <nav className="site-nav" aria-label="Secciones">
          <a href="#servicios">Servicios</a>
          {!!s.gallery.length && <a href="#trabajos">Trabajos</a>}
          <a href="#como">Cómo trabajamos</a>
          <a href="#presupuesto" className="site-cta-sm">
            Pedí presupuesto
          </a>
        </nav>
      </header>

      <section className="site-hero" id="inicio">
        <div className="site-hero-text">
          {b.zones && <p className="site-eyebrow">{b.zones}</p>}
          <h1>{s.headline || b.name}</h1>
          <p className="site-lead">{s.subheadline}</p>
          <div className="row wrap">
            <a href="#presupuesto" className="site-btn">
              Pedí tu presupuesto
            </a>
            <a href={wa} className="site-btn ghost" target="_blank" rel="noreferrer">
              Escribinos por WhatsApp
            </a>
          </div>
        </div>
        {s.heroImage && (
          <figure className="site-hero-img">
            <img src={s.heroImage} alt={`Trabajo de ${b.name}`} onError={hideBroken} />
          </figure>
        )}
      </section>

      <section className="site-section" id="servicios">
        <h2>Lo que hacemos</h2>
        <div className="site-services">
          {s.services.map((x, i) => (
            <article key={i} className="site-service">
              {x.image && <img src={x.image} alt="" loading="lazy" onError={hideBroken} />}
              <div>
                <h3>{x.title}</h3>
                <p>{x.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {!!s.gallery.length && (
        <section className="site-section" id="trabajos">
          <h2>Trabajos hechos</h2>
          <div className="site-gallery">
            {s.gallery.map((g, i) => (
              <figure key={i}>
                <img src={g.image} alt={g.caption || 'Trabajo terminado'} loading="lazy" onError={hideBroken} />
                {g.caption && <figcaption>{g.caption}</figcaption>}
              </figure>
            ))}
          </div>
        </section>
      )}

      <section className="site-section alt" id="como">
        <h2>Cómo trabajamos</h2>
        <ol className="site-steps">
          {s.steps.map((x, i) => (
            <li key={i}>
              <span className="site-step-n">{i + 1}</span>
              <h3>{x.title}</h3>
              <p>{x.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="site-section" id="presupuesto">
        <div className="site-form-wrap">
          <div>
            <h2>Pedí tu presupuesto</h2>
            <p>Contanos qué necesitás. Con medidas aproximadas y una foto te respondemos más rápido por WhatsApp.</p>
            <ul className="site-trust">
              {b.zones && <li>Trabajamos en {b.zones}</li>}
              {b.hours && <li>{b.hours}</li>}
              <li>Medimos antes de fabricar: no hace falta que las medidas sean exactas</li>
            </ul>
          </div>
          <LeadForm slug={b.slug} kinds={q.data.jobKinds} businessName={b.name} whatsapp={b.whatsapp} />
        </div>
      </section>

      {!!s.faqs.length && (
        <section className="site-section alt" id="preguntas">
          <h2>Preguntas frecuentes</h2>
          <div className="site-faqs">
            {s.faqs.map((f, i) => (
              <details key={i}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <footer className="site-foot">
        <div>
          <strong>{b.name}</strong>
          {b.address && <p>{b.address}</p>}
          {b.hours && <p>{b.hours}</p>}
        </div>
        <div>
          {b.whatsapp && (
            <p>
              WhatsApp: <a href={wa}>{b.whatsapp}</a>
            </p>
          )}
          {b.instagram && <p>Instagram: {b.instagram}</p>}
          {s.illustrativeImages && <p className="small">Imágenes ilustrativas.</p>}
        </div>
        <p className="site-credit">Hecho por Lumina</p>
      </footer>

      <a className="site-wa-float" href={wa} target="_blank" rel="noreferrer" aria-label="Escribinos por WhatsApp">
        <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
          <path
            fill="currentColor"
            d="M16 3a13 13 0 0 0-11.3 19.4L3 29l6.8-1.8A13 13 0 1 0 16 3zm0 23.6c-2 0-4-.5-5.7-1.6l-.4-.2-4 1 1.1-3.9-.3-.4A10.6 10.6 0 1 1 16 26.6zm5.8-7.9c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.7 8.7 0 0 1-4.3-3.8c-.3-.6.3-.5.9-1.6.1-.2 0-.4 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.9-.8 2.1-1.5.3-.7.3-1.3.2-1.5-.1-.1-.3-.2-.6-.3z"
          />
        </svg>
      </a>
    </div>
  );
}

/** De dónde llegó el visitante: cartel con QR (?c=), link de recomendación (?ref=) o el sitio que lo trajo. Se recuerda en la visita. */
function visitOrigin(slug: string) {
  const KEY = 'vd_origin';
  try {
    const params = new URLSearchParams(location.search);
    const ref = params.get('ref');
    const sign = params.get('c');
    const referrer = document.referrer && !document.referrer.startsWith(location.origin) ? document.referrer : '';
    if (ref || sign || referrer) {
      const o = { ref, sign, referrer };
      sessionStorage.setItem(KEY, JSON.stringify(o));
      if (sign && !sessionStorage.getItem(`${KEY}:visit:${sign}`)) {
        sessionStorage.setItem(`${KEY}:visit:${sign}`, '1');
        void fetch(`/api/public/site/${encodeURIComponent(slug)}/signs/${encodeURIComponent(sign)}/visit`, { method: 'POST' }).catch(() => {});
      }
      return o;
    }
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { ref: string | null; sign: string | null; referrer: string } | null;
  } catch {
    return null;
  }
}

function LeadForm({ slug, kinds, businessName, whatsapp }: { slug: string; kinds: string[]; businessName: string; whatsapp: string }) {
  const [f, setF] = useState({ kind: '', widthCm: '', heightCm: '', quantity: '1', details: '', zone: '', name: '', phone: '', when: '', website: '' });
  const [photos, setPhotos] = useState<string[]>([]);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const n = (v: string) => (v.trim() ? Number(v.replace(',', '.')) || null : null);
  const [origin] = useState(() => visitOrigin(slug));
  const m = useMutation({
    mutationFn: () =>
      api(`/public/site/${encodeURIComponent(slug)}/leads`, {
        body: {
          kind: f.kind,
          widthCm: n(f.widthCm),
          heightCm: n(f.heightCm),
          quantity: Math.max(1, Math.round(n(f.quantity) ?? 1)),
          details: f.details,
          zone: f.zone,
          name: f.name,
          phone: f.phone,
          when: f.when,
          website: f.website,
          photos,
          ref: origin?.ref ?? null,
          sign: origin?.sign ?? null,
          referrer: origin?.referrer ?? null,
        },
      }),
  });

  if (m.isSuccess) {
    const summary = [
      `¡Hola ${businessName}! Les dejé una consulta en la web:`,
      `• ${f.kind}${f.widthCm && f.heightCm ? ` de ${f.widthCm} × ${f.heightCm} cm` : ''}${Number(f.quantity) > 1 ? ` (${f.quantity})` : ''}`,
      f.zone && `• Zona: ${f.zone}`,
      f.details && `• ${f.details}`,
      `Soy ${f.name}.`,
    ]
      .filter(Boolean)
      .join('\n');
    return (
      <div className="site-form done" role="status">
        <h3>¡Listo, {f.name.split(' ')[0]}! Recibimos tu consulta.</h3>
        <p>Te vamos a escribir al {f.phone} con el presupuesto. Si es urgente, avisanos por WhatsApp.</p>
        <a className="site-btn" href={waLink(whatsapp, summary)} target="_blank" rel="noreferrer">
          Avisar por WhatsApp
        </a>
      </div>
    );
  }

  return (
    <form
      className="site-form"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <label className="field wide">
        <span className="field-label">¿Qué necesitás?</span>
        <select value={f.kind} onChange={set('kind')} required>
          <option value="">Elegí una opción</option>
          {kinds.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <fieldset className="site-measures">
        <legend>Medidas aproximadas (opcional)</legend>
        <label className="field">
          <span className="field-label">Ancho (cm)</span>
          <input inputMode="decimal" value={f.widthCm} onChange={set('widthCm')} placeholder="120" />
        </label>
        <label className="field">
          <span className="field-label">Alto (cm)</span>
          <input inputMode="decimal" value={f.heightCm} onChange={set('heightCm')} placeholder="180" />
        </label>
        <label className="field">
          <span className="field-label">Cantidad</span>
          <input inputMode="numeric" value={f.quantity} onChange={set('quantity')} />
        </label>
      </fieldset>
      <label className="field wide">
        <span className="field-label">Contanos un poco más (opcional)</span>
        <textarea rows={3} value={f.details} onChange={set('details')} placeholder="Ej.: mampara corrediza para bañera, herrajes negros" />
      </label>
      <div className="field wide">
        <span className="field-label">Fotos del lugar (opcional, hasta 3)</span>
        <div className="site-photos">
          {photos.map((p, i) => (
            <span key={i} className="site-photo">
              <img src={p} alt={`Foto ${i + 1}`} />
              <button type="button" aria-label="Quitar foto" onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>
                ✕
              </button>
            </span>
          ))}
          {photos.length < 3 && (
            <label className="site-photo-add">
              {busyPhoto ? 'Cargando…' : '+ Foto'}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setBusyPhoto(true);
                  try {
                    const url = await shrinkToDataUrl(file, 1400, 0.78);
                    setPhotos((p) => [...p, url].slice(0, 3));
                  } finally {
                    setBusyPhoto(false);
                  }
                }}
              />
            </label>
          )}
        </div>
      </div>
      <label className="field">
        <span className="field-label">Tu nombre</span>
        <input value={f.name} onChange={set('name')} autoComplete="name" required />
      </label>
      <label className="field">
        <span className="field-label">Tu WhatsApp</span>
        <input value={f.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" placeholder="11 2345-6789" required />
      </label>
      <label className="field">
        <span className="field-label">Barrio o localidad</span>
        <input value={f.zone} onChange={set('zone')} />
      </label>
      <label className="field">
        <span className="field-label">¿Para cuándo?</span>
        <select value={f.when} onChange={set('when')}>
          <option value="">Sin apuro</option>
          <option>Urgente</option>
          <option>Esta semana</option>
          <option>Este mes</option>
          <option>Estoy averiguando</option>
        </select>
      </label>
      {/* Campo trampa para bots: las personas no lo ven. */}
      <input className="hp" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} aria-hidden="true" />
      {m.error && (
        <p className="error wide" role="alert">
          {errMsg(m.error)}
        </p>
      )}
      <button className="site-btn wide" disabled={m.isPending || busyPhoto}>
        {m.isPending ? 'Enviando…' : 'Pedir presupuesto'}
      </button>
    </form>
  );
}

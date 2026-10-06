import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { LEAD_SOURCE_LABEL, type LeadSource } from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { Qr } from '../components/Qr';
import { ErrorBox, Field, Loading, copyText, toast } from '../components/ui';
import { dateTimeFmt } from '../lib/format';
import { useMe } from '../lib/me';
import { postCaption, stormMessage, waLink } from '../lib/whatsapp';

interface Mk {
  reviewUrl: string;
  referralBenefit: string;
  storm: { on: boolean; until: string | null };
  sources: { source: LeadSource; count: number }[];
  signs: { id: string; code: string; name: string; address: string; visits: number; leads: number }[];
  referrals: { id: string; name: string; phone: string; referralCode: string; leads: number }[];
  zones: { zone: string; customers: { id: string; name: string; phone: string }[] }[];
  beforeAfter: { id: string; number: number; title: string; kind: string; glass: string; size: string; zone: string; photos: { id: string; after: boolean; published: boolean }[] }[];
}

const qrPage = (u: string, t: string, s = '') => `/qr?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}${s ? `&s=${encodeURIComponent(s)}` : ''}`;

/** Marketing: Google, carteles de obra, recomendaciones, modo tormenta y fotos de obras para redes y la web. */
export default function Marketing() {
  const qc = useQueryClient();
  const me = useMe();
  const q = useQuery({ queryKey: ['marketing'], queryFn: () => api<Mk>('/marketing') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['marketing'] });
  const [review, setReview] = useState<string | null>(null);
  const [benefit, setBenefit] = useState<string | null>(null);
  const [sign, setSign] = useState({ name: '', address: '' });
  const saveBiz = useMutation({
    mutationFn: (body: Record<string, string>) => api('/business', { method: 'PATCH', body }),
    onSuccess: () => (refresh(), toast('Guardado')),
    onError: (e) => toast(errMsg(e)),
  });
  const addSign = useMutation({
    mutationFn: () => api('/signs', { body: sign }),
    onSuccess: () => (refresh(), setSign({ name: '', address: '' })),
    onError: (e) => toast(errMsg(e)),
  });
  const delSign = useMutation({ mutationFn: (id: string) => api(`/signs/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const storm = useMutation({
    mutationFn: (on: boolean) => api('/storm', { body: { on } }),
    onSuccess: (_r, on) => (refresh(), toast(on ? 'Modo tormenta activado por 48 horas' : 'Modo tormenta apagado')),
  });
  const publish = useMutation({
    mutationFn: (p: { jobId: string; photoId: string; caption: string; kind: string; zone: string }) => api(`/jobs/${p.jobId}/publish`, { body: p }),
    onSuccess: () => (refresh(), toast('Listo: ya está en "Trabajos hechos" de tu web')),
    onError: (e) => toast(errMsg(e)),
  });

  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const m = q.data;
  const slug = me.data?.business.slug ?? '';
  const name = me.data?.business.name ?? '';
  const site = `${location.origin}/${slug}`;
  const reviewUrl = review ?? m.reviewUrl;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Marketing</h1>
          <p className="muted small">Que te encuentren, que te recomienden y que vuelvan.</p>
        </div>
      </div>

      <section className="card">
        <h2>De dónde llegan tus clientes</h2>
        <p className="muted small">Consultas de los últimos 90 días.</p>
        {!m.sources.length ? (
          <p className="muted">Todavía no hay consultas.</p>
        ) : (
          <div className="mini-stats">
            {m.sources.map((s) => (
              <div key={s.source}>
                <strong>{s.count}</strong>
                <span>{LEAD_SOURCE_LABEL[s.source]}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Google</h2>
        <p className="muted small">
          Los 3 primeros del mapa de Google se llevan la mayoría de las llamadas, y las reseñas pesan mucho. Pedirla el día que colocás, a todos los clientes, es lo que más rinde. Los pedidos aparecen en Inicio, en "Para mandar hoy".
        </p>
        <ol className="steps-list small">
          <li>
            Entrá a <a href="https://business.google.com" target="_blank" rel="noreferrer">business.google.com</a> y creá o reclamá el perfil de tu vidriería.
          </li>
          <li>Si trabajás a domicilio, ocultá la dirección y cargá tus zonas (hasta 20 barrios o localidades).</li>
          <li>Subí fotos de trabajos: las fichas con fotos reciben más clics a la web.</li>
          <li>Poné el link de tu web ({site}) y tu WhatsApp.</li>
          <li>En el perfil, tocá "Pedir reseñas", copiá el link y pegalo acá abajo.</li>
        </ol>
        <div className="row wrap">
          <Field label="Link para dejar reseña">
            <input value={reviewUrl} onChange={(e) => setReview(e.target.value)} placeholder="https://g.page/r/…" />
          </Field>
          <button type="button" className="btn small" disabled={review == null} onClick={() => saveBiz.mutate({ reviewUrl: reviewUrl.trim() })}>
            Guardar
          </button>
        </div>
        {m.reviewUrl && (
          <div className="row wrap qr-row">
            <Qr text={m.reviewUrl} size={110} label="QR para dejar reseña" />
            <div className="stack-sm">
              <span className="small muted">Para poner en el presupuesto impreso, la factura o el local.</span>
              <a className="btn small" href={qrPage(m.reviewUrl, '¿Cómo te atendimos?', `Dejanos tu opinión en Google · ${name}`)} target="_blank" rel="noreferrer">
                Imprimir QR de reseñas
              </a>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Carteles de obra</h2>
        <p className="muted small">Cada cartel con su QR: sabés cuántos lo escanearon y cuántas consultas trajo.</p>
        <div className="row wrap">
          <input value={sign.name} onChange={(e) => setSign({ ...sign, name: e.target.value })} placeholder="Ej.: Obra Mitre 1200" aria-label="Nombre del cartel" />
          <input value={sign.address} onChange={(e) => setSign({ ...sign, address: e.target.value })} placeholder="Dirección (opcional)" aria-label="Dirección" />
          <button type="button" className="btn small primary" disabled={!sign.name.trim() || addSign.isPending} onClick={() => addSign.mutate()}>
            + Cartel
          </button>
        </div>
        <ul className="list">
          {m.signs.map((s) => {
            const url = `${site}?c=${s.code}`;
            return (
              <li key={s.id} className="list-row">
                <Qr text={url} size={64} label={`QR de ${s.name}`} />
                <span className="grow">
                  <strong>{s.name}</strong>
                  <span className="muted small block">
                    {s.visits} escaneos · {s.leads} consultas{s.address && ` · ${s.address}`}
                  </span>
                </span>
                <a className="btn small" href={qrPage(url, name, 'Escaneá y pedí tu presupuesto')} target="_blank" rel="noreferrer">
                  Imprimir
                </a>
                <button type="button" className="icon-btn" aria-label={`Borrar ${s.name}`} onClick={() => delSign.mutate(s.id)}>
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <h2>Recomendaciones</h2>
        <p className="muted small">
          Cada cliente tiene su link (en Clientes → "Link de recomendación"). El que entra por ahí ve quién lo recomendó y el beneficio. Dar un beneficio por recomendar está permitido; por una reseña, no.
        </p>
        <div className="row wrap">
          <Field label="Beneficio para el que llega recomendado">
            <input value={benefit ?? m.referralBenefit} onChange={(e) => setBenefit(e.target.value)} placeholder="Ej.: 10 % de descuento en la colocación" />
          </Field>
          <button type="button" className="btn small" disabled={benefit == null} onClick={() => saveBiz.mutate({ referralBenefit: (benefit ?? '').trim() })}>
            Guardar
          </button>
        </div>
        {!!m.referrals.length && (
          <ul className="list">
            {m.referrals.map((r) => (
              <li key={r.id} className="list-row">
                <span className="grow">
                  <strong>{r.name}</strong>
                  <span className="muted small block">
                    {r.leads} consulta{r.leads === 1 ? '' : 's'} recomendada{r.leads === 1 ? '' : 's'}
                  </span>
                </span>
                <button type="button" className="btn small" onClick={() => void copyText(`${site}?ref=${r.referralCode}`)}>
                  Copiar link
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={'card' + (m.storm.on ? ' attention-card' : '')}>
        <div className="row between wrap">
          <h2>Modo tormenta</h2>
          <button type="button" className={'btn ' + (m.storm.on ? '' : 'primary')} onClick={() => storm.mutate(!m.storm.on)}>
            {m.storm.on ? 'Apagar' : 'Activar por 48 horas'}
          </button>
        </div>
        <p className="muted small">
          Después de una tormenta o granizo: la web muestra un cartel de "atendemos urgencias" y acá tenés a tus clientes por barrio para escribirles.
          {m.storm.on && m.storm.until && ` Activo hasta el ${dateTimeFmt(m.storm.until)}.`}
        </p>
        {m.storm.on && (
          <div className="zones">
            {m.zones.map((z) => (
              <details key={z.zone}>
                <summary>
                  {z.zone} · {z.customers.length} cliente{z.customers.length > 1 ? 's' : ''}
                </summary>
                <ul className="list">
                  {z.customers.map((c) => (
                    <li key={c.id} className="list-row small">
                      <span className="grow">{c.name}</span>
                      <a className="btn wa small" href={waLink(c.phone, stormMessage(c.name, name))} target="_blank" rel="noreferrer">
                        WhatsApp
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Antes y después</h2>
        <p className="muted small">Las fotos que suben los colocadores al terminar. Copiá el texto para Instagram o Google, o sumalas a "Trabajos hechos" de tu web.</p>
        {!m.beforeAfter.length ? (
          <p className="muted">Aparecen cuando un equipo sube fotos desde su ficha.</p>
        ) : (
          m.beforeAfter.map((j) => {
            const caption = postCaption(j, name, site);
            return (
              <div key={j.id} className="before-after">
                <strong>
                  N° {j.number} · {j.title}
                  {j.zone && <span className="muted"> · {j.zone}</span>}
                </strong>
                <div className="photos">
                  {j.photos.map((p) => (
                    <span key={p.id} className="render-thumb">
                      <img src={`/api/assets/${p.id}`} alt={p.after ? 'Después' : 'Antes'} />
                      <span className="photo-tag">{p.after ? 'después' : 'antes'}</span>
                      {p.after &&
                        (p.published ? (
                          <span className="pill good small-pill photo-pub">en la web</span>
                        ) : (
                          <button
                            type="button"
                            className="btn small photo-pub"
                            onClick={() => publish.mutate({ jobId: j.id, photoId: p.id, caption: `${j.title}${j.zone ? ` en ${j.zone}` : ''}`, kind: j.kind, zone: j.zone })}
                          >
                            A mi web
                          </button>
                        ))}
                    </span>
                  ))}
                </div>
                <textarea readOnly rows={4} value={caption} className="small" aria-label="Texto para redes" />
                <button type="button" className="btn small" onClick={() => void copyText(caption)}>
                  Copiar texto
                </button>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

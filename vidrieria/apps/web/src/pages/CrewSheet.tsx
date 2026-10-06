import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useState } from 'react';
import { useParams } from 'react-router-dom';
import { TWO_PEOPLE_KG } from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { PieceSketch } from '../components/PieceSketch';
import { Loading } from '../components/ui';
import { dayName, hourFmt, mapsUrl, qty } from '../lib/format';
import { shrinkToDataUrl } from '../lib/image';
import type { CrewSheet as Sheet } from '../lib/types';
import { waLink, warrantyUrl } from '../lib/whatsapp';

const CHECKS = [
  ['medidas', 'Medidas verificadas en el lugar'],
  ['vidrio', 'Vidrio revisado: sin fallas ni golpes'],
  ['seguridad', 'Guantes, ventosas y cinchas'],
  ['limpio', 'Lugar limpio y restos retirados'],
  ['cliente', 'Cliente avisado (silicona, uso y garantía)'],
] as const;

/** Ficha del colocador: se abre con el link, sin usuario, desde el celular. */
export function CrewSheetPage() {
  const { token } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['crew-sheet', token], queryFn: () => api<Sheet>(`/public/jobs/${token}`) });
  const [checks, setChecks] = useState<Record<string, boolean> | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['crew-sheet', token] });
  const arrived = useMutation({ mutationFn: () => api(`/public/jobs/${token}/arrived`, { method: 'POST' }), onSuccess: refresh });
  const done = useMutation({ mutationFn: (checklist: Record<string, boolean>) => api(`/public/jobs/${token}/done`, { body: { checklist } }), onSuccess: refresh });
  const photos = useMutation({
    mutationFn: async ({ kind, files }: { kind: 'before' | 'after'; files: FileList }) => {
      const list = await Promise.all(Array.from(files).slice(0, 4).map((f) => shrinkToDataUrl(f, 1600, 0.8)));
      return api(`/public/jobs/${token}/photos`, { body: { kind, photos: list } });
    },
    onSuccess: refresh,
  });
  if (q.isLoading) return <Loading />;
  if (!q.data)
    return (
      <div className="auth">
        <div className="auth-card">
          <h1>No encontramos este trabajo</h1>
          <p className="muted">{errMsg(q.error)}</p>
        </div>
      </div>
    );
  const s = q.data;
  const c = checks ?? s.checklist ?? {};
  const finished = s.status === 'INSTALLED' || s.status === 'CLOSED';
  const style = { '--brand': s.business.primaryColor } as CSSProperties;
  return (
    <div className="crew" style={style}>
      <header className="crew-head">
        <span className="mono">{s.business.name}</span>
        <h1>
          N° {s.number} {s.title && `· ${s.title}`}
        </h1>
        {s.scheduledAt && (
          <p>
            {dayName(s.scheduledAt)} · {hourFmt(s.scheduledAt)} hs{s.crew && ` · ${s.crew}`}
          </p>
        )}
      </header>

      <section className="crew-card">
        <h2>Dónde</h2>
        <p className="big">{s.address || 'Sin dirección cargada'}</p>
        <div className="row wrap">
          {s.address && (
            <a className="btn primary" href={mapsUrl(s.address)} target="_blank" rel="noreferrer">
              Abrir en Maps
            </a>
          )}
          {s.customer?.phone && (
            <a className="btn wa" href={waLink(s.customer.phone, `¡Hola ${s.customer.name.split(' ')[0]}! Somos de ${s.business.name}, estamos llegando.`)} target="_blank" rel="noreferrer">
              WhatsApp a {s.customer.name.split(' ')[0]}
            </a>
          )}
          {s.customer?.phone && (
            <a className="btn" href={`tel:${s.customer.phone.replace(/\D/g, '')}`}>
              Llamar
            </a>
          )}
        </div>
        {!s.arrivedAt && !finished && (
          <button type="button" className="btn block" disabled={arrived.isPending} onClick={() => arrived.mutate()}>
            Llegamos
          </button>
        )}
      </section>

      <section className="crew-card">
        <h2>Piezas</h2>
        <ul className="crew-pieces">
          {s.pieces.map((p, i) => (
            <li key={i}>
              <PieceSketch widthMm={p.widthMm} heightMm={p.heightMm} quantity={p.quantity} />
              <div>
                <strong>{p.title}</strong>
                <span className="mono block">
                  {qty(p.widthMm)} × {qty(p.heightMm)} mm{p.quantity > 1 ? ` · ${p.quantity} u` : ''}
                </span>
                {p.glass && <span className="block">{p.glass}</span>}
                {p.weightKg != null && (
                  <span className={'block ' + (p.weightKg >= TWO_PEOPLE_KG ? 'heavy' : 'muted')}>
                    {qty(p.weightKg)} kg por pieza{p.weightKg >= TWO_PEOPLE_KG ? ' · van 2 personas o ventosas' : ''}
                  </span>
                )}
                {!!p.includes.length && <span className="small muted block">Lleva: {p.includes.join(', ')}</span>}
              </div>
            </li>
          ))}
        </ul>
        {!!s.extras.length && <p className="small muted">Además: {s.extras.join(', ')}.</p>}
        {(s.installNotes || s.notes) && <p className="crew-notes">{[s.installNotes, s.notes].filter(Boolean).join('\n')}</p>}
      </section>

      <section className="crew-card">
        <h2>Fotos</h2>
        <p className="small muted">
          Antes: {s.photos.before} · Después: {s.photos.after}. Las de después van a la web (con permiso del cliente) y sirven para la garantía.
        </p>
        <div className="row wrap">
          {(['before', 'after'] as const).map((kind) => (
            <label key={kind} className={'btn' + (photos.isPending ? ' busy' : '')}>
              {kind === 'before' ? 'Foto de antes' : 'Foto de después'}
              <input type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files?.length && photos.mutate({ kind, files: e.target.files })} />
            </label>
          ))}
        </div>
        {photos.error && <p className="error">{errMsg(photos.error)}</p>}
      </section>

      <section className="crew-card">
        <h2>Antes de irse</h2>
        {CHECKS.map(([k, label]) => (
          <label key={k} className="check big-check">
            <input type="checkbox" checked={!!c[k]} disabled={finished} onChange={(e) => setChecks({ ...c, [k]: e.target.checked })} />
            {label}
          </label>
        ))}
        {finished ? (
          <p className="pq-banner good">Trabajo terminado. ¡Gracias!</p>
        ) : (
          <button type="button" className="btn primary block" disabled={done.isPending} onClick={() => done.mutate(c)}>
            Terminamos
          </button>
        )}
        <p className="small muted">
          Pegá la etiqueta de garantía en el trabajo. Si no la tenés impresa, el cliente puede abrir: <span className="mono break-all">{warrantyUrl(s.warrantyToken)}</span>
        </p>
      </section>
      <p className="site-credit">Hecho por Lumina</p>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { waLink } from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { Qr } from '../components/Qr';
import { Loading } from '../components/ui';
import { dateFmt, qty } from '../lib/format';
import type { WarrantyInfo } from '../lib/types';

/** Garantía del trabajo: la abre el cliente con el QR pegado. Con ?etiqueta=1 es la etiqueta para imprimir. */
export function WarrantyPage() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ['warranty', token], queryFn: () => api<WarrantyInfo>(`/public/warranty/${token}`) });
  if (q.isLoading) return <Loading />;
  if (!q.data)
    return (
      <div className="auth">
        <div className="auth-card">
          <h1>No encontramos esta garantía</h1>
          <p className="muted">{errMsg(q.error)}</p>
        </div>
      </div>
    );
  const w = q.data;
  const b = w.business;
  const style = { '--brand': b.primaryColor, '--brand-accent': b.accentColor } as CSSProperties;
  const url = `${location.origin}/g/${token}`;

  if (params.get('etiqueta') === '1')
    return (
      <div className="label-page" style={style}>
        <div className="label">
          <Qr text={url} size={150} />
          <div>
            <strong>{b.name}</strong>
            <span>Garantía y service</span>
            <span className="mono">Trabajo N° {w.number}</span>
            <span className="small">Escaneá el código</span>
          </div>
        </div>
        <p className="no-print muted small">Imprimilo (Ctrl + P) y pegalo en un borde del vidrio o del marco.</p>
      </div>
    );

  const valid = w.until ? new Date(w.until).getTime() > Date.now() : true;
  return (
    <div className="pq" style={style}>
      <article className="pq-doc">
        <header className="pq-head">
          <div className="site-brand">
            {b.logo ? <img src={b.logo} alt="" /> : <span className="site-mark" aria-hidden="true" />}
            <span>{b.name}</span>
          </div>
          <div className="pq-meta">
            <strong>Garantía · trabajo N° {w.number}</strong>
            {w.installedAt && <span>Colocado el {dateFmt(w.installedAt)}</span>}
          </div>
        </header>
        <h1>{w.customer ? `${w.customer}, este es tu trabajo` : 'Tu trabajo'}</h1>
        <p className={'pq-banner ' + (valid ? 'good' : 'warn')}>
          {w.until ? (valid ? `Garantía vigente hasta el ${dateFmt(w.until)} (${w.warrantyMonths} meses).` : `La garantía venció el ${dateFmt(w.until)}. Igual te ayudamos con el service.`) : `Garantía de ${w.warrantyMonths} meses desde la colocación.`}
        </p>
        <ul className="pq-items">
          {w.pieces.map((p, i) => (
            <li key={i}>
              <strong>{p.title}</strong>
              <span className="pq-size">
                {qty(p.widthMm)} × {qty(p.heightMm)} mm{p.quantity > 1 ? ` · ${p.quantity} u` : ''}
                {p.glass && ` · ${p.glass}`}
              </span>
            </li>
          ))}
        </ul>
        {w.crew && <p className="pq-small">Lo colocó: {w.crew}.</p>}
        <div className="pq-actions">
          <a className="site-btn" href={waLink(b.whatsapp, `¡Hola! Necesito un service del trabajo N° ${w.number}${w.title ? ` (${w.title})` : ''}.`)} target="_blank" rel="noreferrer">
            Pedir service
          </a>
          <a className="site-btn ghost" href={`/${b.slug}#presupuesto`}>
            Pedir otro presupuesto
          </a>
          {b.reviewUrl && (
            <a className="site-btn ghost" href={b.reviewUrl} target="_blank" rel="noreferrer">
              Dejanos tu opinión en Google
            </a>
          )}
        </div>
      </article>
      <p className="site-credit">Hecho por Lumina</p>
    </div>
  );
}

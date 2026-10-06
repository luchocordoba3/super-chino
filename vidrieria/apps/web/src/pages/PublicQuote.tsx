import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { waLink } from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { Loading } from '../components/ui';
import { dateFmt, money, qty } from '../lib/format';
import type { PublicQuote } from '../lib/types';

/** Lo que ve el cliente al abrir el link del presupuesto. */
export function PublicQuotePage() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const preview = params.get('preview') === '1';
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const q = useQuery({
    queryKey: ['public-quote', token],
    queryFn: () => api<PublicQuote>(`/public/quotes/${token}${preview ? '?preview=1' : ''}`),
    refetchOnWindowFocus: false,
  });
  const accept = useMutation({
    mutationFn: () => api(`/public/quotes/${token}/accept`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['public-quote', token] }),
  });
  if (q.isLoading) return <Loading />;
  if (!q.data)
    return (
      <div className="auth">
        <div className="auth-card">
          <h1>No encontramos este presupuesto</h1>
          <p className="muted">{errMsg(q.error)}</p>
        </div>
      </div>
    );
  const { quote: p, business: b } = q.data;
  const style = { '--brand': b.primaryColor, '--brand-accent': b.accentColor } as CSSProperties;
  const ask = waLink(b.whatsapp, `¡Hola! Tengo una consulta sobre el presupuesto N° ${p.number}.`);
  const accepted = p.status === 'ACCEPTED';
  const closed = p.status === 'EXPIRED' || p.status === 'REJECTED';

  return (
    <div className="pq" style={style}>
      {preview && <div className="pq-preview">Vista previa: así lo ve tu cliente. Abrirlo acá no lo marca como visto.</div>}
      <article className="pq-doc">
        <header className="pq-head">
          <div className="site-brand">
            {b.logo ? <img src={b.logo} alt="" /> : <span className="site-mark" aria-hidden="true" />}
            <span>{b.name}</span>
          </div>
          <div className="pq-meta">
            <strong>Presupuesto N° {p.number}</strong>
            <span>{dateFmt(p.createdAt)}</span>
          </div>
        </header>

        {p.customerName && <p className="pq-to">Para {p.customerName}</p>}
        {p.title && <h1>{p.title}</h1>}

        {accepted && <p className="pq-banner good">¡Presupuesto aceptado{p.acceptedAt ? ` el ${dateFmt(p.acceptedAt)}` : ''}! Te vamos a escribir para coordinar.</p>}
        {p.status === 'EXPIRED' && <p className="pq-banner warn">Este presupuesto venció el {dateFmt(p.validUntil)}. Pedinos uno actualizado.</p>}
        {p.status === 'REJECTED' && <p className="pq-banner warn">Este presupuesto ya no está disponible.</p>}

        <ul className="pq-items">
          {p.items.map((it, i) => (
            <li key={i}>
              <div className="pq-item-head">
                <div>
                  <strong>{it.title}</strong>
                  <span className="pq-size">
                    {qty(it.widthMm)} × {qty(it.heightMm)} mm{it.quantity > 1 ? ` · ${it.quantity} unidades` : ''}
                  </span>
                </div>
                <span className="pq-amount">{money(it.total)}</span>
              </div>
              <p className="pq-includes">Incluye: {it.lines.map((l) => l.name).join(', ')}.</p>
            </li>
          ))}
          {p.extras.map((x, i) => (
            <li key={`x${i}`}>
              <div className="pq-item-head">
                <strong>{x.name}</strong>
                <span className="pq-amount">{money(x.total)}</span>
              </div>
            </li>
          ))}
        </ul>

        <dl className="pq-totals">
          {!!p.adjust && (
            <>
              <dt>{p.adjust < 0 ? 'Descuento especial' : 'Ajuste'}</dt>
              <dd>{money(p.adjust)}</dd>
            </>
          )}
          {!!p.urgency && (
            <>
              <dt>Urgencia</dt>
              <dd>{money(p.urgency)}</dd>
            </>
          )}
          {!!p.freight && (
            <>
              <dt>Traslado</dt>
              <dd>{money(p.freight)}</dd>
            </>
          )}
          {!!p.discount && (
            <>
              <dt>Descuento</dt>
              <dd>−{money(p.discount)}</dd>
            </>
          )}
          <dt className="grand">Total</dt>
          <dd className="grand">{money(p.total)}</dd>
          <dt>Seña para empezar ({qty(p.depositPct)} %)</dt>
          <dd>{money(p.deposit)}</dd>
          <dt>Saldo</dt>
          <dd>{money(p.balance)}</dd>
        </dl>
        <p className="pq-small">
          {p.pricesIncludeVat ? 'Precios con IVA incluido.' : `Incluye IVA (${money(p.vat)}).`} Válido hasta el {dateFmt(p.validUntil)}.
        </p>
        {p.notes && <p className="pq-notes">{p.notes}</p>}
        {p.footer && <p className="pq-small">{p.footer}</p>}

        <div className="pq-actions no-print">
          {!accepted && !closed && !preview && (
            <>
              {confirming ? (
                <div className="pq-confirm">
                  <p>¿Confirmás que aceptás el presupuesto por {money(p.total)}?</p>
                  <div className="row wrap">
                    <button className="site-btn" type="button" disabled={accept.isPending} onClick={() => accept.mutate()}>
                      Sí, acepto
                    </button>
                    <button className="site-btn ghost" type="button" onClick={() => setConfirming(false)}>
                      Volver
                    </button>
                  </div>
                </div>
              ) : (
                <button className="site-btn" type="button" onClick={() => setConfirming(true)}>
                  Acepto el presupuesto
                </button>
              )}
              {accept.error && <p className="error">{errMsg(accept.error)}</p>}
            </>
          )}
          <a className="site-btn ghost" href={ask} target="_blank" rel="noreferrer">
            Consultar por WhatsApp
          </a>
          <button className="site-btn ghost" type="button" onClick={() => window.print()}>
            Guardar PDF
          </button>
        </div>
        <footer className="pq-foot">
          {b.name}
          {b.address && ` · ${b.address}`}
          {b.whatsapp && ` · WhatsApp ${b.whatsapp}`}
        </footer>
      </article>
      <p className="site-credit no-print">Hecho por Lumina</p>
    </div>
  );
}

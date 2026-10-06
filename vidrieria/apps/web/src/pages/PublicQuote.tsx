import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { installments, safetyIssues, waLink } from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { PieceSketch } from '../components/PieceSketch';
import { Loading, copyText } from '../components/ui';
import { dateFmt, money, qty } from '../lib/format';
import { shrinkToDataUrl } from '../lib/image';
import type { PublicQuote, PublicResult } from '../lib/types';

/** Comprobante: las fotos se achican; los PDF van tal cual (hasta 3 MB). */
async function receiptDataUrl(f: File) {
  if (f.type.startsWith('image/')) return shrinkToDataUrl(f, 1600, 0.85);
  if (f.type !== 'application/pdf') throw new Error('Tiene que ser una foto o un PDF.');
  if (f.size > 3 * 1024 * 1024) throw new Error('El PDF es muy pesado (máximo 3 MB).');
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    r.readAsDataURL(f);
  });
}

/** Lo que ve el cliente al abrir el link del presupuesto. */
export function PublicQuotePage() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const preview = params.get('preview') === '1';
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [sel, setSel] = useState(0);
  const [ack, setAck] = useState(false);
  const q = useQuery({
    queryKey: ['public-quote', token],
    queryFn: () => api<PublicQuote>(`/public/quotes/${token}${preview ? '?preview=1' : ''}`),
    refetchOnWindowFocus: false,
  });
  const accept = useMutation({
    mutationFn: (option: number | null) => api(`/public/quotes/${token}/accept`, { body: { option, safetyAck: ack } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['public-quote', token] }),
  });
  const mp = useMutation({
    mutationFn: () => api<{ url: string }>(`/public/quotes/${token}/mp`, { body: { kind: 'SENA' } }),
    onSuccess: (r) => {
      location.href = r.url;
    },
  });
  const deposit = useMutation({
    mutationFn: async (f: File) => api(`/public/quotes/${token}/deposit`, { body: { file: await receiptDataUrl(f) } }),
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
  if (q.data.insurance) return <InsuranceDoc data={q.data} />;
  const { quote: p, business: b } = q.data;
  const style = { '--brand': b.primaryColor, '--brand-accent': b.accentColor } as CSSProperties;
  const ask = waLink(b.whatsapp, `¡Hola! Tengo una consulta sobre el presupuesto N° ${p.number}.`);
  const accepted = p.status === 'ACCEPTED';
  const closed = p.status === 'EXPIRED' || p.status === 'REJECTED';
  const options = !accepted && p.options?.length ? p.options : null;
  // Lo que se muestra: la opción elegida en pantalla o el presupuesto único.
  const view: PublicResult = options ? (options[sel] ?? options[0]) : p;
  const pay = b.pay;
  const issues = safetyIssues(view.items);
  const needsAck = !!issues.length && !p.safetyAckAt;
  const cuotas = installments(view.total, b.installments ?? {});

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

        {accepted && (
          <p className="pq-banner good">
            ¡Presupuesto aceptado{p.acceptedAt ? ` el ${dateFmt(p.acceptedAt)}` : ''}!{p.chosenLabel ? ` Elegiste: ${p.chosenLabel}.` : ''} Te vamos a escribir para coordinar.
          </p>
        )}
        {p.status === 'EXPIRED' && <p className="pq-banner warn">Este presupuesto venció el {dateFmt(p.validUntil)}. Pedinos uno actualizado.</p>}
        {p.status === 'REJECTED' && <p className="pq-banner warn">Este presupuesto ya no está disponible.</p>}

        {options && (
          <section className="pq-options no-print" aria-label="Opciones">
            <h2>Elegí una opción</h2>
            <div className="pq-opt-grid" role="radiogroup">
              {options.map((o, i) => (
                <button key={i} type="button" role="radio" aria-checked={i === sel} className={'pq-opt' + (i === sel ? ' on' : '')} onClick={() => (setSel(i), setConfirming(false))}>
                  <span className="pq-opt-label">{o.label}</span>
                  <strong>{money(o.total)}</strong>
                  <span className="pq-opt-sub">seña {money(o.deposit)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {options && <p className="pq-print-only">Opción: {options[sel]?.label}</p>}

        <ul className="pq-items">
          {view.items.map((it, i) => (
            <li key={i}>
              <div className="pq-item-row">
                <PieceSketch widthMm={it.widthMm} heightMm={it.heightMm} quantity={it.quantity} />
                <div className="pq-item-body">
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
                </div>
              </div>
            </li>
          ))}
          {view.extras.map((x, i) => (
            <li key={`x${i}`}>
              <div className="pq-item-head">
                <strong>{x.name}</strong>
                <span className="pq-amount">{money(x.total)}</span>
              </div>
            </li>
          ))}
        </ul>

        {!!p.renders.length && (
          <section className="pq-renders" aria-label="Así quedaría">
            <h2>Así quedaría</h2>
            <div className="pq-render-grid">
              {p.renders.map((u) => (
                <img key={u} src={u} alt="Cómo quedaría el trabajo" />
              ))}
            </div>
            <p className="pq-small">Imagen ilustrativa generada a partir de tu foto.</p>
          </section>
        )}

        <dl className="pq-totals">
          {!!view.adjust && (
            <>
              <dt>{view.adjust < 0 ? 'Descuento especial' : 'Ajuste'}</dt>
              <dd>{money(view.adjust)}</dd>
            </>
          )}
          {!!view.urgency && (
            <>
              <dt>Urgencia</dt>
              <dd>{money(view.urgency)}</dd>
            </>
          )}
          {!!view.freight && (
            <>
              <dt>Traslado</dt>
              <dd>{money(view.freight)}</dd>
            </>
          )}
          {!!view.discount && (
            <>
              <dt>Descuento</dt>
              <dd>−{money(view.discount)}</dd>
            </>
          )}
          <dt className="grand">Total</dt>
          <dd className="grand">{money(view.total)}</dd>
          <dt>Seña para empezar ({qty(p.depositPct)} %)</dt>
          <dd>{money(view.deposit)}</dd>
          <dt>Saldo</dt>
          <dd>{money(view.balance)}</dd>
        </dl>
        {!!cuotas.length && !accepted && (
          <p className="pq-cuotas">
            O en cuotas: {cuotas.map((c) => `${c.n} de ${money(c.each)}`).join(' · ')} <span className="pq-small">(con recargo)</span>
          </p>
        )}
        {needsAck && !accepted && (
          <p className="pq-banner warn">
            Para {issues.map((i) => i.title.toLowerCase()).join(' y ')} recomendamos vidrio de seguridad (templado o laminado, norma IRAM 12595). Este presupuesto lleva {issues[0].glass.toLowerCase()}. Si lo querés así, lo confirmás al aceptar.
          </p>
        )}
        <p className="pq-small">
          {p.pricesIncludeVat ? 'Precios con IVA incluido.' : `Incluye IVA (${money(view.vat)}).`} Válido hasta el {dateFmt(p.validUntil)}.
        </p>
        {p.notes && <p className="pq-notes">{p.notes}</p>}
        {p.footer && <p className="pq-small">{p.footer}</p>}

        {!!q.data.similar.length && (
          <section className="pq-renders no-print" aria-label="Trabajos parecidos">
            <h2>Trabajos parecidos que hicimos</h2>
            <div className="pq-render-grid">
              {q.data.similar.map((g) => (
                <figure key={g.image} className="pq-similar">
                  <img src={g.image} alt={g.caption || 'Trabajo terminado'} loading="lazy" />
                  {g.caption && <figcaption>{g.caption}</figcaption>}
                </figure>
              ))}
            </div>
          </section>
        )}

        {accepted && !preview && b.deposit && (
          <section className="pq-pay no-print">
            {p.depositPaidAt ? (
              <p className="pq-banner good">Recibimos tu seña. ¡Gracias!</p>
            ) : (
              <>
                <h2>Para confirmar, pagá la seña de {money(p.deposit)}</h2>
                {b.mp && !p.depositReportedAt && (
                  <button type="button" className="site-btn" disabled={mp.isPending} onClick={() => mp.mutate()}>
                    {mp.isPending ? 'Abriendo Mercado Pago…' : 'Pagar con Mercado Pago'}
                  </button>
                )}
                {mp.error && <p className="error">{errMsg(mp.error)}</p>}
                {b.mp && (pay.alias || pay.cbu) && <p className="pq-small">O por transferencia:</p>}
                {(pay.alias || pay.cbu) && (
                  <dl className="pq-paydata">
                    {pay.alias && (
                      <>
                        <dt>Alias</dt>
                        <dd>
                          <span className="mono">{pay.alias}</span>
                          <button type="button" className="site-btn ghost small" onClick={() => void copyText(pay.alias)}>
                            Copiar
                          </button>
                        </dd>
                      </>
                    )}
                    {pay.cbu && (
                      <>
                        <dt>CBU / CVU</dt>
                        <dd>
                          <span className="mono">{pay.cbu}</span>
                          <button type="button" className="site-btn ghost small" onClick={() => void copyText(pay.cbu)}>
                            Copiar
                          </button>
                        </dd>
                      </>
                    )}
                    {pay.holder && (
                      <>
                        <dt>Titular</dt>
                        <dd>{pay.holder}</dd>
                      </>
                    )}
                  </dl>
                )}
                {pay.note && <p className="pq-small">{pay.note}</p>}
                {p.depositReportedAt ? (
                  <p className="pq-banner good">Recibimos tu comprobante. Te confirmamos por WhatsApp cuando lo veamos.</p>
                ) : (
                  <label className={'site-btn upload' + (deposit.isPending ? ' busy' : '')}>
                    {deposit.isPending ? 'Subiendo…' : 'Subir comprobante'}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      disabled={deposit.isPending}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) deposit.mutate(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
                {deposit.error && <p className="error">{errMsg(deposit.error)}</p>}
              </>
            )}
          </section>
        )}

        <div className="pq-actions no-print">
          {!accepted && !closed && !preview && (
            <>
              {confirming ? (
                <div className="pq-confirm">
                  <p>
                    ¿Confirmás que aceptás {options ? <strong>{options[sel]?.label}</strong> : 'el presupuesto'} por {money(view.total)}?
                  </p>
                  {needsAck && (
                    <label className="check">
                      <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Entiendo que no es vidrio de seguridad y lo quiero así.
                    </label>
                  )}
                  <div className="row wrap">
                    <button className="site-btn" type="button" disabled={accept.isPending || (needsAck && !ack)} onClick={() => accept.mutate(options ? sel : null)}>
                      Sí, acepto
                    </button>
                    <button className="site-btn ghost" type="button" onClick={() => setConfirming(false)}>
                      Volver
                    </button>
                  </div>
                </div>
              ) : (
                <button className="site-btn" type="button" onClick={() => setConfirming(true)}>
                  {options ? `Acepto: ${options[sel]?.label}` : 'Acepto el presupuesto'}
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

/** Formato para la aseguradora: datos del siniestro y detalle con cantidades y precios unitarios. */
function InsuranceDoc({ data }: { data: PublicQuote }) {
  const { quote: p, business: b, insurance } = data;
  const ins = insurance!;
  const style = { '--brand': b.primaryColor, '--brand-accent': b.accentColor } as CSSProperties;
  const rows = [...ins.items.flatMap((i) => i.lines.map((l, k) => ({ ...l, group: k === 0 ? `${i.title} · ${qty(i.widthMm)} × ${qty(i.heightMm)} mm${i.quantity > 1 ? ` × ${i.quantity}` : ''}` : '' }))), ...ins.extras.map((l) => ({ ...l, group: '' }))];
  return (
    <div className="pq" style={style}>
      <article className="pq-doc insurance-doc">
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
        <h1>Presupuesto para la aseguradora</h1>
        <dl className="pq-claim">
          {ins.claim.company && (
            <>
              <dt>Aseguradora</dt>
              <dd>{ins.claim.company}</dd>
            </>
          )}
          {ins.claim.policy && (
            <>
              <dt>Póliza</dt>
              <dd>{ins.claim.policy}</dd>
            </>
          )}
          {ins.claim.claim && (
            <>
              <dt>Siniestro</dt>
              <dd>{ins.claim.claim}</dd>
            </>
          )}
          {ins.claim.incidentDate && (
            <>
              <dt>Fecha</dt>
              <dd>{dateFmt(`${ins.claim.incidentDate}T12:00:00`)}</dd>
            </>
          )}
          {p.customerName && (
            <>
              <dt>Asegurado</dt>
              <dd>{p.customerName}</dd>
            </>
          )}
        </dl>
        {ins.claim.description && <p className="pq-notes">{ins.claim.description}</p>}
        <div className="pq-table-wrap">
          <table className="pq-table">
            <thead>
              <tr>
                <th>Detalle</th>
                <th className="num">Cant.</th>
                <th className="num">Unitario</th>
                <th className="num">Importe</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    {r.group && <strong className="block">{r.group}</strong>}
                    {r.name}
                  </td>
                  <td className="num">
                    {qty(r.qty)} {r.unit}
                  </td>
                  <td className="num">{money(r.unitPrice)}</td>
                  <td className="num">{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="pq-totals">
          <dt className="grand">Total</dt>
          <dd className="grand">{money(p.total)}</dd>
        </dl>
        <p className="pq-small">
          {p.pricesIncludeVat ? 'Precios con IVA incluido.' : `Incluye IVA (${money(p.vat)}).`} Válido hasta el {dateFmt(p.validUntil)}.
        </p>
        <div className="pq-actions no-print">
          <button className="site-btn" type="button" onClick={() => window.print()}>
            Guardar PDF
          </button>
        </div>
        <footer className="pq-foot">
          {b.name}
          {b.address && ` · ${b.address}`}
          {b.whatsapp && ` · WhatsApp ${b.whatsapp}`}
          {b.email && ` · ${b.email}`}
        </footer>
      </article>
    </div>
  );
}

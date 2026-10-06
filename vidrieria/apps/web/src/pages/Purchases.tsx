import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errMsg } from '../api';
import { PieceSketch } from '../components/PieceSketch';
import { Empty, ErrorBox, Loading, copyText, toast } from '../components/ui';
import { dateFmt, money, qty } from '../lib/format';
import { useMe } from '../lib/me';
import { buildPurchase, purchaseMessage } from '../lib/purchase';
import type { Business, CatalogItem, PurchaseQuote } from '../lib/types';
import { waLink } from '../lib/whatsapp';

/** Lista de compras: junta el material de los trabajos aceptados y arma el pedido al proveedor. */
export default function Purchases() {
  const qc = useQueryClient();
  const me = useMe();
  const quotesQ = useQuery({ queryKey: ['purchases'], queryFn: () => api<PurchaseQuote[]>('/purchases') });
  const catalogQ = useQuery({ queryKey: ['catalog'], queryFn: () => api<CatalogItem[]>('/catalog') });
  const bizQ = useQuery({ queryKey: ['business'], queryFn: () => api<Business>('/business') });
  const [off, setOff] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  const chosen = useMemo(() => (quotesQ.data ?? []).filter((q) => !off.has(q.id)), [quotesQ.data, off]);
  const order = useMemo(() => buildPurchase(chosen, catalogQ.data ?? []), [chosen, catalogQ.data]);
  const auto = purchaseMessage(order, me.data?.business.name ?? '', bizQ.data?.supplierName ?? '');
  // El mensaje se puede retocar; si cambia la selección, se vuelve a armar.
  useEffect(() => setMsg(null), [chosen]);
  const text = msg ?? auto;

  const mark = useMutation({
    mutationFn: () => api('/purchases/mark', { body: { ids: chosen.map((q) => q.id) } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('Listo: quedaron como comprados');
    },
    onError: (e) => toast(errMsg(e)),
  });

  if (quotesQ.isLoading || catalogQ.isLoading) return <Loading />;
  const quotes = quotesQ.data ?? [];
  const empty = !order.glass.length && !order.others.length;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Compras</h1>
          <p className="muted small">El material de los trabajos aceptados que todavía no pediste.</p>
        </div>
      </div>
      <ErrorBox error={quotesQ.error ?? catalogQ.error} />
      {!quotes.length ? (
        <Empty>No hay trabajos aceptados con material por pedir. Cuando un cliente acepte, aparece acá.</Empty>
      ) : (
        <div className="purchase-grid">
          <section className="card">
            <h2>Trabajos</h2>
            <ul className="list">
              {quotes.map((q) => (
                <li key={q.id}>
                  <label className="list-row check-row">
                    <input
                      type="checkbox"
                      checked={!off.has(q.id)}
                      onChange={(e) => {
                        const s = new Set(off);
                        if (e.target.checked) s.delete(q.id);
                        else s.add(q.id);
                        setOff(s);
                      }}
                    />
                    <span className="mono muted">N° {q.number}</span>
                    <span className="grow">
                      <strong>{q.customer?.name ?? 'Sin cliente'}</strong>
                      <span className="muted"> · {q.title || 'Presupuesto'}</span>
                    </span>
                    <span className="muted small hide-sm">aceptado {dateFmt(q.acceptedAt)}</span>
                    <span className="num">{money(q.result.total)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Pedido</h2>
            {empty ? (
              <p className="muted">Elegí al menos un trabajo con material.</p>
            ) : (
              <>
                {!!order.glass.length && <h3>Vidrios cortados a medida</h3>}
                {order.glass.map((g) => (
                  <div key={g.name} className="buy-glass">
                    <p>
                      <strong>{g.name}</strong> <span className="muted">· {qty(g.m2)} m²</span>
                    </p>
                    <ul className="buy-pieces">
                      {g.pieces.map((p, i) => (
                        <li key={i}>
                          <PieceSketch widthMm={p.widthMm} heightMm={p.heightMm} quantity={p.quantity} size="sm" />
                          <span className="small muted">N° {p.quote}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {!!order.others.length && <h3>Herrajes y otros</h3>}
                <ul className="buy-others">
                  {order.others.map((o) => (
                    <li key={`${o.name}|${o.unit}`}>
                      <span>{o.name}</span>
                      <span className="mono">
                        {qty(o.qty)} {o.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {!empty && (
            <section className="card">
              <h2>Mensaje al proveedor</h2>
              {!bizQ.data?.supplierWhatsapp && (
                <p className="muted small">
                  Cargá el WhatsApp de tu proveedor en <Link to="/panel/ajustes">Ajustes</Link> y se lo mandás con un toque.
                </p>
              )}
              <textarea rows={12} value={text} onChange={(e) => setMsg(e.target.value)} aria-label="Mensaje al proveedor" className="mono small" />
              <div className="row wrap">
                <a className="btn wa" href={waLink(bizQ.data?.supplierWhatsapp, text)} target="_blank" rel="noreferrer">
                  Enviar por WhatsApp
                </a>
                <button type="button" className="btn" onClick={() => void copyText(text)}>
                  Copiar
                </button>
                <button type="button" className="btn" disabled={mark.isPending || !chosen.length} onClick={() => mark.mutate()}>
                  Marcar como comprados
                </button>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

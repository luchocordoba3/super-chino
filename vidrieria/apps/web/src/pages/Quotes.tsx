import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { QUOTE_STATUSES, QUOTE_STATUS_LABEL, type QuoteStatus } from '@vidrieria/shared';
import { api } from '../api';
import { Empty, ErrorBox, Loading, StatusChip } from '../components/ui';
import { ago, dateFmt, money } from '../lib/format';
import { useMe } from '../lib/me';
import type { QuoteListItem } from '../lib/types';
import { followUpMessage, waLink } from '../lib/whatsapp';

export function FollowUpList() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['quotes', 'follow-up'], queryFn: () => api<QuoteListItem[]>('/quotes/follow-up') });
  const done = useMutation({
    mutationFn: (id: string) => api(`/quotes/${id}/followed-up`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <Empty>Nada pendiente. Cuando un presupuesto enviado lleve 2 días sin respuesta, aparece acá.</Empty>;
  return (
    <ul className="list">
      {q.data.map((r) => (
        <li key={r.id} className="list-row">
          <span className="grow">
            <Link to={`/panel/presupuestos/${r.id}`}>
              <strong>{r.customer?.name ?? 'Sin cliente'}</strong>
            </Link>
            <span className="muted">
              {' '}
              · N° {r.number} {r.title} · {money(r.total)}
            </span>
            <span className="muted small block">
              Enviado {ago(r.sentAt!)}
              {r.viewedAt ? ' · lo vio' : ' · todavía no lo abrió'}
            </span>
          </span>
          <StatusChip status={r.status} />
          <a
            className="btn wa small"
            href={waLink(r.customer?.phone, followUpMessage(r))}
            target="_blank"
            rel="noreferrer"
            onClick={() => done.mutate(r.id)}
          >
            Escribirle
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function Quotes() {
  const [status, setStatus] = useState<QuoteStatus | ''>('');
  const [term, setTerm] = useState('');
  const me = useMe();
  const q = useQuery({
    queryKey: ['quotes', status, term],
    queryFn: () => api<QuoteListItem[]>(`/quotes?status=${status}&q=${encodeURIComponent(term)}`),
  });
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Presupuestos</h1>
        <Link className="btn primary" to="/panel/presupuestos/nuevo">
          + Nuevo presupuesto
        </Link>
      </div>
      <div className="filters">
        <input type="search" placeholder="Buscar por cliente, trabajo o número" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar" />
        <div className="seg" role="group" aria-label="Estado">
          <button type="button" className={status === '' ? 'on' : ''} onClick={() => setStatus('')}>
            Todos
          </button>
          {QUOTE_STATUSES.map((s) => (
            <button key={s} type="button" className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
              {QUOTE_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <Empty>
          No hay presupuestos {status ? `en estado "${QUOTE_STATUS_LABEL[status]}"` : 'todavía'}. <Link to="/panel/presupuestos/nuevo">Armá el primero</Link>.
        </Empty>
      ) : (
        <div className="table-wrap card flush">
          <table className="table">
            <thead>
              <tr>
                <th>N°</th>
                <th>Cliente y trabajo</th>
                <th>Estado</th>
                <th className="num">Total</th>
                <th className="hide-sm">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id}>
                  <td className="mono">
                    <Link to={`/panel/presupuestos/${r.id}`}>{r.number}</Link>
                  </td>
                  <td>
                    <Link to={`/panel/presupuestos/${r.id}`}>
                      <strong>{r.customer?.name ?? 'Sin cliente'}</strong>
                    </Link>
                    <span className="muted block small">
                      {r.title || '—'}
                      {r.optionCount > 1 && <span className="pill small-pill">{r.optionCount} opciones</span>}
                    </span>
                  </td>
                  <td>
                    <StatusChip status={r.status} />
                    {r.status === 'ACCEPTED' && r.depositPaidAt && <span className="pill small-pill good">seña ✓</span>}
                    {r.status === 'ACCEPTED' && !r.depositPaidAt && r.depositReportedAt && <span className="pill small-pill warn">seña a confirmar</span>}
                    {r.viewCount > 1 && r.status !== 'ACCEPTED' && <span className="muted small block">lo abrió {r.viewCount} veces</span>}
                  </td>
                  <td className="num">{money(r.total)}</td>
                  <td className="hide-sm muted">{dateFmt(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {me.data && <p className="muted small">Los presupuestos enviados vencen a los días que configuraste en Ajustes.</p>}
    </div>
  );
}

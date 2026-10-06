import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errMsg } from '../api';
import { ErrorBox, Loading, StatusChip, toast } from '../components/ui';
import { ago, money, money2, qty } from '../lib/format';
import { QUEUE_EVENT, pendingMeasures, syncPending } from '../lib/measure';
import { type PushState, disablePush, enablePush, pushState } from '../lib/push';
import type { Dashboard as D, Quote } from '../lib/types';
import { dollarUpdateMessage, waLink } from '../lib/whatsapp';
import { FollowUpList } from './Quotes';

export default function Dashboard() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<D>('/dashboard') });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const d = q.data;
  const m = d.month;
  const coverage = m.totalLines ? m.costedLines / m.totalLines : 0;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Inicio</h1>
        <div className="row wrap">
          <Link className="btn hide-sm" to="/panel/medir">
            Medir en obra
          </Link>
          <Link className="btn primary" to="/panel/presupuestos/nuevo">
            + Nuevo presupuesto
          </Link>
        </div>
      </div>

      <PushCard />
      <PendingMeasures />

      <section className="tiles">
        <Link to="/panel/consultas" className={'tile' + (d.newLeads ? ' attention' : '')}>
          <span className="tile-label">Consultas nuevas</span>
          <strong className="tile-num">{d.newLeads}</strong>
          <span className="tile-sub">desde tu web</span>
        </Link>
        <a href="#seguimiento" className={'tile' + (d.followUps ? ' attention' : '')}>
          <span className="tile-label">Para seguir hoy</span>
          <strong className="tile-num">{d.followUps}</strong>
          <span className="tile-sub">enviados sin respuesta</span>
        </a>
        <div className="tile">
          <span className="tile-label">Aceptados del mes</span>
          <strong className="tile-num">{m.count}</strong>
          <span className="tile-sub">
            {money(m.total)} · señas cobradas {money(m.depositsPaid)}
          </span>
        </div>
        <div className="tile profit">
          <span className="tile-label">Ganancia del mes</span>
          <strong className="tile-num money">{m.costedLines ? money(m.profit) : '—'}</strong>
          <span className="tile-sub">
            {!m.count ? (
              'cuando acepten trabajos'
            ) : coverage < 0.5 ? (
              <Link to="/panel/precios">Cargá los costos en Precios para verla</Link>
            ) : (
              `estimada, con costo en ${qty(Math.round(coverage * 100))} % de los ítems`
            )}
          </span>
        </div>
      </section>

      {!!d.depositsToConfirm.length && (
        <section className="card attention-card">
          <h2>Señas para confirmar</h2>
          <p className="muted small">El cliente subió el comprobante. Fijate que haya llegado y confirmá el cobro.</p>
          <ul className="list">
            {d.depositsToConfirm.map((r) => (
              <li key={r.id}>
                <Link to={`/panel/presupuestos/${r.id}`} className="list-row">
                  <span className="mono muted">N° {r.number}</span>
                  <span className="grow">
                    <strong>{r.customer?.name ?? 'Sin cliente'}</strong>
                    <span className="muted"> · {r.title || 'Presupuesto'}</span>
                  </span>
                  <span className="num">seña {money(r.deposit)}</span>
                  <span className="muted small hide-sm">{r.depositReportedAt && ago(r.depositReportedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!d.dollarStale.length && <DollarAlert d={d} />}

      {!!d.toBuy && (
        <Link to="/panel/compras" className="card banner-link">
          <span>
            <strong>{d.toBuy === 1 ? '1 trabajo aceptado' : `${d.toBuy} trabajos aceptados`} sin pedir material.</strong>
            <span className="muted block small">Armá el pedido al proveedor con las medidas de cada pieza.</span>
          </span>
          <span className="btn small">Armar pedido</span>
        </Link>
      )}

      <section className="card" id="seguimiento">
        <h2>Para seguir hoy</h2>
        <p className="muted small">Enviados hace 2 días o más que todavía no respondieron. Un mensaje a tiempo cierra trabajos.</p>
        <FollowUpList />
      </section>

      <section className="card">
        <div className="row between">
          <h2>Últimos movimientos</h2>
          <Link to="/panel/presupuestos">Ver todos</Link>
        </div>
        <ul className="list">
          {d.recent.map((r) => (
            <li key={r.id}>
              <Link to={`/panel/presupuestos/${r.id}`} className="list-row">
                <span className="mono muted">N° {r.number}</span>
                <span className="grow">
                  <strong>{r.customer?.name ?? 'Sin cliente'}</strong>
                  <span className="muted"> · {r.title || 'Presupuesto'}</span>
                  {r.optionCount > 1 && <span className="pill small-pill">{r.optionCount} opciones</span>}
                </span>
                <StatusChip status={r.status} />
                <span className="num">{money(r.total)}</span>
                <span className="muted small hide-sm">{ago(r.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Presupuestos abiertos que con el dólar de hoy saldrían más caros. */
function DollarAlert({ d }: { d: D }) {
  const qc = useQueryClient();
  type Row = D['dollarStale'][number];
  const [updated, setUpdated] = useState<Record<string, { row: Row; quote: Quote }>>({});
  const up = useMutation({
    mutationFn: async (row: Row) => ({ row, quote: await api<Quote>(`/quotes/${row.id}/redollar`, { method: 'POST' }) }),
    onSuccess: ({ row, quote }) => {
      setUpdated((u) => ({ ...u, [row.id]: { row, quote } }));
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['quote', row.id] });
      toast(`N° ${quote.number} actualizado a ${money(quote.total)}`);
    },
    onError: (e) => toast(errMsg(e)),
  });
  // Los ya actualizados se siguen mostrando (para reenviarlos) aunque el servidor ya no los liste.
  const rows = [...d.dollarStale.filter((s) => !updated[s.id]), ...Object.values(updated).map((u) => u.row)].map((r) => ({ ...r, done: updated[r.id]?.quote }));
  return (
    <section className="card attention-card">
      <h2>Subió el dólar</h2>
      <p className="muted small">
        Hoy está a {money2(d.dollar.rate)}. Estos presupuestos mandados con un dólar más bajo hoy te dejan menos plata (más de {qty(d.dollar.alertPct)} %).
      </p>
      <ul className="list">
        {rows.map((r) => (
          <li key={r.id} className="list-row stale-row">
            <span className="mono muted">N° {r.number}</span>
            <span className="grow">
              <strong>{r.customer?.name ?? 'Sin cliente'}</strong>
              <span className="muted"> · {r.title || 'Presupuesto'}</span>
              <span className="block small">
                {r.done ? (
                  <>Actualizado: {money(Number(r.done.total))}</>
                ) : (
                  <>
                    {money(r.total)} → <strong>{money(r.newTotal)}</strong> <span className="muted">(+{qty(Math.round(((r.newTotal - r.total) / r.total) * 100))} %)</span>
                  </>
                )}
              </span>
            </span>
            {r.done ? (
              <a
                className="btn wa small"
                href={waLink(r.customer?.phone, dollarUpdateMessage({ ...r.done, total: Number(r.done.total), customer: r.customer }))}
                target="_blank"
                rel="noreferrer"
              >
                Reenviar
              </a>
            ) : (
              <button type="button" className="btn small" disabled={up.isPending} onClick={() => up.mutate(r)}>
                Actualizar
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Invita a activar los avisos en este celular (se oculta si ya están). */
export function PushCard({ always = false }: { always?: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void pushState().then(setState);
  }, []);
  if (!state) return null;
  if (state === 'unsupported') return always ? <p className="note">Este navegador no permite avisos. En el celular, usá Chrome.</p> : null;
  if (!always && (state === 'on' || state === 'denied')) return null;
  if (state === 'on')
    return (
      <p className="note good">
        Los avisos están activados en este dispositivo.{' '}
        <button type="button" className="link-btn small" onClick={() => void disablePush().then(() => setState('off'))}>
          Desactivar
        </button>
      </p>
    );
  if (state === 'denied') return <p className="note">Bloqueaste los avisos. Activalos desde los ajustes del navegador para este sitio.</p>;
  if (state === 'ios-install')
    return (
      <section className="card push-card">
        <strong>Recibí avisos en el iPhone</strong>
        <p className="small muted">Tocá Compartir → «Agregar a inicio», abrí el panel desde ese ícono y activá los avisos.</p>
      </section>
    );
  return (
    <section className="card push-card">
      <div>
        <strong>Enterate al instante</strong>
        <p className="small muted">Te avisamos en este celular cuando entra una consulta, cuando un cliente abre o acepta un presupuesto y cuando manda la seña.</p>
      </div>
      <button
        type="button"
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await enablePush();
            setState('on');
            toast('Listo: te vamos a avisar acá');
          } catch (e) {
            toast(errMsg(e));
            setState(await pushState());
          } finally {
            setBusy(false);
          }
        }}
      >
        Activar avisos
      </button>
    </section>
  );
}

/** Mediciones hechas sin señal que todavía no se subieron. */
function PendingMeasures() {
  const [n, setN] = useState(pendingMeasures().length);
  useEffect(() => {
    const upd = () => setN(pendingMeasures().length);
    window.addEventListener(QUEUE_EVENT, upd);
    return () => window.removeEventListener(QUEUE_EVENT, upd);
  }, []);
  if (!n) return null;
  return (
    <p className="note">
      {n === 1 ? 'Hay 1 medición' : `Hay ${n} mediciones`} guardadas en este celular sin subir.{' '}
      <button type="button" className="link-btn" onClick={() => void syncPending()}>
        Subir ahora
      </button>
    </p>
  );
}

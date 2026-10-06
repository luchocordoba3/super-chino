import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ErrorBox, Loading, StatusChip } from '../components/ui';
import { ago, money } from '../lib/format';
import type { Dashboard as D } from '../lib/types';
import { FollowUpList } from './Quotes';

export default function Dashboard() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<D>('/dashboard') });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const d = q.data;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Inicio</h1>
        <Link className="btn primary" to="/panel/presupuestos/nuevo">
          + Nuevo presupuesto
        </Link>
      </div>

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
          <span className="tile-label">Presupuestos (7 días)</span>
          <strong className="tile-num">{d.week.count}</strong>
          <span className="tile-sub">{money(d.week.total)}</span>
        </div>
        <div className="tile">
          <span className="tile-label">Aceptados (7 días)</span>
          <strong className="tile-num">{d.accepted.count}</strong>
          <span className="tile-sub">
            {money(d.accepted.total)} · señas {money(d.accepted.deposit)}
          </span>
        </div>
      </section>

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

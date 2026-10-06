import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api';
import { useMe } from '../lib/me';
import type { Dashboard } from '../lib/types';
import { Loading } from './ui';

const NAV = [
  { to: '/panel', label: 'Inicio', end: true },
  { to: '/panel/consultas', label: 'Consultas' },
  { to: '/panel/presupuestos', label: 'Presupuestos' },
  { to: '/panel/clientes', label: 'Clientes' },
  { to: '/panel/precios', label: 'Precios' },
  { to: '/panel/mi-web', label: 'Mi web', owner: true },
  { to: '/panel/ajustes', label: 'Ajustes', owner: true },
];

export function PanelLayout() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard'), enabled: !!me.data, refetchInterval: 60_000 });

  if (me.isLoading) return <Loading />;
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/login" replace />;
  if (!me.data) return <Loading />;
  const isOwner = me.data.user.role === 'OWNER';

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    qc.clear();
    nav('/login');
  };

  return (
    <div className="panel">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <strong>{me.data.business.name}</strong>
            <a className="brand-link" href={`/${me.data.business.slug}`} target="_blank" rel="noreferrer">
              Ver mi web ↗
            </a>
          </div>
        </div>
        <nav className="mainnav" aria-label="Secciones">
          {NAV.filter((n) => !n.owner || isOwner).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
              {n.to === '/panel/consultas' && !!dash.data?.newLeads && <span className="badge">{dash.data.newLeads}</span>}
            </NavLink>
          ))}
        </nav>
        <button className="link-btn" onClick={logout} type="button">
          Salir
        </button>
      </header>
      <main className="panel-main">
        <Outlet />
      </main>
      <footer className="panel-foot">Hecho por Lumina</footer>
    </div>
  );
}

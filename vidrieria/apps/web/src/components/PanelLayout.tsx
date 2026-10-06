import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api';
import { QUEUE_EVENT, syncPending } from '../lib/measure';
import { forgetMe, useMe } from '../lib/me';
import { registerSw } from '../lib/push';
import type { Dashboard } from '../lib/types';
import { Loading, toast } from './ui';

const NAV = [
  { to: '/panel', label: 'Inicio', end: true },
  { to: '/panel/consultas', label: 'Consultas' },
  { to: '/panel/presupuestos', label: 'Presupuestos' },
  { to: '/panel/clientes', label: 'Clientes' },
  { to: '/panel/precios', label: 'Precios' },
  { to: '/panel/compras', label: 'Compras' },
  { to: '/panel/mi-web', label: 'Mi web', owner: true },
  { to: '/panel/ajustes', label: 'Ajustes', owner: true },
];

/** Íconos de la barra de abajo (celular). */
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ICONS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  inbox: 'M4 13l2.5-7h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 13h4.5l1.5 2.5h4L15.5 13H20',
  ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  doc: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};

export function PanelLayout() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const [more, setMore] = useState(false);
  const inEditor = useMatch('/panel/presupuestos/:id');
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard'), enabled: !!me.data, refetchInterval: 60_000 });

  // Avisos y modo sin señal; al volver la señal, sube las mediciones guardadas.
  useEffect(() => {
    registerSw();
    const sync = () =>
      void syncPending().then((n) => {
        if (n) {
          toast(n === 1 ? 'Se subió la medición que estaba guardada' : `Se subieron ${n} mediciones guardadas`);
          qc.invalidateQueries({ queryKey: ['quotes'] });
          qc.invalidateQueries({ queryKey: ['dashboard'] });
        }
      });
    sync();
    window.addEventListener('online', sync);
    window.addEventListener(QUEUE_EVENT, sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener(QUEUE_EVENT, sync);
    };
  }, [qc]);

  useEffect(() => setMore(false), [loc.pathname]);

  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/login" replace />;
  if (!me.data) return <Loading />;
  const isOwner = me.data.user.role === 'OWNER';
  const links = NAV.filter((n) => !n.owner || isOwner);
  const newLeads = dash.data?.newLeads ?? 0;

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    qc.clear();
    forgetMe();
    nav('/login');
  };

  const tab = (to: string, label: string, icon: string, end = false, badge?: ReactNode) => (
    <NavLink to={to} end={end} className="tab">
      <Icon d={icon} />
      <span>{label}</span>
      {badge}
    </NavLink>
  );

  return (
    <div className={'panel' + (inEditor ? ' in-editor' : '')}>
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
          {links.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
              {n.to === '/panel/consultas' && !!newLeads && <span className="badge">{newLeads}</span>}
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

      {!inEditor && (
        <nav className="tabbar" aria-label="Accesos rápidos">
          {tab('/panel', 'Inicio', ICONS.home, true)}
          {tab('/panel/consultas', 'Consultas', ICONS.inbox, false, !!newLeads && <span className="badge">{newLeads}</span>)}
          <NavLink to="/panel/medir" className="tab tab-main">
            <Icon d={ICONS.ruler} />
            <span>Medir</span>
          </NavLink>
          {tab('/panel/presupuestos', 'Presupuestos', ICONS.doc)}
          <button type="button" className={'tab' + (more ? ' active' : '')} onClick={() => setMore(!more)} aria-expanded={more}>
            <Icon d={ICONS.more} />
            <span>Más</span>
          </button>
        </nav>
      )}
      {more && (
        <div className="sheet-bg" onClick={() => setMore(false)}>
          <div className="sheet" role="menu" onClick={(e) => e.stopPropagation()}>
            {links
              .filter((n) => !['/panel', '/panel/consultas', '/panel/presupuestos'].includes(n.to))
              .map((n) => (
                <NavLink key={n.to} to={n.to} role="menuitem">
                  {n.label}
                  {n.to === '/panel/compras' && !!dash.data?.toBuy && <span className="badge">{dash.data.toBuy}</span>}
                </NavLink>
              ))}
            <button type="button" className="link-btn" onClick={logout}>
              Salir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

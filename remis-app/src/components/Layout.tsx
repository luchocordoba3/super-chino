import { NavLink, Outlet } from 'react-router-dom';
import { useData } from '../lib/data';
import { kmFmt } from '../lib/format';
import { Icon, type IconName } from './icons';

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Hoy', icon: 'home' },
  { to: '/movimientos', label: 'Movimientos', icon: 'list' },
  { to: '/auto', label: 'Auto', icon: 'car' },
  { to: '/resumen', label: 'Resumen', icon: 'chart' },
  { to: '/ajustes', label: 'Ajustes', icon: 'sliders' },
];

export function Layout() {
  const d = useData();
  const urgent = d.alerts.filter((a) => a.level !== 'info').length;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" />
          Mi Remis
        </div>
        <div className="topkm">
          <span className="muted">{d.vehicle.plate || d.vehicle.name}</span>
          <strong>{kmFmt(d.km)}</strong>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <nav className="bottomnav" aria-label="Secciones">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
            {n.to === '/' && urgent > 0 && (
              <span className="count" aria-label={`${urgent} avisos`}>
                {urgent}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

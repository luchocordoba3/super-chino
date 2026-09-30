import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { saveSettings } from '../db/repo';
import { isChofer } from '../domain/settlement';
import { useData } from '../lib/data';
import { kmFmt } from '../lib/format';
import { Icon, type IconName } from './icons';
import { Sheet } from './ui';

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Hoy', icon: 'home' },
  { to: '/movimientos', label: 'Movimientos', icon: 'list' },
  { to: '/auto', label: 'Auto', icon: 'car' },
  { to: '/resumen', label: 'Resumen', icon: 'chart' },
  { to: '/ajustes', label: 'Ajustes', icon: 'sliders' },
];

export function Layout() {
  const d = useData();
  const nav = useNavigate();
  const [cars, setCars] = useState(false);
  const urgent = d.alerts.filter((a) => a.level !== 'info').length;
  const pick = (id: string) => {
    void saveSettings({ vehicleId: id });
    setCars(false);
  };
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" />
          Mi Remis
        </div>
        <button type="button" className="topkm" onClick={() => setCars(true)} aria-label={`${d.vehicle.plate || d.vehicle.name}, ${kmFmt(d.km)}. Cambiar de auto`}>
          <span>
            <span className="muted">{d.vehicle.plate || d.vehicle.name}</span>
            <strong>{kmFmt(d.km)}</strong>
          </span>
          <Icon name="down" />
        </button>
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
      {cars && (
        <Sheet title="Tus autos" onClose={() => setCars(false)}>
          <div className="list">
            {d.fleet.map(({ vehicle: v, km }) => (
              <button key={v.id} type="button" className="item car-row" aria-current={v.id === d.vehicle.id} onClick={() => pick(v.id)}>
                <span className="ic">
                  <Icon name={isChofer(v) ? 'user' : 'car'} />
                </span>
                <span className="grow">
                  <div className="t">{[v.plate, v.name].filter(Boolean).join(' · ')}</div>
                  <div className="d">
                    {kmFmt(km)} · {isChofer(v) ? (v.chofer?.name.trim() ? `Lo maneja ${v.chofer.name.trim()}` : 'Lo maneja un chofer') : 'Lo manejás vos'}
                  </div>
                </span>
                {v.id === d.vehicle.id && <span className="badge">Viendo</span>}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setCars(false);
              nav('/autos/nuevo');
            }}
          >
            <Icon name="plus" /> Agregar otro auto
          </button>
        </Sheet>
      )}
    </div>
  );
}

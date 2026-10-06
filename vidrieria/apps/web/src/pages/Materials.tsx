import { lazy, Suspense } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import type { Feature } from '@vidrieria/shared';
import { Gate, LockIcon } from '../components/Locked';
import { Loading } from '../components/ui';
import { useFeature } from '../lib/plan';

const Prices = lazy(() => import('./Prices'));
const Purchases = lazy(() => import('./Purchases'));
const Remnants = lazy(() => import('./Remnants'));
const Stock = lazy(() => import('./Stock'));

const TABS: { key: string; label: string; feature?: Feature }[] = [
  { key: '', label: 'Precios' },
  { key: 'compras', label: 'Compras', feature: 'materials' },
  { key: 'retazos', label: 'Retazos', feature: 'materials' },
  { key: 'stock', label: 'Stock', feature: 'materials' },
];

function Tab({ t }: { t: (typeof TABS)[number] }) {
  const ok = useFeature(t.feature ?? 'quotes');
  return (
    <NavLink to={`/panel/materiales${t.key ? `/${t.key}` : ''}`} end className={({ isActive }) => (isActive ? 'on' : '')}>
      {t.label} {!ok && <LockIcon />}
    </NavLink>
  );
}

/** Materiales: precios, compras al proveedor, retazos y stock, en pestañas. */
export default function Materials() {
  const { tab = '' } = useParams();
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];
  const page = { '': <Prices />, compras: <Purchases />, retazos: <Remnants />, stock: <Stock /> }[current.key];
  return (
    <div className="stack">
      <nav className="seg tabs-nav" aria-label="Materiales">
        {TABS.map((t) => (
          <Tab key={t.key} t={t} />
        ))}
      </nav>
      <Suspense fallback={<Loading />}>{current.feature ? <Gate feature={current.feature}>{page}</Gate> : page}</Suspense>
    </div>
  );
}

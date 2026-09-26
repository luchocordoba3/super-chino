import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { loadAll } from '../db/repo';
import { Onboarding } from '../pages/Onboarding';
import { type AppData, derive } from './derive';

const Ctx = createContext<AppData | null>(null);

/** Lee todo del celular (se actualiza solo cuando algo cambia). Si no hay auto cargado, muestra la bienvenida. */
export function DataGate({ children }: { children: ReactNode }) {
  const raw = useLiveQuery(loadAll, [], 'loading' as const);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const data = useMemo(() => (raw && raw !== 'loading' ? derive(raw, now) : null), [raw, now]);

  const theme = data?.settings.theme ?? 'auto';
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  if (raw === 'loading') return <div className="splash">Mi Remis</div>;
  if (!data) return <Onboarding />;
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

export function useData(): AppData {
  const d = useContext(Ctx);
  if (!d) throw new Error('useData fuera de DataGate');
  return d;
}

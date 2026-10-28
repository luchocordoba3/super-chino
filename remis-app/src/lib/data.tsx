import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { BRAND } from '../brand';
import { CONFIG } from '../config';
import { loadAll, saveSettings } from '../db/repo';
import { type LicensePayload, newInstallId, verifyCode } from '../domain/license';
import { Onboarding } from '../pages/Onboarding';
import { type AppData, derive } from './derive';
import { localTrial } from './install';

const Ctx = createContext<AppData | null>(null);

/** Lee todo del celular (se actualiza solo cuando algo cambia). Si no hay auto cargado, muestra la bienvenida. */
export function DataGate({ children }: { children: ReactNode }) {
  const raw = useLiveQuery(loadAll, [], 'loading' as const);
  const [now, setNow] = useState(() => new Date());
  const [lic, setLic] = useState<{ code?: string; payload?: LicensePayload | null }>({});
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const settings = raw && raw !== 'loading' ? raw.settings : null;
  const code = settings?.license;
  const ready = !!settings;
  // El código guardado se verifica con la clave pública (sin internet), una vez por código.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    if (!code) setLic({ code, payload: null });
    else void verifyCode(code, CONFIG.licenseKeys).then((payload) => alive && setLic({ code, payload }));
    return () => {
      alive = false;
    };
  }, [ready, code]);
  // Datos de antes de esta versión: les falta el código del celular y el comienzo de la prueba.
  useEffect(() => {
    if (settings && (!settings.installId || !settings.trialStart)) {
      const local = localTrial();
      void saveSettings({ installId: settings.installId ?? local.installId ?? newInstallId(), trialStart: settings.trialStart ?? local.trialStart ?? new Date().toISOString() });
    } else if (settings) {
      // La prueba más vieja manda: cargar el ejemplo o restaurar una copia no la reinicia.
      const local = localTrial(settings);
      if (local.trialStart && settings.trialStart && local.trialStart < settings.trialStart) void saveSettings({ trialStart: local.trialStart });
    }
  }, [settings]);

  const verified = ready && lic.code === code ? lic.payload : undefined;
  const data = useMemo(() => (raw && raw !== 'loading' ? derive(raw, now, verified) : null), [raw, now, verified]);

  const theme = data?.settings.theme ?? 'auto';
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  if (raw === 'loading') return <div className="splash">{BRAND.name}</div>;
  if (!data) return <Onboarding />;
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

export function useData(): AppData {
  const d = useContext(Ctx);
  if (!d) throw new Error('useData fuera de DataGate');
  return d;
}

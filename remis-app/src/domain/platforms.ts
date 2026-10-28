import type { AgencyConfig, Income, PlatformCfg, PlatformId, Settings } from '../db/types';

// Con qué trabaja el chofer: apps, viajes propios o la agencia de remis.

export const PLATFORM_LABEL: Record<PlatformId, string> = {
  uber: 'Uber',
  didi: 'DiDi',
  cabify: 'Cabify',
  indrive: 'inDrive',
  particular: 'Particular',
  agencia: 'Agencia',
};

export const PLATFORM_IDS = Object.keys(PLATFORM_LABEL) as PlatformId[];

/** Comisión de referencia (2026) para cuando anotás lo bruto. Cada uno la cambia en Ajustes. */
export const DEFAULT_PERCENT: Partial<Record<PlatformId, number>> = { uber: 30, didi: 25, cabify: 25, indrive: 10 };

/** Las plataformas configuradas (en el orden de siempre). Sin datos: solo la agencia, como antes. */
export function platformList(s: Pick<Settings, 'platforms'>): PlatformCfg[] {
  return PLATFORM_IDS.map(
    (id) => s.platforms?.find((p) => p.id === id) ?? { id, on: !s.platforms && id === 'agencia', mode: 'neto', percent: DEFAULT_PERCENT[id] },
  );
}

export const activePlatforms = (s: Pick<Settings, 'platforms'>) => platformList(s).filter((p) => p.on);

/** Arma la configuración a partir de las que elegiste en la bienvenida. */
export const platformsFrom = (ids: PlatformId[]): PlatformCfg[] =>
  PLATFORM_IDS.map((id) => ({ id, on: ids.includes(id), mode: 'neto', percent: DEFAULT_PERCENT[id] }));

export const incomePlatform = (i: Pick<Income, 'platform'>): PlatformId => i.platform ?? 'agencia';

/** Lo que se lleva la agencia o la app de lo que anotaste. */
export function feeFor(id: PlatformId, gross: number, s: Pick<Settings, 'platforms'> & { agency: AgencyConfig }): number {
  if (id === 'agencia') return s.agency.mode === 'percent' && s.agency.percent ? Math.round(gross * s.agency.percent) / 100 : 0;
  const p = platformList(s).find((x) => x.id === id);
  return p?.mode === 'bruto' && p.percent ? Math.round(gross * p.percent) / 100 : 0;
}

export const feePercent = (id: PlatformId, s: Pick<Settings, 'platforms'> & { agency: AgencyConfig }) =>
  id === 'agencia' ? (s.agency.mode === 'percent' ? s.agency.percent : undefined) : platformList(s).find((x) => x.id === id && x.mode === 'bruto')?.percent;

import type { FuelLoad, FuelType } from '../db/types';

export const FUEL_LABEL: Record<FuelType, string> = { nafta: 'Nafta', gasoil: 'Gasoil', gnc: 'GNC' };
export const FUEL_UNIT: Record<FuelType, string> = { nafta: 'L', gasoil: 'L', gnc: 'm³' };

/** Tramo entre dos cargas con tanque lleno. */
export interface Segment {
  fromKm: number;
  toKm: number;
  km: number;
  qty: number;
  kmPerUnit: number;
  at: string;
  /** No es exacto: en el medio hubo cargas de otro combustible o km que hizo otro chofer. */
  mixed: boolean;
}

/**
 * Rendimiento por el método de tanque lleno: todo lo cargado después de un lleno
 * y hasta el siguiente lleno es lo que se gastó en esos km.
 * `breaks`: momentos en que el auto lo tuvo otro chofer (sus cargas no están anotadas).
 */
export function segments(loads: FuelLoad[], fuel: FuelType, breaks: string[] = []): Segment[] {
  const sorted = [...loads].sort((a, b) => a.at.localeCompare(b.at));
  const out: Segment[] = [];
  let start: FuelLoad | null = null;
  let qty = 0;
  let mixed = false;
  for (const l of sorted) {
    if (!start) {
      if (l.fuel === fuel && l.full && l.km != null) start = l;
      continue;
    }
    if (l.fuel !== fuel) {
      mixed = true;
      continue;
    }
    qty += l.qty;
    if (!l.full || l.km == null) continue;
    const km = l.km - start.km!;
    const from = start.at;
    const broken = mixed || breaks.some((b) => b > from && b <= l.at);
    if (km > 0 && qty > 0) out.push({ fromKm: start.km!, toKm: l.km, km, qty, kmPerUnit: km / qty, at: l.at, mixed: broken });
    start = l;
    qty = 0;
    mixed = false;
  }
  return out;
}

/** Promedio ponderado (km totales / cantidad total) de los tramos sin mezcla. */
export function avgKmPerUnit(segs: Segment[]): number | null {
  const clean = segs.filter((s) => !s.mixed);
  const qty = clean.reduce((a, s) => a + s.qty, 0);
  return qty > 0 ? clean.reduce((a, s) => a + s.km, 0) / qty : null;
}

/** Aviso si el último tramo rindió más de un 20% peor que el promedio de los anteriores. */
export function consumptionDrop(segs: Segment[]): { last: number; avg: number; dropPct: number } | null {
  const clean = segs.filter((s) => !s.mixed);
  if (clean.length < 3) return null;
  const last = clean[clean.length - 1];
  const avg = avgKmPerUnit(clean.slice(Math.max(0, clean.length - 6), -1));
  if (!avg || last.kmPerUnit >= avg * 0.8) return null;
  return { last: last.kmPerUnit, avg, dropPct: Math.round((1 - last.kmPerUnit / avg) * 100) };
}

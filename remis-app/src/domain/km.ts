import type { FuelLoad, Incident, ServiceLog, Shift, Vehicle } from '../db/types';
import { dayKey, fromDayKey, hoursBetween, inRange } from './dates';

export interface Reading {
  at: string;
  km: number;
}

/** Todas las lecturas del odómetro, de la más vieja a la más nueva. */
export function readings(d: { shifts: Shift[]; fuel: FuelLoad[]; services?: ServiceLog[]; incidents?: Incident[] }): Reading[] {
  const r: Reading[] = [];
  for (const s of d.shifts) {
    r.push({ at: s.startAt, km: s.startKm });
    if (s.endAt && s.endKm != null) r.push({ at: s.endAt, km: s.endKm });
  }
  for (const f of d.fuel) if (f.km != null) r.push({ at: f.at, km: f.km });
  for (const s of d.services ?? []) {
    const noon = fromDayKey(s.date);
    noon.setHours(12);
    r.push({ at: noon.toISOString(), km: s.km });
  }
  for (const i of d.incidents ?? []) if (i.km != null) r.push({ at: i.at, km: i.km });
  return r.sort((a, b) => a.at.localeCompare(b.at));
}

/** Km actual del auto: el mayor que se anotó en cualquier lado. */
export function currentKm(vehicle: Pick<Vehicle, 'initialKm'>, rs: Reading[]): number {
  return rs.reduce((max, r) => Math.max(max, r.km), vehicle.initialKm);
}

/** Km por día (calendario) que hace el auto, mirando el último mes. Null si no hay datos suficientes. */
export function kmPerDay(rs: Reading[], now = new Date(), windowDays = 30): number | null {
  const since = now.getTime() - windowDays * 86_400_000;
  const inWin = rs.filter((r) => new Date(r.at).getTime() >= since);
  const before = rs.filter((r) => {
    const t = new Date(r.at).getTime();
    return t < since && t >= since - windowDays * 86_400_000;
  });
  const pts = before.length ? [before[before.length - 1], ...inWin] : inWin;
  if (pts.length < 2) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const days = (new Date(last.at).getTime() - new Date(first.at).getTime()) / 86_400_000;
  if (days < 2) return null;
  const rate = (last.km - first.km) / days;
  return rate > 0 ? rate : null;
}

export const shiftKm = (s: Shift) => (s.endKm != null ? Math.max(0, s.endKm - s.startKm) : 0);
export const shiftHours = (s: Shift, now = new Date()) => hoursBetween(s.startAt, s.endAt ?? now.toISOString());
export const openShift = (shifts: Shift[]) => shifts.find((s) => !s.endAt);

const byStart = (a: Shift, b: Shift) => a.startAt.localeCompare(b.startAt);

/** Km que hizo el auto entre un turno tuyo y el siguiente: los del otro chofer, o fuera de turno. */
export function gapsBetweenShifts(shifts: Shift[]): Reading[] {
  const sorted = [...shifts].sort(byStart);
  const out: Reading[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (prev.endKm == null) continue;
    const km = sorted[i].startKm - prev.endKm;
    if (km > 0) out.push({ at: sorted[i].startAt, km });
  }
  return out;
}

/** Km por día: tuyos (turnos cerrados, por el día en que empezaron) y del otro chofer. */
export function kmByDay(shifts: Shift[], from: string, to: string) {
  const mine = new Map<string, number>();
  const other = new Map<string, number>();
  for (const s of shifts) {
    const k = dayKey(s.startAt);
    if (inRange(k, from, to)) mine.set(k, (mine.get(k) ?? 0) + shiftKm(s));
  }
  for (const g of gapsBetweenShifts(shifts)) {
    const k = dayKey(g.at);
    if (inRange(k, from, to)) other.set(k, (other.get(k) ?? 0) + g.km);
  }
  return { mine, other };
}

const kmFmt = (n: number) => new Intl.NumberFormat('es-AR').format(n);

/** Aviso si el km cargado no cierra con lo anterior. */
export function kmWarning(km: number, current: number): string | null {
  if (km < current) return `Es menor que el último km anotado (${kmFmt(current)} km). Revisá el odómetro.`;
  if (km - current > 3000) return `Son ${kmFmt(km - current)} km más que el último anotado. ¿Está bien?`;
  return null;
}

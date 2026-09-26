import type { FuelType, MaintItem, ServiceLog } from '../db/types';
import { addMonths, diffDays, todayKey } from './dates';

interface PlanDefault {
  name: string;
  everyKm?: number;
  everyMonths?: number;
  /** Solo si el auto tiene GNC. */
  gnc?: boolean;
  /** Solo motores naftero/GNC (no gasoil). */
  spark?: boolean;
}

/** Plan típico para un auto de uso intensivo. Son valores de referencia: cada uno los ajusta según el manual. */
export const DEFAULT_PLAN: PlanDefault[] = [
  { name: 'Aceite y filtro de aceite', everyKm: 10_000, everyMonths: 12 },
  { name: 'Filtro de aire', everyKm: 20_000 },
  { name: 'Filtro de habitáculo', everyKm: 15_000, everyMonths: 12 },
  { name: 'Filtro de combustible', everyKm: 20_000 },
  { name: 'Bujías', everyKm: 30_000, spark: true },
  { name: 'Correa de distribución', everyKm: 60_000, everyMonths: 48 },
  { name: 'Rotación de cubiertas', everyKm: 10_000 },
  { name: 'Alineación y balanceo', everyKm: 10_000 },
  { name: 'Pastillas de freno (revisar)', everyKm: 20_000 },
  { name: 'Líquido de frenos', everyMonths: 24 },
  { name: 'Refrigerante', everyMonths: 24 },
  { name: 'Batería (revisar)', everyMonths: 12 },
  { name: 'Service del equipo de GNC', everyKm: 15_000, gnc: true },
];

export function defaultItems(vehicleId: string, fuels: FuelType[], newId: () => string): MaintItem[] {
  const hasGnc = fuels.includes('gnc');
  const spark = fuels.some((f) => f !== 'gasoil');
  return DEFAULT_PLAN.filter((p) => (!p.gnc || hasGnc) && (!p.spark || spark)).map((p, i) => ({
    id: newId(),
    vehicleId,
    name: p.name,
    everyKm: p.everyKm,
    everyMonths: p.everyMonths,
    warnKm: 1000,
    warnDays: 30,
    enabled: true,
    order: i,
  }));
}

export type MaintState = 'due' | 'soon' | 'ok' | 'unknown';

export interface MaintStatus {
  state: MaintState;
  lastKm?: number;
  lastDate?: string;
  nextKm?: number;
  kmLeft?: number;
  nextDate?: string;
  daysLeft?: number;
  /** Días estimados hasta llegar al km del próximo service, a tu ritmo. */
  etaDays?: number;
  /** 0 = recién hecho, 1 o más = ya toca. */
  progress: number;
}

/** Última vez que se hizo: lo cargado a mano o el service más reciente que lo incluye. */
export function lastDone(item: MaintItem, logs: ServiceLog[]) {
  let lastKm = item.baseKm;
  let lastDate = item.baseDate;
  for (const l of logs) {
    if (!l.itemIds.includes(item.id)) continue;
    if (lastKm == null || l.km > lastKm) lastKm = l.km;
    if (lastDate == null || l.date > lastDate) lastDate = l.date;
  }
  return { lastKm, lastDate };
}

export function maintStatus(item: MaintItem, logs: ServiceLog[], currentKm: number, rate: number | null, today = todayKey()): MaintStatus {
  const { lastKm, lastDate } = lastDone(item, logs);
  const st: MaintStatus = { state: 'unknown', progress: 0, lastKm, lastDate };
  let known = false;
  if (item.everyKm && lastKm != null) {
    known = true;
    st.nextKm = lastKm + item.everyKm;
    st.kmLeft = st.nextKm - currentKm;
    st.progress = Math.max(st.progress, (currentKm - lastKm) / item.everyKm);
    if (rate && st.kmLeft > 0) st.etaDays = Math.round(st.kmLeft / rate);
  }
  if (item.everyMonths && lastDate) {
    known = true;
    st.nextDate = addMonths(lastDate, item.everyMonths);
    st.daysLeft = diffDays(today, st.nextDate);
    const total = diffDays(lastDate, st.nextDate);
    st.progress = Math.max(st.progress, total > 0 ? diffDays(lastDate, today) / total : 1);
  }
  if (!known) return st;
  const due = (st.kmLeft != null && st.kmLeft <= 0) || (st.daysLeft != null && st.daysLeft <= 0);
  const soon = (st.kmLeft != null && st.kmLeft <= item.warnKm) || (st.daysLeft != null && st.daysLeft <= item.warnDays);
  st.state = due ? 'due' : soon ? 'soon' : 'ok';
  return st;
}

const RANK: Record<MaintState, number> = { due: 0, soon: 1, ok: 2, unknown: 3 };

/** Ordena de lo más urgente a lo menos. */
export const byUrgency = (a: { st: MaintStatus }, b: { st: MaintStatus }) =>
  RANK[a.st.state] - RANK[b.st.state] || b.st.progress - a.st.progress;

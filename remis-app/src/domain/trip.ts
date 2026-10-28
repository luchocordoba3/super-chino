import { addDays, dayKey } from './dates';
import { type MoneyData, summarize } from './money';

// "¿Me conviene este viaje?": lo que te pagan menos lo que te cuesta andar esos km (nafta y desgaste).

/** Lo que te cuesta cada km según tus últimos 60 días: combustible, service y taller sobre tus km. Null si hay pocos datos. */
export function costPerKm(d: MoneyData, now = new Date()): number | null {
  const to = dayKey(now);
  const s = summarize(d, addDays(to, -59), to, now);
  const km = s.km.mine;
  if (km < 150) return null;
  const spent = (s.costs.by.combustible ?? 0) + (s.costs.by.mantenimiento ?? 0) + (s.costs.by.taller ?? 0);
  return spent > 0 ? spent / km : null;
}

export type Verdict = 'good' | 'meh' | 'bad';

export interface TripInput {
  pay: number;
  kmPickup: number;
  kmTrip: number;
  minutes?: number;
  costKm: number;
  /** Lo mínimo que querés que te quede por km y por hora. */
  minKm?: number;
  minHour?: number;
}

export function tripVerdict(t: TripInput) {
  const km = t.kmPickup + t.kmTrip;
  const cost = km * t.costKm;
  const net = t.pay - cost;
  const perKm = km > 0 ? net / km : null;
  const perHour = t.minutes ? (net / t.minutes) * 60 : null;
  const checks: boolean[] = [];
  if (perKm != null && t.minKm != null) checks.push(perKm >= t.minKm);
  if (perHour != null && t.minHour != null) checks.push(perHour >= t.minHour);
  const verdict: Verdict = net <= 0 ? 'bad' : checks.every(Boolean) ? 'good' : checks.some(Boolean) ? 'meh' : 'bad';
  return { km, cost, net, perKm, perHour, verdict, pickupShare: km > 0 ? t.kmPickup / km : 0 };
}

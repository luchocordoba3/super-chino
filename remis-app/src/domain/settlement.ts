import type { SettlePeriod, Settlement, Vehicle } from '../db/types';
import { addDays, dayKey, endOfMonth, startOfMonth, startOfWeek } from './dates';

// Liquidación con el chofer. Primero se le devuelven los peajes con pasajero (vienen sumados a la
// tarifa) y lo que queda se divide. El combustible, el lavado y los peajes sin pasajero los paga él.

export const SETTLE_LABEL: Record<SettlePeriod, string> = { quincena: 'Quincena', week: 'Semana', month: 'Mes' };

/** Período que contiene al día: quincena (1 al 15, 16 a fin de mes), semana (lunes a domingo) o mes. */
export function settlePeriod(kind: SettlePeriod, day: string): { from: string; to: string } {
  if (kind === 'quincena')
    return Number(day.slice(8, 10)) <= 15
      ? { from: startOfMonth(day), to: `${day.slice(0, 7)}-15` }
      : { from: `${day.slice(0, 7)}-16`, to: endOfMonth(day) };
  if (kind === 'week') return { from: startOfWeek(day), to: addDays(startOfWeek(day), 6) };
  return { from: startOfMonth(day), to: endOfMonth(day) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "del 1 al 15/10" o "del 27/10 al 2/11". */
export function rangeText(from: string, to: string) {
  const d = (k: string) => Number(k.slice(8, 10));
  const m = (k: string) => k.slice(5, 7);
  return m(from) === m(to) ? `del ${d(from)} al ${d(to)}/${m(to)}` : `del ${d(from)}/${m(from)} al ${d(to)}/${m(to)}`;
}

export const periodTitle = (kind: SettlePeriod, from: string, to: string) => `${SETTLE_LABEL[kind]} ${rangeText(from, to)}`;

/** "la quincena del 1 al 15/10", "el mes del 1 al 31/10". */
export const periodPhrase = (kind: SettlePeriod, from: string, to: string) =>
  `${kind === 'month' ? 'el' : 'la'} ${SETTLE_LABEL[kind].toLowerCase()} ${rangeText(from, to)}`;

export function settle(s: Pick<Settlement, 'gross' | 'tolls' | 'percent'>) {
  const toSplit = Math.max(0, s.gross - s.tolls);
  const chofer = round2((toSplit * s.percent) / 100);
  return { returned: s.tolls, toSplit, chofer, owner: round2(toSplit - chofer), choferTotal: round2(s.tolls + chofer) };
}

export const isChofer = (v: Pick<Vehicle, 'driver'>) => v.driver === 'chofer';

/** El último período cerrado que falta cargar (si el auto ya estaba en la app en ese período). */
export function pendingPeriod(v: Vehicle, settlements: Settlement[], today: string) {
  if (!isChofer(v) || !v.chofer) return null;
  const kind = v.chofer.period;
  const prev = settlePeriod(kind, addDays(settlePeriod(kind, today).from, -1));
  if (prev.to < dayKey(v.createdAt) || settlements.some((s) => s.to >= prev.to)) return null;
  return { kind, ...prev };
}

/** Km que hizo el auto en los períodos que cierran entre dos fechas, según el km de cada liquidación. */
export function settlementKm(settlements: Settlement[], initialKm: number, from: string, to: string) {
  let prev = initialKm;
  let km = 0;
  for (const s of [...settlements].sort((a, b) => a.to.localeCompare(b.to))) {
    if (s.km == null) continue;
    if (s.to >= from && s.to <= to) km += Math.max(0, s.km - prev);
    prev = Math.max(prev, s.km);
  }
  return km;
}

const money = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
const kmText = (n: number) => `${new Intl.NumberFormat('es-AR').format(n)} km`;

/** Mensaje para mandarle al chofer por WhatsApp. */
export function settlementText(v: Vehicle, s: Pick<Settlement, 'from' | 'to' | 'gross' | 'tolls' | 'percent' | 'km'>) {
  const r = settle(s);
  const name = v.chofer?.name.trim();
  return [
    name ? `Hola ${name}, te paso la cuenta:` : 'Te paso la cuenta:',
    `*${v.plate || v.name} · ${rangeText(s.from, s.to)}*`,
    `Facturado: ${money(s.gross)}`,
    `Peajes con pasajero (se te devuelven): ${money(r.returned)}`,
    `Queda para dividir: ${money(r.toSplit)}`,
    `Tu parte (${s.percent}%): ${money(r.chofer)}`,
    `*Te corresponden: ${money(r.choferTotal)}*`,
    s.km != null ? `Km al cierre: ${kmText(s.km)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

import type { Expense, FuelLoad, Income, MaintItem, ServiceLog, Shift } from '../db/types';
import { dayKey, fromDayKey, inRange } from './dates';
import { FUEL_LABEL, FUEL_UNIT } from './fuel';
import { shiftKm } from './km';
import { EXPENSE_LABEL, EXPENSE_ONE } from './money';

export type MovementKind = 'shift' | 'fuel' | 'expense' | 'income' | 'service';

/** Una fila del historial: turnos, cargas, gastos, ingresos y services juntos. */
export interface Movement {
  kind: MovementKind;
  id: string;
  at: string;
  title: string;
  detail?: string;
  km?: number;
  /** Positivo si entra plata, negativo si sale. */
  amount?: number;
}

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

export function movements(d: { shifts: Shift[]; fuel: FuelLoad[]; expenses: Expense[]; incomes: Income[]; services: ServiceLog[]; items: MaintItem[] }): Movement[] {
  const out: Movement[] = [];
  for (const s of d.shifts)
    out.push({
      kind: 'shift',
      id: s.id,
      at: s.startAt,
      title: s.endAt ? `Turno · ${nf.format(shiftKm(s))} km` : 'Turno en curso',
      detail: s.endKm != null ? `${nf.format(s.startKm)} → ${nf.format(s.endKm)} km` : `Desde ${nf.format(s.startKm)} km`,
      km: s.endAt ? shiftKm(s) : undefined,
    });
  for (const f of d.fuel)
    out.push({
      kind: 'fuel',
      id: f.id,
      at: f.at,
      title: `${FUEL_LABEL[f.fuel]} · ${nf.format(f.qty)} ${FUEL_UNIT[f.fuel]}`,
      detail: [f.full ? 'Tanque lleno' : 'Carga parcial', f.km != null ? `${nf.format(f.km)} km` : '', f.station ?? ''].filter(Boolean).join(' · '),
      amount: -f.total,
    });
  for (const e of d.expenses)
    out.push({ kind: 'expense', id: e.id, at: e.at, title: EXPENSE_ONE[e.category] ?? EXPENSE_LABEL[e.category], detail: e.note, amount: -e.amount });
  for (const i of d.incomes) {
    const extra = [i.trips ? `${i.trips} viajes` : '', i.tips ? `propinas ${nf.format(i.tips)}` : '', i.agencyFee ? `agencia −${nf.format(i.agencyFee)}` : ''];
    out.push({ kind: 'income', id: i.id, at: i.at, title: 'Recaudación', detail: extra.filter(Boolean).join(' · ') || i.note, amount: i.gross + (i.tips ?? 0) - i.agencyFee });
  }
  const names = new Map(d.items.map((i) => [i.id, i.name]));
  for (const s of d.services) {
    const noon = fromDayKey(s.date);
    noon.setHours(12);
    out.push({
      kind: 'service',
      id: s.id,
      at: noon.toISOString(),
      title: 'Service',
      detail: [s.itemIds.map((id) => names.get(id)).filter(Boolean).join(', '), s.shop ?? ''].filter(Boolean).join(' · '),
      km: s.km,
      amount: s.cost ? -s.cost : undefined,
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

const KIND_LABEL: Record<MovementKind, string> = { shift: 'Turno', fuel: 'Combustible', expense: 'Gasto', income: 'Ingreso', service: 'Service' };

/** CSV para Excel en español: separador punto y coma, coma decimal y BOM para los acentos. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v == null) return '';
    let s = typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : v;
    if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

export function movementsCsv(list: Movement[], from: string, to: string): string {
  const rows: (string | number | undefined)[][] = [['Fecha', 'Hora', 'Tipo', 'Detalle', 'Km', 'Ingreso', 'Gasto']];
  for (const m of [...list].reverse()) {
    const day = dayKey(m.at);
    if (!inRange(day, from, to)) continue;
    const d = new Date(m.at);
    rows.push([
      day.split('-').reverse().join('/'),
      m.kind === 'service' ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      KIND_LABEL[m.kind],
      [m.title, m.detail].filter(Boolean).join(' · '),
      m.km,
      m.amount != null && m.amount > 0 ? m.amount : undefined,
      m.amount != null && m.amount < 0 ? -m.amount : undefined,
    ]);
  }
  return toCsv(rows);
}

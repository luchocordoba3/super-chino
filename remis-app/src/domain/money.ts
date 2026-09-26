import type { AgencyConfig, Expense, ExpenseCategory, FuelLoad, FuelType, Income, ServiceLog, Shift } from '../db/types';
import { addDays, dayKey, endOfMonth, inRange, startOfMonth, startOfWeek } from './dates';
import { gapsBetweenShifts, shiftHours, shiftKm } from './km';

export const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  peaje: 'Peajes',
  estacionamiento: 'Estacionamiento',
  lavado: 'Lavado',
  agencia: 'Base de la agencia',
  taller: 'Taller y repuestos',
  seguro: 'Seguro',
  patente: 'Patente',
  tramites: 'Trámites (VTV, habilitación…)',
  multa: 'Multas',
  celular: 'Celular y datos',
  comida: 'Comida',
  otro: 'Otros',
};

/** Nombre de un gasto suelto, para el historial. */
export const EXPENSE_ONE: Partial<Record<ExpenseCategory, string>> = { peaje: 'Peaje', multa: 'Multa', otro: 'Otro gasto' };

export type CostKey = ExpenseCategory | 'combustible' | 'mantenimiento';
export const COST_LABEL: Record<CostKey, string> = { ...EXPENSE_LABEL, combustible: 'Combustible', mantenimiento: 'Service y mantenimiento' };

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Comisión de la agencia cuando cobra un porcentaje de lo recaudado. */
export const agencyFeeFor = (gross: number, cfg: AgencyConfig) =>
  cfg.mode === 'percent' && cfg.percent ? round2((gross * cfg.percent) / 100) : 0;

export interface MoneyData {
  shifts: Shift[];
  fuel: FuelLoad[];
  expenses: Expense[];
  incomes: Income[];
  services: ServiceLog[];
}

export interface Summary {
  from: string;
  to: string;
  km: { mine: number; other: number };
  hours: number;
  shifts: number;
  /** Días con al menos un turno. */
  days: number;
  income: { gross: number; tips: number; agency: number; trips: number; cash: number; net: number };
  costs: { total: number; by: Partial<Record<CostKey, number>> };
  /** Lo que te queda: recaudado + propinas − agencia − todos los gastos. */
  profit: number;
  perKm: { cost: number | null; profit: number | null };
  perHour: number | null;
  fuel: { total: number; qty: Partial<Record<FuelType, number>> };
}

export function summarize(d: MoneyData, from: string, to: string, now = new Date()): Summary {
  const inR = (iso: string) => inRange(dayKey(iso), from, to);
  const shifts = d.shifts.filter((s) => inR(s.startAt));
  const mine = shifts.reduce((a, s) => a + shiftKm(s), 0);
  const other = gapsBetweenShifts(d.shifts)
    .filter((g) => inR(g.at))
    .reduce((a, g) => a + g.km, 0);
  const hours = shifts.reduce((a, s) => a + shiftHours(s, now), 0);

  const income = { gross: 0, tips: 0, agency: 0, trips: 0, cash: 0, net: 0 };
  for (const i of d.incomes.filter((x) => inR(x.at))) {
    income.gross += i.gross;
    income.tips += i.tips ?? 0;
    income.agency += i.agencyFee;
    income.trips += i.trips ?? 0;
    income.cash += i.cash ?? 0;
  }
  income.net = income.gross + income.tips - income.agency;

  const by: Partial<Record<CostKey, number>> = {};
  const add = (k: CostKey, n: number) => (by[k] = (by[k] ?? 0) + n);
  const fuel = { total: 0, qty: {} as Partial<Record<FuelType, number>> };
  for (const f of d.fuel.filter((x) => inR(x.at))) {
    add('combustible', f.total);
    fuel.total += f.total;
    fuel.qty[f.fuel] = (fuel.qty[f.fuel] ?? 0) + f.qty;
  }
  for (const e of d.expenses.filter((x) => inR(x.at))) add(e.category, e.amount);
  for (const s of d.services.filter((x) => inRange(x.date, from, to))) if (s.cost) add('mantenimiento', s.cost);
  const total = Object.values(by).reduce((a, n) => a + (n ?? 0), 0);

  const profit = income.net - total;
  return {
    from,
    to,
    km: { mine, other },
    hours,
    shifts: shifts.length,
    days: new Set(shifts.map((s) => dayKey(s.startAt))).size,
    income,
    costs: { total, by },
    profit,
    perKm: { cost: mine > 0 ? total / mine : null, profit: mine > 0 ? profit / mine : null },
    perHour: hours > 0 ? profit / hours : null,
    fuel,
  };
}

/** Con el auto compartido: cuánto le toca a cada uno si dividen el mantenimiento por km. */
export function splitByKm(amount: number, km: { mine: number; other: number }) {
  const total = km.mine + km.other;
  if (!total || !amount) return null;
  const share = km.mine / total;
  return { share, mine: amount * share, other: amount * (1 - share) };
}

export type PeriodKind = 'day' | 'week' | 'month';

export function periodRange(kind: PeriodKind, anchor: string): { from: string; to: string } {
  if (kind === 'day') return { from: anchor, to: anchor };
  if (kind === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
}

/** Base fija de la agencia: cuánto corresponde en el período actual y cuánto ya pagaste. */
export function agencyDue(cfg: AgencyConfig, expenses: Expense[], today: string) {
  if (cfg.mode !== 'fixed' || !cfg.amount) return null;
  const { from, to } = periodRange(cfg.period ?? 'week', today);
  const paid = expenses.filter((e) => e.category === 'agencia' && inRange(dayKey(e.at), from, to)).reduce((a, e) => a + e.amount, 0);
  return { from, to, amount: cfg.amount, paid, left: Math.max(0, cfg.amount - paid) };
}

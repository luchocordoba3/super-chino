import type { AgencyConfig, AgencyPeriod, Expense, ExpenseCategory, FuelLoad, FuelType, Income, PlatformId, ServiceLog, Settlement, Shift } from '../db/types';
import { addDays, dayKey, endOfMonth, inRange, startOfMonth, startOfWeek } from './dates';
import { gapsBetweenShifts, shiftHours, shiftKm } from './km';
import { incomePlatform } from './platforms';
import { settle } from './settlement';

export const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  peaje: 'Peajes',
  estacionamiento: 'Estacionamiento',
  lavado: 'Lavado',
  agencia: 'Base de la agencia',
  alquiler: 'Alquiler del auto',
  monotributo: 'Monotributo',
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
  settlements?: Settlement[];
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
  /** Por app o agencia: lo que te quedó (con propinas y sin comisión), lo que se llevaron y los viajes. */
  byPlatform: Partial<Record<PlatformId, { net: number; fee: number; trips: number }>>;
  /** Auto con chofer: liquidaciones que cierran en el período. */
  split: { count: number; gross: number; returned: number; chofer: number; owner: number };
  costs: { total: number; by: Partial<Record<CostKey, number>> };
  /** Lo que te queda: recaudado + propinas − agencia + tu parte de las liquidaciones − todos los gastos. */
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
  const byPlatform: Summary['byPlatform'] = {};
  for (const i of d.incomes.filter((x) => inR(x.at))) {
    const p = (byPlatform[incomePlatform(i)] ??= { net: 0, fee: 0, trips: 0 });
    p.net += i.gross + (i.tips ?? 0) - i.agencyFee;
    p.fee += i.agencyFee;
    p.trips += i.trips ?? 0;
    income.gross += i.gross;
    income.tips += i.tips ?? 0;
    income.agency += i.agencyFee;
    income.trips += i.trips ?? 0;
    income.cash += i.cash ?? 0;
  }
  const split = { count: 0, gross: 0, returned: 0, chofer: 0, owner: 0 };
  for (const x of (d.settlements ?? []).filter((s) => inRange(s.to, from, to))) {
    const r = settle(x);
    split.count++;
    split.gross += x.gross;
    split.returned += r.returned;
    split.chofer += r.chofer;
    split.owner += r.owner;
  }
  income.net = income.gross + income.tips - income.agency + split.owner;

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
    byPlatform,
    split,
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

/** Un pago fijo por período (base de la agencia, alquiler del auto): cuánto corresponde ahora y cuánto ya pagaste. */
export function fixedDue(amount: number, period: AgencyPeriod, category: ExpenseCategory, expenses: Expense[], today: string) {
  const { from, to } = periodRange(period, today);
  const paid = expenses.filter((e) => e.category === category && inRange(dayKey(e.at), from, to)).reduce((a, e) => a + e.amount, 0);
  return { from, to, amount, paid, left: Math.max(0, amount - paid) };
}

/** Base fija de la agencia: cuánto corresponde en el período actual y cuánto ya pagaste. */
export function agencyDue(cfg: AgencyConfig, expenses: Expense[], today: string) {
  if (cfg.mode !== 'fixed' || !cfg.amount) return null;
  return fixedDue(cfg.amount, cfg.period ?? 'week', 'agencia', expenses, today);
}

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** Cuánto te queda por hora según el día de la semana (turnos cerrados con su ingreso), de lunes a domingo. */
export function bestDays(shifts: Shift[], incomes: Income[], from: string, to: string) {
  const net = new Map<string, number>();
  for (const i of incomes) if (i.shiftId) net.set(i.shiftId, (net.get(i.shiftId) ?? 0) + i.gross + (i.tips ?? 0) - i.agencyFee);
  const days = WEEKDAYS.map((label) => ({ label, hours: 0, net: 0, shifts: 0 }));
  for (const s of shifts) {
    if (!s.endAt || !inRange(dayKey(s.startAt), from, to)) continue;
    const d = days[new Date(s.startAt).getDay()];
    d.hours += shiftHours(s);
    d.net += net.get(s.id) ?? 0;
    d.shifts++;
  }
  return [...days.slice(1), days[0]].map((d) => ({ ...d, perHour: d.hours > 0 ? d.net / d.hours : null }));
}

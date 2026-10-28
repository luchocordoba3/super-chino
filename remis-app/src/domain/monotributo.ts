import type { Expense, Income, MonoCat, Settlement } from '../db/types';
import { addDays, addMonths, dayKey, inRange, startOfMonth } from './dates';
import type { Alert } from './alerts';
import { settle } from './settlement';

// Monotributo (orientativo, para servicios). Valores vigentes desde el 1/8/2026: se actualizan en febrero y agosto.
// Fuente: ARCA (afip.gob.ar/monotributo/categorias.asp). Se pueden cambiar a mano en Ajustes.

export const MONO_DATE = '2026-08-01';

export const MONO_TABLE: Record<MonoCat, { limit: number; monthly: number }> = {
  A: { limit: 12_009_410.45, monthly: 49_527.18 },
  B: { limit: 17_595_182.74, monthly: 56_379.08 },
  C: { limit: 24_670_494.31, monthly: 66_020.12 },
  D: { limit: 30_628_651.43, monthly: 84_612.93 },
  E: { limit: 36_028_231.33, monthly: 119_811.45 },
  F: { limit: 45_151_659.41, monthly: 150_784.21 },
  G: { limit: 53_995_798.87, monthly: 230_312.94 },
  H: { limit: 81_924_660.37, monthly: 522_706.68 },
  I: { limit: 91_699_761.9, monthly: 963_747.86 },
  J: { limit: 105_012_519.2, monthly: 1_167_299.76 },
  K: { limit: 126_610_838.75, monthly: 1_614_446.04 },
};

export const MONO_CATS = Object.keys(MONO_TABLE) as MonoCat[];

/** Lo que cobraste en los últimos 12 meses (todas las apps y autos, y tu parte de las liquidaciones del chofer). */
export function billedLast12(incomes: Income[], settlements: Settlement[], today: string) {
  const from = addDays(addMonths(today, -12), 1);
  const inc = incomes.filter((i) => inRange(dayKey(i.at), from, today)).reduce((a, i) => a + i.gross + (i.tips ?? 0), 0);
  const liq = settlements.filter((s) => inRange(s.to, from, today)).reduce((a, s) => a + settle(s).owner, 0);
  return inc + liq;
}

export function monoAlerts(
  cfg: { cat: MonoCat; monthly: number; limit: number },
  d: { incomes: Income[]; expenses: Expense[]; settlements: Settlement[] },
  today: string,
): Alert[] {
  const out: Alert[] = [];
  const day = Number(today.slice(8, 10));
  const month = Number(today.slice(5, 7));
  const paid = d.expenses.some((e) => e.category === 'monotributo' && dayKey(e.at) >= startOfMonth(today));
  if (!paid && day >= 10)
    out.push(
      day <= 20
        ? { id: 'mono-pay', level: 'warn', title: 'Pagá el monotributo', detail: `Vence el 20. Tu cuota (categoría ${cfg.cat}): $ ${Math.round(cfg.monthly).toLocaleString('es-AR')}`, to: '/ajustes' }
        : { id: 'mono-pay', level: 'danger', title: 'Se pasó la fecha del monotributo', detail: 'Vencía el 20. Pagalo cuanto antes (con intereses) y anotalo en la app.', to: '/ajustes' },
    );
  if ((month === 1 || month === 7) && day <= 20)
    out.push({ id: 'mono-recat', level: 'info', title: 'Recategorización del monotributo', detail: 'Hasta el 20: revisá si tu categoría sigue siendo la que corresponde.', to: '/ajustes' });
  const billed = billedLast12(d.incomes, d.settlements, today);
  const pct = cfg.limit > 0 ? billed / cfg.limit : 0;
  if (pct >= 0.8)
    out.push({
      id: 'mono-limit',
      level: pct >= 1 ? 'danger' : 'warn',
      title: pct >= 1 ? `Te pasaste del tope de la categoría ${cfg.cat}` : `Llegaste al ${Math.round(pct * 100)}% del tope de la categoría ${cfg.cat}`,
      detail: 'En los últimos 12 meses. Consultá con tu contador si te conviene recategorizarte.',
      to: '/ajustes',
    });
  return out;
}

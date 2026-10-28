import type { Sale, SalePlan } from '../db/types';
import { addDays, dayKey, diffDays, inRange, startOfMonth, endOfMonth } from './dates';
import { PLAN_DAYS } from './license';

// Panel del vendedor: renovaciones, clientes activos y lo que se espera cobrar.

/** Desde y hasta cuándo vale un código nuevo. Si el cliente todavía tiene un plan vigente, arranca al día siguiente de que termine. */
export function planRange(plan: SalePlan, installId: string | undefined, sales: Sale[], today: string, promoDays = 7) {
  const current = installId
    ? sales.filter((s) => s.installId === installId && s.expires >= today).sort((a, b) => b.expires.localeCompare(a.expires))[0]
    : undefined;
  const starts = current ? addDays(current.expires, 1) : today;
  const days = plan === 'promo' ? promoDays : PLAN_DAYS[plan];
  return { starts, expires: addDays(starts, days - 1), renewal: !!current };
}

/** Clientes activos hoy: un cliente cuenta una vez, con su último plan (los promos no suman al estimado). */
export function activeClients(sales: Sale[], today: string) {
  const byClient = new Map<string, Sale>();
  for (const s of sales) {
    if (s.starts > today || s.expires < today) continue;
    const key = s.installId || s.id;
    const prev = byClient.get(key);
    if (!prev || prev.expires < s.expires) byClient.set(key, s);
  }
  return [...byClient.values()];
}

export function salesStats(sales: Sale[], today: string, prices: { mes: number; anual: number }) {
  const active = activeClients(sales, today);
  const anual = active.filter((s) => s.plan === 'anual').length;
  const mes = active.filter((s) => s.plan === 'mes').length;
  const promo = active.filter((s) => s.plan === 'promo').length;
  const month = sales.filter((s) => inRange(dayKey(s.at), startOfMonth(today), endOfMonth(today)));
  // Clientes que vencen en los próximos 30 días y todavía no renovaron.
  const renewed = new Set(sales.filter((s) => s.starts > today && s.installId).map((s) => s.installId));
  const upcoming = active
    .filter((s) => s.plan !== 'promo' && diffDays(today, s.expires) <= 30 && !(s.installId && renewed.has(s.installId)))
    .sort((a, b) => a.expires.localeCompare(b.expires));
  return {
    active: { anual, mes, promo },
    /** Lo que se espera cobrar en un año si todos renuevan, con los precios de hoy. */
    yearly: anual * prices.anual + mes * prices.mes * 12,
    month: { count: month.length, total: month.reduce((a, s) => a + s.amount, 0) },
    upcoming,
  };
}

export function salesCsvRows(sales: Sale[]) {
  const rows: (string | number | undefined)[][] = [['Fecha', 'Cliente', 'WhatsApp', 'Código de celular', 'Plan', 'Desde', 'Hasta', 'Monto']];
  const d = (k: string) => k.split('-').reverse().join('/');
  for (const s of [...sales].sort((a, b) => a.at.localeCompare(b.at)))
    rows.push([d(dayKey(s.at)), s.name, s.phone, s.installId || 'Promo', s.plan, d(s.starts), d(s.expires), s.amount]);
  return rows;
}

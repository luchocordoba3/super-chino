import { parseNumber } from './sheet';

const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const ars2 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });

/** $ 306.040 */
export const money = (n: number | null | undefined) => ars.format(Math.round(n ?? 0));
/** $ 1.234,50 (precios unitarios) */
export const money2 = (n: number | null | undefined) => ars2.format(n ?? 0);
export const dollars = (n: number | null | undefined) => usd.format(n ?? 0).replace('US$', 'US$ ');
export const qty = (n: number | null | undefined) => num.format(n ?? 0);
export const price = (n: number, currency: 'ARS' | 'USD') => (currency === 'USD' ? dollars(n) : money2(n));

export const dateFmt = (d: string | Date) => new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(d));
export const dayMonth = (d: string | Date) => new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'numeric' }).format(new Date(d));
export const dateTimeFmt = (d: string | Date) =>
  new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(d));

/** "hace 3 días", "hoy", "ayer" */
export function ago(d: string | Date) {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} días`;
}

/** Número desde un input, aceptando coma decimal (vacío = null). */
export const toNum = (v: string): number | null => (v.trim() === '' ? null : parseNumber(v));

export const firstName = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] ?? '';

/** "lun 6/10" */
export const dayName = (d: string | Date) => new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric' }).format(new Date(d));
/** "09:30" */
export const hourFmt = (d: string | Date) => new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
/** Valor para <input type="datetime-local"> en hora local. */
export const toLocalInput = (d: string | Date | null | undefined) => {
  if (!d) return '';
  const x = new Date(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
};
/** Link de Google Maps para una dirección. */
export const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

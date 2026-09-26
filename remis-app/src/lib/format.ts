// Formatos en español de Argentina (adaptado de Super Chino).

const money0 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const money2f = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

export const money = (n: number | null | undefined) => money0.format(n ?? 0);
/** Con centavos, para precios por litro o por km. */
export const money2 = (n: number | null | undefined) => money2f.format(n ?? 0);
export const kmFmt = (n: number | null | undefined) => `${int.format(n ?? 0)} km`;
export const numFmt = (n: number | null | undefined, digits = 1) =>
  new Intl.NumberFormat('es-AR', { maximumFractionDigits: digits }).format(n ?? 0);

/** AAAA-MM-DD -> dd/mm/aa sin corrimientos de zona horaria. */
export const dayFmt = (d: string | null | undefined) => {
  if (!d) return '—';
  const [y, m, dd] = d.slice(0, 10).split('-');
  return `${dd}/${m}/${y.slice(2)}`;
};

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
/** AAAA-MM-DD -> "lun 12/05". */
export const dayShort = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};

export const dateTimeFmt = (d: string | Date) =>
  new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));

export const timeFmt = (d: string | Date) => new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));

export const hoursFmt = (h: number) => {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return hh ? `${hh} h ${String(mm).padStart(2, '0')} min` : `${mm} min`;
};

export const daysText = (n: number) => (Math.abs(n) === 1 ? `${n} día` : `${n} días`);

/**
 * Número escrito a mano: acepta "15.000", "15000", "1.234,50", "35,5" o "35.5".
 * Un punto seguido de exactamente 3 cifras se toma como separador de miles.
 */
export function parseNum(v: string): number | null {
  let s = v.trim().replace(/[\s$]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Km del odómetro: solo cifras. */
export function parseKm(v: string): number | null {
  const s = v.replace(/\D/g, '');
  return s ? Number(s) : null;
}

/** Para mostrar un número en un input sin perder lo que el usuario escribió. */
export const numInput = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

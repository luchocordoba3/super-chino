let currency = 'ARS';
export const setCurrency = (c: string) => {
  currency = c || 'ARS';
};

export const money = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n ?? 0);

export const qtyFmt = (n: number | null | undefined) =>
  new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(n ?? 0);

/** Fecha sola (AAAA-MM-DD o ISO a medianoche UTC) -> dd/mm/aa sin corrimientos de zona horaria. */
export const dayFmt = (d: string | null | undefined) => {
  if (!d) return '—';
  const [y, m, dd] = d.slice(0, 10).split('-');
  return `${dd}/${m}/${y.slice(2)}`;
};

export const dateTimeFmt = (d: string | Date) =>
  new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(d));

export const timeFmt = (d: string | Date) =>
  new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(new Date(d));

/** Días desde hoy (local) hasta una fecha AAAA-MM-DD. */
export function daysUntil(d: string) {
  const today = new Date();
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, dd) - t) / 86_400_000);
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

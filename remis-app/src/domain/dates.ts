// Fechas en hora local del celular. Los días se manejan como texto AAAA-MM-DD.

const pad = (n: number) => String(n).padStart(2, '0');

/** Día local (AAAA-MM-DD) de una fecha u hora ISO. */
export function dayKey(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export const todayKey = (now = new Date()) => dayKey(now);

/** Medianoche local de un día AAAA-MM-DD. */
export function fromDayKey(key: string): Date {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

const utcOf = (key: string) => {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Días enteros de `from` a `to` (negativo si `to` es anterior). */
export const diffDays = (from: string, to: string) => Math.round((utcOf(to) - utcOf(from)) / 86_400_000);

export function addDays(key: string, n: number): string {
  const d = fromDayKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Suma meses sin pasarse de fin de mes (31/01 + 1 mes = 28 o 29/02). */
export function addMonths(key: string, n: number): string {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(ny, nm + 1, 0).getDate();
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`;
}

/** Lunes de la semana del día dado. */
export function startOfWeek(key: string): string {
  const dow = (fromDayKey(key).getDay() + 6) % 7;
  return addDays(key, -dow);
}

export const startOfMonth = (key: string) => `${key.slice(0, 7)}-01`;
export const endOfMonth = (key: string) => addDays(addMonths(startOfMonth(key), 1), -1);

export const inRange = (key: string, from: string, to: string) => key >= from && key <= to;

/** Todos los días entre dos fechas, inclusive. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

/** ISO -> valor de <input type="datetime-local">. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Valor de <input type="datetime-local"> -> ISO. */
export const fromLocalInput = (v: string) => new Date(v).toISOString();

export const hoursBetween = (a: string, b: string) => Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000);

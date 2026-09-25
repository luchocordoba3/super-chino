/** Fecha local (AAAA-MM-DD) en la zona horaria del local. */
export function localYMD(tz: string, d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** AAAA-MM-DD -> Date a medianoche UTC (así se guardan y comparan las columnas @db.Date). */
export const dateOnly = (ymd: string) => new Date(ymd.slice(0, 10) + 'T00:00:00.000Z');

/** Hoy (fecha local del negocio) como Date a medianoche UTC. */
export const localToday = (tz: string, d = new Date()) => dateOnly(localYMD(tz, d));

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
export const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86_400_000);

function tzOffsetMs(tz: string, at: Date) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(at.getTime() / 1000) * 1000;
}

/** Instante en que empieza el día local que contiene `d`. */
export function startOfLocalDay(tz: string, d = new Date()) {
  const midnightUtc = localToday(tz, d);
  return new Date(midnightUtc.getTime() - tzOffsetMs(tz, midnightUtc));
}

/** Instante en que empieza el mes local que contiene `d`. */
export const startOfLocalMonth = (tz: string, d = new Date()) => startOfLocalDay(tz, new Date(`${localYMD(tz, d).slice(0, 8)}01T12:00:00Z`));

export const localHour = (tz: string, d = new Date()) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(d));

/** Día de la semana local (0 = domingo). */
export const localWeekday = (tz: string, d = new Date()) => new Date(`${localYMD(tz, d)}T12:00:00Z`).getUTCDay();

/** Minutos desde la medianoche local. */
export function localMinutes(tz: string, d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return g('hour') * 60 + g('minute');
}

/** Instante de la hora local "HH:MM" del día local AAAA-MM-DD. */
export function localDateTime(tz: string, ymd: string, hhmm: string) {
  const guess = new Date(`${ymd.slice(0, 10)}T${hhmm}:00.000Z`);
  const first = new Date(guess.getTime() - tzOffsetMs(tz, guess));
  return new Date(guess.getTime() - tzOffsetMs(tz, first));
}

/** Hora local "HH:MM". */
export const localHM = (tz: string, d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

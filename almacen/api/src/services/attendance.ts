import type { Attendance } from '../generated/prisma/index.js';
import { hhmmToMin, parseSchedule, round2 } from '@almacen/shared';
import { type Db, prisma } from '../db';
import { addDays, dateOnly, localDateTime, localMinutes, localWeekday, localYMD, startOfLocalDay } from '../domain/dates';
import { type NewAlert, raiseAlert, resolveAlert } from './alerts';
import { storeCtx } from './store';

export type ClockSource = 'pos' | 'phone' | 'manual';

/** Una entrada sin salida de hace más de esto ya no se considera "trabajando": falta fichar la salida. */
const OPEN_MS = 16 * 3600_000;
/** Una segunda salida dentro de este lapso se toma como la misma (doble toque o reintento). */
const DOUBLE_TAP_MS = 10 * 60_000;

const weekdayOf = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Ficha la entrada o la salida de un empleado (desde la caja, el celular o el dueño).
 * Idempotente por id. Devuelve null si el empleado no existe o está desactivado.
 */
export async function clock(
  db: Db,
  a: { id: string; storeId: string; userId: string; action: 'in' | 'out'; at: Date; source: ClockSource; deviceId?: string | null },
) {
  const alerts: { isNew: boolean; alert: NewAlert }[] = [];
  const done = await db.attendance.findUnique({ where: { id: a.id } });
  if (done) return { entry: done, alerts };
  const user = await db.user.findFirst({ where: { id: a.userId, storeId: a.storeId, active: true } });
  if (!user) return null;
  const open = await db.attendance.findFirst({
    where: { storeId: a.storeId, userId: a.userId, outAt: null, inAt: { lte: a.at, gte: new Date(a.at.getTime() - OPEN_MS) } },
    orderBy: { inAt: 'desc' },
  });

  if (a.action === 'in') {
    if (open) return { entry: open, alerts };
    const { store, settings } = await storeCtx(db, a.storeId);
    const tz = store.timezone;
    const ymd = localYMD(tz, a.at);
    const earlier = await db.attendance.count({ where: { storeId: a.storeId, userId: a.userId, inAt: { gte: startOfLocalDay(tz, a.at), lt: a.at } } });
    const shift = parseSchedule(user.schedule)?.[localWeekday(tz, a.at)];
    const late = shift && earlier === 0 ? localMinutes(tz, a.at) - hhmmToMin(shift.start) : 0;
    const entry = await db.attendance.create({
      data: { id: a.id, storeId: a.storeId, userId: a.userId, inAt: a.at, inSource: a.source, deviceId: a.deviceId ?? null, lateMin: late > 0 ? late : null },
    });
    await resolveAlert(db, a.storeId, `ABSENT:${a.userId}:${ymd}`);
    if (shift && late > settings.lateToleranceMin) {
      alerts.push(await raiseAlert(db, a.storeId, 'LATE', `LATE:${a.userId}:${ymd}`, { userId: a.userId, name: user.name, minutes: late, start: shift.start, date: ymd }));
    }
    return { entry, alerts };
  }

  if (open) return { entry: await db.attendance.update({ where: { id: open.id }, data: { outAt: a.at, outSource: a.source } }), alerts };
  const recent = await db.attendance.findFirst({
    where: { storeId: a.storeId, userId: a.userId, outAt: { lte: a.at, gte: new Date(a.at.getTime() - DOUBLE_TAP_MS) } },
    orderBy: { outAt: 'desc' },
  });
  if (recent) return { entry: recent, alerts };
  // Salida sin entrada: queda para que el dueño la corrija.
  const entry = await db.attendance.create({
    data: { id: a.id, storeId: a.storeId, userId: a.userId, outAt: a.at, outSource: a.source, deviceId: a.deviceId ?? null },
  });
  return { entry, alerts };
}

/** Estado de un empleado: si está trabajando (desde cuándo) y sus fichajes de hoy. */
export async function myStatus(storeId: string, userId: string, now = new Date()) {
  const { store } = await storeCtx(prisma, storeId);
  const from = startOfLocalDay(store.timezone, now);
  const [open, today] = await Promise.all([
    prisma.attendance.findFirst({ where: { storeId, userId, outAt: null, inAt: { lte: now, gte: new Date(now.getTime() - OPEN_MS) } }, orderBy: { inAt: 'desc' } }),
    prisma.attendance.findMany({ where: { storeId, userId, OR: [{ inAt: { gte: from } }, { inAt: null, outAt: { gte: from } }] }, orderBy: { createdAt: 'asc' } }),
  ]);
  return { working: !!open, since: open?.inAt ?? null, today: today.map(publicEntry) };
}

const minutesOf = (e: Attendance) => (e.inAt && e.outAt ? Math.max(0, Math.round((e.outAt.getTime() - e.inAt.getTime()) / 60_000)) : 0);

function publicEntry(e: Attendance) {
  return { id: e.id, userId: e.userId, inAt: e.inAt, outAt: e.outAt, inSource: e.inSource, outSource: e.outSource, lateMin: e.lateMin, note: e.note, editedAt: e.editedAt, minutes: minutesOf(e) };
}

/** Empleados a los que se les controla el horario (activos y con horario cargado). */
async function scheduledStaff(storeId: string) {
  const users = await prisma.user.findMany({ where: { storeId, role: 'EMPLOYEE' }, orderBy: { name: 'asc' } });
  return users.map((u) => ({ ...u, week: parseSchedule(u.schedule) }));
}

/** ¿Tenía que venir ese día? (tiene horario, ya había entrado a trabajar y está activo). */
function expectedOn(u: { week: ReturnType<typeof parseSchedule>; hiredAt: Date | null; createdAt: Date; active: boolean }, ymd: string, tz: string) {
  const shift = u.week?.[weekdayOf(ymd)];
  if (!shift || !u.active) return null;
  if (u.hiredAt && ymdOf(u.hiredAt) > ymd) return null;
  if (localYMD(tz, u.createdAt) > ymd) return null;
  return shift;
}

/** Aviso de ausencia: pasada la hora de entrada (+ margen), el empleado con horario todavía no fichó. */
export async function absentCheck(storeId: string, now = new Date()) {
  const { store, settings } = await storeCtx(prisma, storeId);
  const tz = store.timezone;
  const ymd = localYMD(tz, now);
  const mins = localMinutes(tz, now);
  const from = startOfLocalDay(tz, now);
  const alerts: NewAlert[] = [];
  for (const u of await scheduledStaff(storeId)) {
    const shift = expectedOn(u, ymd, tz);
    if (!shift || mins < hhmmToMin(shift.start) + settings.absentAfterMin) continue;
    const key = `ABSENT:${u.id}:${ymd}`;
    // Un aviso por día: si el dueño ya lo vio y lo cerró, no se repite.
    if (await prisma.alert.findUnique({ where: { storeId_key: { storeId, key } } })) continue;
    const came = await prisma.attendance.count({ where: { storeId, userId: u.id, OR: [{ inAt: { gte: from } }, { outAt: { gte: from } }] } });
    if (came) continue;
    const r = await raiseAlert(prisma, storeId, 'ABSENT', key, { userId: u.id, name: u.name, start: shift.start, date: ymd }, 'danger');
    if (r.isNew) alerts.push(r.alert);
  }
  return alerts;
}

/** Hoy en el local: quién está trabajando, quién llegó tarde, quién falta y a quién se espera más tarde. */
export async function todayBoard(storeId: string, now = new Date()) {
  const { store, settings } = await storeCtx(prisma, storeId);
  const tz = store.timezone;
  const ymd = localYMD(tz, now);
  const mins = localMinutes(tz, now);
  const from = startOfLocalDay(tz, now);
  const [staff, entries] = await Promise.all([
    scheduledStaff(storeId),
    prisma.attendance.findMany({ where: { storeId, OR: [{ inAt: { gte: new Date(Math.min(from.getTime(), now.getTime() - OPEN_MS)) } }, { outAt: { gte: from } }] } }),
  ]);
  const names = new Map((await prisma.user.findMany({ where: { storeId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const working = entries
    .filter((e) => e.inAt && !e.outAt && e.inAt.getTime() >= now.getTime() - OPEN_MS)
    .sort((a, b) => a.inAt!.getTime() - b.inAt!.getTime())
    .map((e) => ({ userId: e.userId, name: names.get(e.userId) ?? '?', since: e.inAt, lateMin: e.lateMin }));
  const late = entries
    .filter((e) => e.inAt && e.inAt >= from && (e.lateMin ?? 0) > settings.lateToleranceMin)
    .map((e) => ({ userId: e.userId, name: names.get(e.userId) ?? '?', minutes: e.lateMin! }));
  const cameToday = new Set(entries.filter((e) => (e.inAt && e.inAt >= from) || (e.outAt && e.outAt >= from)).map((e) => e.userId));
  const absent: { userId: string; name: string; start: string }[] = [];
  const expected: { userId: string; name: string; start: string }[] = [];
  for (const u of staff) {
    const shift = expectedOn(u, ymd, tz);
    if (!shift || cameToday.has(u.id)) continue;
    if (mins >= hhmmToMin(shift.start) + settings.absentAfterMin) absent.push({ userId: u.id, name: u.name, start: shift.start });
    else expected.push({ userId: u.id, name: u.name, start: shift.start });
  }
  return { working, late, absent, expected };
}

/**
 * Horas para pagar sueldos entre dos fechas locales (inclusive): por empleado, días trabajados, horas
 * (solo fichajes completos), llegadas tarde, faltas (días con horario sin ningún fichaje) y fichajes incompletos.
 */
export async function attendanceReport(storeId: string, fromYmd: string, toYmd: string, userId?: string, now = new Date()) {
  const { store, settings } = await storeCtx(prisma, storeId);
  const tz = store.timezone;
  const from = localDateTime(tz, fromYmd, '00:00');
  const to = localDateTime(tz, ymdOf(addDays(dateOnly(toYmd), 1)), '00:00');
  const todayYmd = localYMD(tz, now);
  const nowMins = localMinutes(tz, now);
  const [staff, rows] = await Promise.all([
    scheduledStaff(storeId),
    prisma.attendance.findMany({
      where: { storeId, ...(userId ? { userId } : {}), OR: [{ inAt: { gte: from, lt: to } }, { inAt: null, outAt: { gte: from, lt: to } }] },
      orderBy: [{ inAt: 'asc' }, { outAt: 'asc' }],
    }),
  ]);
  const names = new Map((await prisma.user.findMany({ where: { storeId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const entries = rows.map((e) => {
    const day = localYMD(tz, (e.inAt ?? e.outAt)!);
    const open = !!e.inAt && !e.outAt && e.inAt.getTime() >= now.getTime() - OPEN_MS;
    return { ...publicEntry(e), name: names.get(e.userId) ?? '?', day, open, incomplete: !open && (!e.inAt || !e.outAt), late: (e.lateMin ?? 0) > settings.lateToleranceMin };
  });

  const people = staff.filter((u) => (!userId || u.id === userId) && (u.active || entries.some((e) => e.userId === u.id)));
  const days: string[] = [];
  for (let d = dateOnly(fromYmd); ymdOf(d) <= toYmd && ymdOf(d) <= todayYmd; d = addDays(d, 1)) days.push(ymdOf(d));
  const users = people.map((u) => {
    const mine = entries.filter((e) => e.userId === u.id);
    const worked = new Set(mine.map((e) => e.day));
    const absences = days.filter((d) => {
      const shift = expectedOn(u, d, tz);
      if (!shift || worked.has(d)) return false;
      return d < todayYmd || nowMins >= hhmmToMin(shift.start) + settings.absentAfterMin;
    });
    const lates = mine.filter((e) => e.late);
    return {
      userId: u.id,
      name: u.name,
      days: worked.size,
      minutes: mine.reduce((s, e) => s + e.minutes, 0),
      hours: round2(mine.reduce((s, e) => s + e.minutes, 0) / 60),
      lateCount: lates.length,
      lateMinutes: lates.reduce((s, e) => s + (e.lateMin ?? 0), 0),
      absences: absences.length,
      absentDays: absences,
      incomplete: mine.filter((e) => e.incomplete).length,
    };
  });
  return { from: fromYmd, to: toYmd, timezone: tz, users, entries };
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { dateOnly, localDateTime, localHM, localYMD } from '../domain/dates';
import { guard } from '../lib/auth';
import { HttpError, notFound } from '../lib/http';
import { notifyAlerts } from '../services/alerts';
import { attendanceReport, clock, myStatus, todayBoard } from '../services/attendance';
import { publish } from '../services/notify';
import { storeCtx } from '../services/store';

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const HM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

function parseRange(q: unknown) {
  const r = z.object({ from: YMD, to: YMD, userId: z.string().min(1).optional() }).parse(q);
  if (r.from > r.to || (dateOnly(r.to).getTime() - dateOnly(r.from).getTime()) / 86_400_000 > 92) throw new HttpError(400, 'validation');
  return r;
}

/** Hora de entrada y salida de un día; si la salida es menor que la entrada, es del día siguiente. */
function times(tz: string, date: string, inTime?: string | null, outTime?: string | null) {
  const inAt = inTime ? localDateTime(tz, date, inTime) : null;
  let outAt = outTime ? localDateTime(tz, date, outTime) : null;
  if (inAt && outAt && outAt <= inAt) outAt = new Date(outAt.getTime() + 86_400_000);
  return { inAt, outAt };
}

const CSV = {
  es: {
    entries: ['Empleado', 'Fecha', 'Entrada', 'Salida', 'Horas', 'Tarde (min)', 'Origen', 'Nota'],
    summary: ['Empleado', 'Días trabajados', 'Horas', 'Llegadas tarde', 'Minutos tarde', 'Faltas', 'Fichajes incompletos'],
    sources: { pos: 'Caja', phone: 'Celular', manual: 'Dueño' } as Record<string, string>,
  },
  zh: {
    entries: ['员工', '日期', '上班', '下班', '小时', '迟到（分钟）', '来源', '备注'],
    summary: ['员工', '出勤天数', '小时', '迟到次数', '迟到分钟', '缺勤', '打卡不完整'],
    sources: { pos: '收银台', phone: '手机', manual: '老板' } as Record<string, string>,
  },
};
const cell = (v: unknown) => {
  const s = String(v ?? '');
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const hoursText = (min: number) => String(Math.round((min / 60) * 100) / 100).replace('.', ',');
const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

export async function attendanceRoutes(app: FastifyInstance) {
  /** Fichar desde el celular: vale la hora del servidor, no la del teléfono. */
  app.post('/attendance/clock', guard(), async (req) => {
    const b = z.object({ id: z.uuid(), action: z.enum(['in', 'out']) }).parse(req.body);
    const storeId = req.auth.sid;
    const r = await prisma.$transaction((tx) => clock(tx, { id: b.id, storeId, userId: req.auth.uid, action: b.action, at: new Date(), source: 'phone' }));
    if (!r) throw notFound();
    publish(storeId, 'attendance');
    await notifyAlerts(storeId, r.alerts.filter((a) => a.isNew).map((a) => a.alert));
    return myStatus(storeId, req.auth.uid);
  });

  app.get('/attendance/me', guard(), async (req) => myStatus(req.auth.sid, req.auth.uid));

  // ---------- Solo el dueño ----------

  app.get('/attendance/today', guard('owner'), async (req) => todayBoard(req.auth.sid));

  app.get('/attendance', guard('owner'), async (req) => {
    const q = parseRange(req.query);
    return attendanceReport(req.auth.sid, q.from, q.to, q.userId);
  });

  /** Planilla para Excel: cada fichaje y, abajo, el total por empleado. */
  app.get('/attendance.csv', guard('owner'), async (req, reply) => {
    const q = parseRange(req.query);
    const r = await attendanceReport(req.auth.sid, q.from, q.to, q.userId);
    const L = req.auth.lang === 'zh' ? CSV.zh : CSV.es;
    const hm = (d: Date | null) => (d ? localHM(r.timezone, d) : '');
    const lines = [
      L.entries.join(';'),
      ...r.entries.map((e) =>
        [e.name, dmy(e.day), hm(e.inAt), hm(e.outAt), e.inAt && e.outAt ? hoursText(e.minutes) : '', e.late ? e.lateMin : '', L.sources[e.inSource ?? e.outSource ?? ''] ?? '', e.note]
          .map(cell)
          .join(';'),
      ),
      '',
      L.summary.join(';'),
      ...r.users.map((u) => [u.name, u.days, hoursText(u.minutes), u.lateCount, u.lateMinutes, u.absences, u.incomplete].map(cell).join(';')),
    ];
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="horarios-${q.from}-${q.to}.csv"`);
    return '﻿' + lines.join('\r\n');
  });

  /** El dueño carga un fichaje que faltó. */
  app.post('/attendance', guard('owner'), async (req) => {
    const b = z
      .object({ userId: z.string().min(1), date: YMD, inTime: HM.nullish(), outTime: HM.nullish(), note: z.string().trim().max(200).nullish() })
      .refine((x) => x.inTime || x.outTime)
      .parse(req.body);
    const storeId = req.auth.sid;
    if (!(await prisma.user.findFirst({ where: { id: b.userId, storeId } }))) throw notFound();
    const { store } = await storeCtx(prisma, storeId);
    const { inAt, outAt } = times(store.timezone, b.date, b.inTime, b.outTime);
    const e = await prisma.attendance.create({
      data: { storeId, userId: b.userId, inAt, outAt, inSource: inAt ? 'manual' : null, outSource: outAt ? 'manual' : null, note: b.note || null, editedAt: new Date() },
    });
    publish(storeId, 'attendance');
    return e;
  });

  /** El dueño corrige un fichaje (por ejemplo, alguien se olvidó de fichar la salida). */
  app.patch('/attendance/:id', guard('owner'), async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ date: YMD.optional(), inTime: HM.nullish(), outTime: HM.nullish(), note: z.string().trim().max(200).nullish() }).parse(req.body);
    const storeId = req.auth.sid;
    const e = await prisma.attendance.findFirst({ where: { id, storeId } });
    if (!e) throw notFound();
    const tz = (await storeCtx(prisma, storeId)).store.timezone;
    const date = b.date ?? localYMD(tz, (e.inAt ?? e.outAt)!);
    const inTime = b.inTime === undefined ? e.inAt && localHM(tz, e.inAt) : b.inTime;
    const outTime = b.outTime === undefined ? e.outAt && localHM(tz, e.outAt) : b.outTime;
    if (!inTime && !outTime) throw new HttpError(400, 'validation');
    const { inAt, outAt } = times(tz, date, inTime, outTime);
    const same = (a: Date | null, c: Date | null) => (a?.getTime() ?? null) === (c?.getTime() ?? null);
    const updated = await prisma.attendance.update({
      where: { id },
      data: {
        inAt,
        outAt,
        inSource: !inAt ? null : same(inAt, e.inAt) ? e.inSource : 'manual',
        outSource: !outAt ? null : same(outAt, e.outAt) ? e.outSource : 'manual',
        note: b.note === undefined ? e.note : b.note || null,
        editedAt: new Date(),
      },
    });
    publish(storeId, 'attendance');
    return updated;
  });

  app.delete('/attendance/:id', guard('owner'), async (req) => {
    const { id } = req.params as { id: string };
    const res = await prisma.attendance.deleteMany({ where: { id, storeId: req.auth.sid } });
    if (res.count === 0) throw notFound();
    publish(req.auth.sid, 'attendance');
    return { ok: true };
  });
}

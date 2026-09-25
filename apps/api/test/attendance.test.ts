import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { localDateTime, localMinutes, localWeekday } from '../src/domain/dates';
import { absentCheck } from '../src/services/attendance';
import { type App, client, type Client, createEmployee, type Owner, registerOwner, resetDb } from './helpers';

const TZ = 'America/Argentina/Buenos_Aires';
/** De lunes a sábado de 8 a 16; domingo franco. */
const WEEK = [null, ...Array.from({ length: 6 }, () => ({ start: '08:00', end: '16:00' }))];
const WED = '2026-09-23';
const SUN = '2026-09-27';
const at = (ymd: string, hhmm: string) => localDateTime(TZ, ymd, hhmm);
const clockEv = (userId: string, action: 'in' | 'out', when: Date) => ({ id: randomUUID(), type: 'CLOCK', userId, action, occurredAt: when.toISOString() });

let app: App;
let owner: Owner;
let pos: Client;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb();
  owner = await registerOwner(app);
  pos = client(app, undefined, { 'x-device-token': (await owner.api.post('/pos/devices', { name: 'Caja' })).body.token });
});

/** Empleados con horario que "ya trabajaban" en las fechas de prueba. */
async function staff() {
  const martin = await createEmployee(app, owner, { username: 'martin', name: 'Martín', perms: ['stock'] });
  const sofia = await createEmployee(app, owner, { username: 'sofia', name: 'Sofía' });
  for (const e of [martin, sofia]) await owner.api.patch(`/users/${e.id}`, { schedule: WEEK });
  await prisma.user.updateMany({ data: { createdAt: new Date('2020-01-01') } });
  return { martin, sofia };
}

describe('hora local', () => {
  it('convierte la hora de Buenos Aires', () => {
    const d = at(WED, '08:30');
    expect(d.toISOString()).toBe('2026-09-23T11:30:00.000Z');
    expect(localMinutes(TZ, d)).toBe(510);
    expect(localWeekday(TZ, d)).toBe(3);
    expect(localWeekday(TZ, new Date('2026-09-28T02:00:00Z'))).toBe(0); // domingo 23 hs
  });
});

describe('ficha y horario', () => {
  it('solo el dueño la ve y la edita; el horario se valida', async () => {
    const emp = await createEmployee(app, owner);
    const r = await owner.api.patch(`/users/${emp.id}`, { dni: '30.123.456', phone: '11 5555-0000', hiredAt: '2025-03-01', salary: 900000, notes: 'Turno mañana', schedule: WEEK });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dni: '30.123.456', phone: '11 5555-0000', hiredAt: '2025-03-01', salary: 900000, schedule: WEEK });
    expect((await owner.api.get('/users')).body.find((u: { id: string }) => u.id === emp.id).salary).toBe(900000);
    const bad = [{ start: '10:00', end: '09:00' }, null, null, null, null, null, null];
    expect((await owner.api.patch(`/users/${emp.id}`, { schedule: bad })).status).toBe(400);

    const me = (await emp.api.get('/auth/me')).body.user;
    expect(me.salary).toBeUndefined();
    expect(me.dni).toBeUndefined();
    expect((await emp.api.get('/users')).status).toBe(403);
    expect((await emp.api.patch(`/users/${emp.id}`, { salary: 1 })).status).toBe(403);
  });
});

describe('fichaje', () => {
  it('desde el celular: entrada y salida con la hora del servidor, sin duplicar', async () => {
    const emp = await createEmployee(app, owner);
    const id = randomUUID();
    const a = await emp.api.post('/attendance/clock', { id, action: 'in' });
    expect(a.status).toBe(200);
    expect(a.body.working).toBe(true);
    await emp.api.post('/attendance/clock', { id, action: 'in' }); // reintento
    await emp.api.post('/attendance/clock', { id: randomUUID(), action: 'in' }); // ya estaba trabajando
    expect(await prisma.attendance.count()).toBe(1);

    expect((await emp.api.post('/attendance/clock', { id: randomUUID(), action: 'out' })).body.working).toBe(false);
    await emp.api.post('/attendance/clock', { id: randomUUID(), action: 'out' }); // doble toque
    expect(await prisma.attendance.count()).toBe(1);
    const me = (await emp.api.get('/attendance/me')).body;
    expect(me.today).toHaveLength(1);
    expect(me.today[0]).toMatchObject({ inSource: 'phone', outSource: 'phone' });
  });

  it('en la caja: avisa ausencias y llegadas tarde, y suma las horas para el sueldo', async () => {
    const { martin, sofia } = await staff();
    // Sofía llega a horario; a las 8:40 Martín todavía no vino.
    expect((await pos.post('/pos/sync', { events: [clockEv(sofia.id, 'in', at(WED, '07:55'))] })).body.results[0].status).toBe('ok');
    const first = await absentCheck(owner.storeId, at(WED, '08:40'));
    expect(first.map((a) => a.data.name)).toEqual(['Martín']);
    expect(await absentCheck(owner.storeId, at(WED, '08:50'))).toEqual([]);

    // Llega 47 minutos tarde: se avisa y la ausencia queda resuelta.
    await pos.post('/pos/sync', { events: [clockEv(martin.id, 'in', at(WED, '08:47'))] });
    const open = await prisma.alert.findMany({ where: { resolvedAt: null } });
    expect(open.map((a) => [a.type, (a.data as { minutes?: number }).minutes])).toEqual([['LATE', 47]]);
    expect(await absentCheck(owner.storeId, at(WED, '09:30'))).toEqual([]);

    await pos.post('/pos/sync', { events: [clockEv(martin.id, 'out', at(WED, '16:05')), clockEv(sofia.id, 'out', at(WED, '16:00'))] });
    const r = (await owner.api.get(`/attendance?from=${WED}&to=${WED}`)).body;
    const by = (name: string) => r.users.find((u: { name: string }) => u.name === name);
    expect(by('Martín')).toMatchObject({ days: 1, minutes: 438, lateCount: 1, lateMinutes: 47, absences: 0, incomplete: 0 });
    expect(by('Sofía')).toMatchObject({ days: 1, minutes: 485, lateCount: 0, absences: 0 });
    expect(r.entries.every((e: { inSource: string }) => e.inSource === 'pos')).toBe(true);

    // Planilla para Excel (el dueño usa la app en chino).
    const csv = await owner.api.get(`/attendance.csv?from=${WED}&to=${WED}`);
    expect(csv.status).toBe(200);
    expect(csv.res.headers['content-type']).toContain('text/csv');
    expect(csv.res.body.startsWith('﻿员工;')).toBe(true);
    expect(csv.res.body).toContain('Martín;23/09/2026;08:47;16:05;7,3;47');

    // Domingo es franco: no avisa.
    expect(await absentCheck(owner.storeId, at(SUN, '10:00'))).toEqual([]);
  });

  it('salida sin entrada: queda incompleta y el dueño la corrige', async () => {
    const { sofia } = await staff();
    await pos.post('/pos/sync', { events: [clockEv(sofia.id, 'out', at(WED, '16:00'))] });
    const r = (await owner.api.get(`/attendance?from=${WED}&to=${WED}`)).body;
    expect(r.users.find((u: { name: string }) => u.name === 'Sofía').incomplete).toBe(1);

    const entry = r.entries[0];
    expect((await sofia.api.patch(`/attendance/${entry.id}`, { inTime: '08:00' })).status).toBe(403);
    const fixed = await owner.api.patch(`/attendance/${entry.id}`, { inTime: '08:00', note: 'Se olvidó de fichar' });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({ inSource: 'manual', outSource: 'pos', note: 'Se olvidó de fichar' });
    expect(fixed.body.editedAt).toBeTruthy();
    const after = (await owner.api.get(`/attendance?from=${WED}&to=${WED}`)).body;
    expect(after.users.find((u: { name: string }) => u.name === 'Sofía')).toMatchObject({ minutes: 480, incomplete: 0 });

    // El dueño también puede cargar un día entero que faltó.
    expect((await owner.api.post('/attendance', { userId: sofia.id, date: '2026-09-22', inTime: '08:00', outTime: '16:00' })).status).toBe(200);
    expect((await sofia.api.get(`/attendance?from=${WED}&to=${WED}`)).status).toBe(403);
  });

  it('un empleado desactivado no puede fichar en la caja', async () => {
    const emp = await createEmployee(app, owner);
    await owner.api.patch(`/users/${emp.id}`, { active: false });
    const res = await pos.post('/pos/sync', { events: [clockEv(emp.id, 'in', new Date())] });
    expect(res.body.results[0]).toMatchObject({ status: 'rejected', error: 'user_inactive' });
  });
});

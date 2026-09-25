import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { localYMD } from '../src/domain/dates';
import { type App, client, type Client, createEmployee, type Owner, registerOwner, resetDb } from './helpers';

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
  const { token } = (await owner.api.post('/pos/devices', { name: 'Caja 1' })).body;
  pos = client(app, undefined, { 'x-device-token': token });
});

// Todo pasa en los últimos minutos (mismo día del local).
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const sale = (userId: string, minutesAgo: number, items: [string, number][], cashSessionId?: string) => {
  const total = items.reduce((s, [, qty]) => s + qty * 100, 0);
  return {
    id: randomUUID(),
    type: 'SALE',
    userId,
    occurredAt: at(minutesAgo),
    items: items.map(([productId, qty]) => ({ productId, qty, unitPrice: 100, listPrice: 100 })),
    payments: [{ method: 'CASH', amount: total }],
    total,
    cashSessionId,
  };
};

describe('qué se vendió por turno, día y empleado', () => {
  it('cada producto por turno (apertura → cierre de caja) y por empleado, sin contar anuladas', async () => {
    const sofia = await createEmployee(app, owner, { name: 'Sofía', perms: ['sell'] });
    const martin = await createEmployee(app, owner, { name: 'Martín', perms: ['sell'] });
    const alfajor = (await owner.api.post('/stock/quick', { barcode: '1', product: { name: 'Alfajor', price: 100 }, qty: 50 })).body.product.id;
    const coca = (await owner.api.post('/stock/quick', { barcode: '2', product: { name: 'Coca 500', price: 100 }, qty: 50 })).body.product.id;
    const [s1, s2] = [randomUUID(), randomUUID()];
    const voided = sale(martin.id, 5, [[coca, 4]], s2);
    const res = await pos.post('/pos/sync', {
      events: [
        { id: randomUUID(), type: 'CASH_OPEN', userId: sofia.id, occurredAt: at(60), cashSessionId: s1, openingAmount: 1000 },
        sale(sofia.id, 55, [[alfajor, 2], [coca, 1]], s1),
        sale(sofia.id, 50, [[alfajor, 1]], s1),
        { id: randomUUID(), type: 'CASH_CLOSE', userId: sofia.id, occurredAt: at(40), cashSessionId: s1, countedAmount: 1400 },
        { id: randomUUID(), type: 'CASH_OPEN', userId: martin.id, occurredAt: at(30), cashSessionId: s2, openingAmount: 1400 },
        sale(martin.id, 20, [[alfajor, 3]], s2),
        voided,
        { id: randomUUID(), type: 'SALE_VOIDED', userId: owner.ownerId, occurredAt: at(4), saleId: voided.id },
        sale(martin.id, 3, [[coca, 1]]),
      ],
    });
    expect(res.body.results.every((r: { status: string }) => r.status === 'ok')).toBe(true);

    // Desde hace 2 horas: así no falla si la prueba corre justo después de medianoche.
    const tz = 'America/Argentina/Buenos_Aires';
    const [from, to] = [localYMD(tz, new Date(Date.now() - 2 * 3_600_000)), localYMD(tz)];
    const r = (await owner.api.get(`/reports/units?from=${from}&to=${to}`)).body;
    expect(r.shifts.map((s: { id: string; user: string; total: number; tickets: number }) => [s.id, s.user, s.total, s.tickets])).toEqual([
      [s1, 'Sofía', 400, 2],
      [s2, 'Martín', 300, 1],
      ['-', null, 100, 1],
    ]);
    expect(r.shifts[0].closedAt).not.toBeNull();
    expect(r.shifts[1].closedAt).toBeNull();
    expect(r.days.reduce((s: number, d: { total: number }) => s + d.total, 0)).toBe(800);
    expect(r.employees).toEqual([
      { id: sofia.id, name: 'Sofía', total: 400, tickets: 2 },
      { id: martin.id, name: 'Martín', total: 400, tickets: 2 },
    ]);
    expect(r.products).toEqual([
      expect.objectContaining({ name: 'Alfajor', qty: 6, total: 600, byShift: { [s1]: 3, [s2]: 3 }, byUser: { [sofia.id]: 3, [martin.id]: 3 } }),
      expect.objectContaining({ name: 'Coca 500', qty: 2, total: 200, byShift: { [s1]: 1, '-': 1 }, byUser: { [sofia.id]: 1, [martin.id]: 1 } }),
    ]);

    // Solo un empleado.
    const onlyMartin = (await owner.api.get(`/reports/units?from=${from}&to=${to}&userId=${martin.id}`)).body;
    expect(onlyMartin.products.map((p: { name: string; qty: number }) => [p.name, p.qty])).toEqual([
      ['Alfajor', 3],
      ['Coca 500', 1],
    ]);
  });

  it('la semana trae los 7 días; rangos largos o al revés no', async () => {
    const r = (await owner.api.get('/reports/units?from=2026-09-21&to=2026-09-27')).body;
    expect(r.days.map((d: { date: string }) => d.date)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
    expect((await owner.api.get('/reports/units?from=2026-01-01&to=2026-06-30')).status).toBe(400);
    expect((await owner.api.get('/reports/units?from=2026-09-27&to=2026-09-21')).status).toBe(400);
  });

  it('el panel muestra los turnos de hoy y cuántos productos están bajos', async () => {
    await owner.api.post('/stock/quick', { barcode: '9', product: { name: 'Yerba', price: 100, minStock: 5 }, qty: 3 });
    const d = (await owner.api.get('/dashboard')).body;
    expect(d.shiftsToday).toEqual([]);
    expect(d.lowStock).toBe(1);
  });

  it('sin permiso de ver ventas no se puede', async () => {
    const emp = await createEmployee(app, owner, { perms: ['sell'] });
    expect((await emp.api.get('/reports/units?from=2026-09-21&to=2026-09-21')).status).toBe(403);
  });
});

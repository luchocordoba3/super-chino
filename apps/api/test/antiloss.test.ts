import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { pickCountProducts } from '../src/domain/antiloss';
import { reorderQty } from '../src/domain/reorder';
import { runDailyJobs } from '../src/services/jobs';
import { settleJobs } from '../src/services/messages';
import { type App, client, type Client, createEmployee, type Owner, registerOwner, resetDb } from './helpers';

describe('reglas', () => {
  it('reponer: dispara con stock en el mínimo o si no cubre la demora del proveedor', () => {
    expect(reorderQty({ stock: 3, minStock: 10, perDay: 2, leadTimeDays: 2 })).toBe(25);
    expect(reorderQty({ stock: 5, minStock: 0, perDay: 2, leadTimeDays: 2 })).toBe(13);
    expect(reorderQty({ stock: 50, minStock: 5, perDay: 2, leadTimeDays: 2 })).toBe(0);
  });
  it('conteo sorpresa: no repite lo contado hace poco y prefiere lo caro/vendido', () => {
    const c = (id: string, price: number, extra = {}) => ({ id, price, perDay: 1, hadDiff: false, countedRecently: false, ...extra });
    const picks = pickCountProducts([c('a', 10), c('b', 100000), c('c', 10, { countedRecently: true })], 1, () => 0.5);
    expect(picks).toEqual(['b']);
    expect(pickCountProducts([c('a', 1), c('c', 1, { countedRecently: true })], 5)).toEqual(['a']);
  });
});

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

async function product(name: string, qty: number, extra: Record<string, unknown> = {}) {
  const r = await owner.api.post('/stock/quick', { barcode: String(Math.random()).slice(2, 12), product: { name, price: 1000, ...extra }, qty, unitCost: 600 });
  return r.body.product.id as string;
}

describe('conteo sorpresa a ciegas', () => {
  it('el empleado no ve el stock del sistema; las diferencias se ajustan y avisan al dueño', async () => {
    const emp = await createEmployee(app, owner, { perms: ['sell', 'stock'] });
    const a = await product('Aceite', 10);
    const b = await product('Yerba', 5);
    const { id } = (await owner.api.post('/counts', { productIds: [a, b] })).body;
    await settleJobs();

    const view = (await emp.api.get(`/counts/${id}`)).body;
    expect(view.items.every((i: { expectedQty: unknown }) => i.expectedQty === null)).toBe(true);
    const task = (await emp.api.get('/messages')).body[0];
    expect(task.meta).toMatchObject({ type: 'COUNT', countId: id });

    const items = view.items.map((i: { id: string; productId: string }) => ({ id: i.id, countedQty: i.productId === a ? 7 : 5 }));
    expect((await emp.api.post(`/counts/${id}`, { items })).status).toBe(200);

    const result = (await emp.api.get(`/counts/${id}`)).body;
    const aceite = result.items.find((i: { productId: string }) => i.productId === a);
    expect(aceite).toMatchObject({ expectedQty: 10, countedQty: 7, difference: -3 });
    expect((await owner.api.get(`/products/${a}`)).body.stock).toBe(7);
    const alerts = (await owner.api.get('/alerts')).body;
    expect(alerts.map((x: { type: string }) => x.type)).toEqual(['COUNT_DIFF']);
    expect((await emp.api.get('/messages')).body[0].doneAt).not.toBeNull();
    expect((await emp.api.post(`/counts/${id}`, { items })).status).toBe(400);
  });

  it('la revisión diaria crea un solo conteo por día, desde las 9', async () => {
    await createEmployee(app, owner);
    await product('Aceite', 10);
    await product('Yerba', 5);
    const morning = new Date('2026-09-24T10:00:00-03:00');
    await runDailyJobs(owner.storeId, new Date('2026-09-24T07:00:00-03:00'));
    expect(await prisma.stockCount.count()).toBe(0);
    await runDailyJobs(owner.storeId, morning);
    await runDailyJobs(owner.storeId, morning);
    await settleJobs();
    expect(await prisma.stockCount.count()).toBe(1);
    expect((await prisma.stockCount.findFirstOrThrow({ include: { items: true } })).items).toHaveLength(2);
  });
});

describe('reposición y panel', () => {
  it('sugiere qué pedir por proveedor', async () => {
    const sup = (await owner.api.post('/suppliers', { name: 'Distribuidora Norte', phone: '5491100000001', leadTimeDays: 2 })).body;
    await product('Leche', 3, { minStock: 10, supplierId: sup.id });
    await product('Arroz', 50, { minStock: 5, supplierId: sup.id });
    const groups = (await owner.api.get('/reorder')).body;
    expect(groups).toHaveLength(1);
    expect(groups[0].supplier).toMatchObject({ name: 'Distribuidora Norte', phone: '5491100000001' });
    expect(groups[0].items).toEqual([expect.objectContaining({ name: 'Leche', stock: 3, qty: 7 })]);
  });

  it('panel del dueño: ventas de hoy, ganancia, medios de pago y cajeros', async () => {
    const emp = await createEmployee(app, owner, { name: 'Sofía', perms: ['sell'] });
    const id = await product('Aceite', 10);
    const ev = (method: string, qty: number) => ({
      id: randomUUID(),
      type: 'SALE',
      userId: emp.id,
      occurredAt: new Date().toISOString(),
      items: [{ productId: id, qty, unitPrice: 1000, listPrice: 1000 }],
      payments: [{ method, amount: qty * 1000 }],
      total: qty * 1000,
    });
    await pos.post('/pos/sync', { events: [ev('CASH', 2), ev('QR', 1)] });
    const d = (await owner.api.get('/dashboard')).body;
    expect(d.today).toMatchObject({ total: 3000, count: 2, avgTicket: 1500, profit: 1200, byMethod: { CASH: 2000, QR: 1000 } });
    expect(d.today.byCashier).toEqual([{ name: 'Sofía', total: 3000, count: 2 }]);
    expect(d.topProducts[0]).toMatchObject({ name: 'Aceite', qty: 3 });
    expect(d.week).toHaveLength(7);
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
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

const now = () => new Date().toISOString();
function sale(userId: string, items: { productId: string; qty: number; price: number; offerId?: string }[], extra: Record<string, unknown> = {}) {
  const total = items.reduce((s, i) => s + i.qty * i.price, 0);
  return {
    id: randomUUID(),
    type: 'SALE',
    userId,
    occurredAt: now(),
    items: items.map((i) => ({ productId: i.productId, qty: i.qty, unitPrice: i.price, listPrice: i.price, offerId: i.offerId ?? null })),
    payments: [{ method: 'CASH', amount: total }],
    total,
    ...extra,
  };
}
async function productWithLots(lots: { qty: number; expiresAt?: string; cost?: number }[], price = 1000, minStock = 0) {
  const p = (await owner.api.post('/products', { name: 'Yogur', price, barcode: String(Math.random()).slice(2, 12), minStock })).body;
  if (lots.length) {
    await owner.api.post('/stock/entries', { items: lots.map((l) => ({ productId: p.id, qty: l.qty, expiresAt: l.expiresAt ?? null, unitCost: l.cost ?? 500 })) });
  }
  return p.id as string;
}
const stockOf = async (id: string) => (await owner.api.get(`/products/${id}`)).body.stock as number;

describe('caja', () => {
  it('la PC vinculada baja catálogo y cajeros con PIN (para trabajar offline)', async () => {
    await productWithLots([{ qty: 3 }]);
    await createEmployee(app, owner, { name: 'Sofía', perms: ['sell'] });
    await createEmployee(app, owner, { name: 'Repositor', perms: ['stock'] });
    const res = await pos.get('/pos/bootstrap');
    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(1);
    expect(res.body.users.map((u: { name: string }) => u.name)).toEqual(['Sofía']);
    expect(res.body.users[0].pin).toMatch(/^pbkdf2\$/);
  });

  it('una venta descuenta primero el lote que vence antes y calcula la ganancia real', async () => {
    const id = await productWithLots([
      { qty: 5, expiresAt: '2031-01-01', cost: 600 },
      { qty: 2, expiresAt: '2030-06-01', cost: 400 },
    ]);
    const res = await pos.post('/pos/sync', { events: [sale(owner.ownerId, [{ productId: id, qty: 3, price: 1000 }])] });
    expect(res.body.results[0].status).toBe('ok');
    const lots = await prisma.lot.findMany({ where: { productId: id }, orderBy: { expiresAt: 'asc' } });
    expect(lots.map((l) => Number(l.qtyRemaining))).toEqual([0, 4]);
    const s = await prisma.sale.findFirstOrThrow();
    expect(Number(s.costTotal)).toBe(2 * 400 + 600);
    expect(Number(s.total)).toBe(3000);
  });

  it('mandar la misma venta dos veces no descuenta dos veces', async () => {
    const id = await productWithLots([{ qty: 10 }]);
    const ev = sale(owner.ownerId, [{ productId: id, qty: 2, price: 1000 }]);
    await pos.post('/pos/sync', { events: [ev] });
    const again = await pos.post('/pos/sync', { events: [ev] });
    expect(again.body.results[0].status).toBe('duplicate');
    expect(await stockOf(id)).toBe(8);
    expect(await prisma.sale.count()).toBe(1);
  });

  it('venta sin stock cargado: se registra igual, avisa y el próximo ingreso lo compensa', async () => {
    const id = await productWithLots([]);
    await pos.post('/pos/sync', { events: [sale(owner.ownerId, [{ productId: id, qty: 2, price: 1000 }])] });
    expect(await stockOf(id)).toBe(-2);
    const alert = await prisma.alert.findFirstOrThrow({ where: { type: 'NEGATIVE_STOCK' } });
    expect(alert.resolvedAt).toBeNull();
    await owner.api.post('/stock/entries', { items: [{ productId: id, qty: 10 }] });
    expect(await stockOf(id)).toBe(8);
    expect((await prisma.alert.findFirstOrThrow({ where: { type: 'NEGATIVE_STOCK' } })).resolvedAt).not.toBeNull();
  });

  it('anular una venta devuelve el stock a los mismos lotes', async () => {
    const id = await productWithLots([{ qty: 4, expiresAt: '2030-01-01' }]);
    const ev = sale(owner.ownerId, [{ productId: id, qty: 3, price: 1000 }]);
    await pos.post('/pos/sync', { events: [ev, { id: randomUUID(), type: 'SALE_VOIDED', userId: owner.ownerId, occurredAt: now(), saleId: ev.id, reason: 'error' }] });
    expect(await stockOf(id)).toBe(4);
    expect((await prisma.sale.findFirstOrThrow()).status).toBe('VOIDED');
  });

  it('cierre de caja: esperado = inicial + efectivo; avisa diferencias y muchas anulaciones', async () => {
    const id = await productWithLots([{ qty: 50 }]);
    const emp = await createEmployee(app, owner, { perms: ['sell'] });
    const sessionId = randomUUID();
    const events: Record<string, unknown>[] = [{ id: randomUUID(), type: 'CASH_OPEN', userId: emp.id, occurredAt: now(), cashSessionId: sessionId, openingAmount: 5000 }];
    events.push(sale(emp.id, [{ productId: id, qty: 2, price: 1000 }], { cashSessionId: sessionId }));
    events.push({ ...sale(emp.id, [{ productId: id, qty: 1, price: 1500 }], { cashSessionId: sessionId }), payments: [{ method: 'DEBIT', amount: 1500 }] });
    for (let i = 0; i < 5; i++) {
      events.push({ id: randomUUID(), type: 'ITEM_REMOVED', userId: emp.id, occurredAt: now(), cashSessionId: sessionId, productId: id, qty: 1, amount: 1000 });
    }
    events.push({ id: randomUUID(), type: 'CASH_CLOSE', userId: emp.id, occurredAt: now(), cashSessionId: sessionId, countedAmount: 6000 });
    const res = await pos.post('/pos/sync', { events });
    expect(res.body.results.every((r: { status: string }) => r.status === 'ok')).toBe(true);

    const s = await prisma.cashSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(Number(s.expectedAmount)).toBe(7000);
    expect(Number(s.difference)).toBe(-1000);
    const types = (await prisma.alert.findMany()).map((a) => a.type).sort();
    expect(types).toEqual(['CASH_DIFF', 'VOID_SPIKE']);
  });

  it('eventos inválidos o de otro local se rechazan sin frenar al resto', async () => {
    const id = await productWithLots([{ qty: 5 }]);
    const other = await registerOwner(app);
    const res = await pos.post('/pos/sync', {
      events: [{ id: 'x', type: 'SALE' }, sale(other.ownerId, [{ productId: id, qty: 1, price: 1 }]), sale(owner.ownerId, [{ productId: id, qty: 1, price: 1000 }])],
    });
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(['rejected', 'rejected', 'ok']);
  });

  it('una caja desvinculada ya no puede sincronizar', async () => {
    const devices = (await owner.api.get('/pos/devices')).body;
    await owner.api.del(`/pos/devices/${devices[0].id}`);
    expect((await pos.get('/pos/bootstrap')).status).toBe(401);
  });

  it('el catálogo incremental trae solo lo que cambió (ej. un cambio de precio)', async () => {
    const id = await productWithLots([{ qty: 1 }]);
    await productWithLots([{ qty: 1 }]);
    const first = (await pos.get('/pos/bootstrap')).body;
    await new Promise((r) => setTimeout(r, 5));
    await owner.api.patch(`/products/${id}`, { price: 1234 });
    const next = (await pos.get(`/pos/bootstrap?since=${first.serverTime}`)).body;
    expect(next.products).toEqual([expect.objectContaining({ id, price: 1234 })]);
  });

  it('las ventas del día se ven en el reporte con el nombre del cajero', async () => {
    const id = await productWithLots([{ qty: 5 }]);
    await pos.post('/pos/sync', { events: [sale(owner.ownerId, [{ productId: id, qty: 1, price: 1000 }])] });
    const list = (await owner.api.get('/sales')).body;
    expect(list).toEqual([expect.objectContaining({ total: 1000, user: 'Li Wei', items: 1 })]);
  });
});

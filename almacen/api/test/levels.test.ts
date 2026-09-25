import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { type App, client, type Client, type Owner, registerOwner, resetDb } from './helpers';

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

const sell = (productId: string, qty: number) =>
  pos.post('/pos/sync', {
    events: [
      {
        id: randomUUID(),
        type: 'SALE',
        userId: owner.ownerId,
        occurredAt: new Date().toISOString(),
        items: [{ productId, qty, unitPrice: 100, listPrice: 100 }],
        payments: [{ method: 'CASH', amount: qty * 100 }],
        total: qty * 100,
      },
    ],
  });
const level = async (id: string) => ((await owner.api.get('/stock/levels')).body as { productId: string }[]).find((r) => r.productId === id) as Record<string, unknown>;

describe('stock en %', () => {
  it('el 100% es lo que quedó después de reponer; al bajar del 25% se pone en rojo y avisa', async () => {
    const p = (await owner.api.post('/stock/quick', { barcode: '779123', product: { name: 'Alfajor', price: 100 }, qty: 40 })).body.product;
    expect(await level(p.id)).toMatchObject({ stock: 40, refStock: 40, idealStock: null, pct: 100, level: 'ok' });

    await sell(p.id, 20);
    expect(await level(p.id)).toMatchObject({ stock: 20, pct: 50, level: 'mid' });
    expect(await prisma.alert.count({ where: { type: 'LOW_STOCK' } })).toBe(0);

    await sell(p.id, 10);
    const low = await level(p.id);
    expect(low).toMatchObject({ stock: 10, pct: 25, level: 'low' });
    // Vendió 30 hoy: con la base mínima de 7 días son ~4,3 por día, alcanza para 2 días.
    expect(low.daysLeft).toBe(2);
    const alert = await prisma.alert.findFirstOrThrow({ where: { type: 'LOW_STOCK' } });
    expect(alert.data).toMatchObject({ name: 'Alfajor', stock: 10, pct: 25 });

    // Reponer: el nuevo 100% es lo que quedó (10 + 30) y el aviso se cierra solo.
    await owner.api.post('/stock/quick', { barcode: '779123', qty: 30 });
    expect(await level(p.id)).toMatchObject({ stock: 40, refStock: 40, pct: 100, level: 'ok' });
    expect((await prisma.alert.findFirstOrThrow({ where: { type: 'LOW_STOCK' } })).resolvedAt).not.toBeNull();
  });

  it('el stock ideal que carga el dueño manda sobre el automático', async () => {
    const p = (await owner.api.post('/stock/quick', { barcode: '779124', product: { name: 'Gaseosa', price: 100 }, qty: 30 })).body.product;
    const res = await owner.api.patch(`/products/${p.id}`, { idealStock: 120 });
    expect(res.body).toMatchObject({ idealStock: 120, refStock: 30 });
    expect(await level(p.id)).toMatchObject({ pct: 25, ref: 120, level: 'low' });
    // Vacío = vuelve al automático.
    await owner.api.patch(`/products/${p.id}`, { idealStock: null });
    expect(await level(p.id)).toMatchObject({ pct: 100, ref: 30, level: 'ok' });
  });

  it('lo más bajo primero; sin ingresos no hay % y sin stock está en rojo', async () => {
    const full = (await owner.api.post('/stock/quick', { barcode: '1', product: { name: 'Lleno', price: 100 }, qty: 10 })).body.product;
    const empty = (await owner.api.post('/products', { name: 'Sin cargar', price: 100 })).body;
    const rows = (await owner.api.get('/stock/levels')).body;
    expect(rows.map((r: { productId: string }) => r.productId)).toEqual([empty.id, full.id]);
    expect(rows[0]).toMatchObject({ pct: null, level: 'low', stock: 0 });
  });

  it('el empleado que solo vende no ve el stock en %', async () => {
    const created = await owner.api.post('/users', { name: 'Martín', username: 'martin', pin: '5678', perms: ['sell'] });
    expect(created.status).toBe(200);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { storeCode: owner.storeCode, username: 'martin', pin: '5678' } });
    const emp = client(app, login.cookies.map((c) => `${c.name}=${c.value}`).join('; '));
    expect((await emp.get('/stock/levels')).status).toBe(403);
  });
});

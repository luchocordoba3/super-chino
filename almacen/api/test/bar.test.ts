import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { avgDailySales } from '../src/services/stats';
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

const at = () => new Date().toISOString();
const ev = (type: string, userId: string, extra: Record<string, unknown>) => ({ id: randomUUID(), type, userId, occurredAt: at(), ...extra });
const sale = (userId: string, items: { productId: string; qty: number; price: number }[], extra: Record<string, unknown> = {}) => {
  const total = items.reduce((s, i) => s + i.qty * i.price, 0);
  return ev('SALE', userId, {
    items: items.map((i) => ({ productId: i.productId, qty: i.qty, unitPrice: i.price, listPrice: i.price })),
    payments: [{ method: 'CASH', amount: total }],
    total,
    ...extra,
  });
};
const stock = async (id: string) => (await owner.api.get(`/products/${id}`)).body.stock as number;

async function tostado() {
  const entry = (name: string, qty: number, unitCost: number, unit = 'UNIT') =>
    owner.api.post('/stock/quick', { barcode: String(Math.random()).slice(2, 12), product: { name, price: 1, unit }, qty, unitCost }).then((r) => r.body.product.id as string);
  const pan = await entry('Pan de molde (20 rodajas)', 5, 2000);
  const jamon = await entry('Jamón cocido', 2, 10000, 'KG');
  const queso = await entry('Queso cremoso', 2, 7000, 'KG');
  const t = (await owner.api.post('/products', { name: 'Tostado jamón y queso', price: 4500 })).body.id as string;
  const r = await owner.api.put(`/products/${t}/recipe`, {
    items: [
      { ingredientId: pan, qty: 0.1 },
      { ingredientId: jamon, qty: 0.04 },
      { ingredientId: queso, qty: 0.04 },
    ],
  });
  expect(r.status).toBe(200);
  return { pan, jamon, queso, t };
}

describe('recetas', () => {
  it('al vender se descuentan los ingredientes, el costo es la suma y anular los devuelve', async () => {
    const { pan, jamon, queso, t } = await tostado();
    const detail = (await owner.api.get(`/products/${t}`)).body;
    expect(detail.hasRecipe).toBe(true);
    expect(detail.recipe.map((r: { name: string; qty: number; cost: number }) => [r.name, r.qty, r.cost])).toEqual([
      ['Jamón cocido', 0.04, 400],
      ['Pan de molde (20 rodajas)', 0.1, 200],
      ['Queso cremoso', 0.04, 280],
    ]);

    const s = sale(owner.ownerId, [{ productId: t, qty: 2, price: 4500 }]);
    expect((await pos.post('/pos/sync', { events: [s] })).body.results[0].status).toBe('ok');
    expect([await stock(pan), await stock(jamon), await stock(queso)]).toEqual([4.8, 1.92, 1.92]);
    expect(await stock(t)).toBe(0);
    // El tostado no tiene stock propio: no queda "vendido sin stock".
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: t } })).unallocatedSold)).toBe(0);
    const saved = await prisma.sale.findUniqueOrThrow({ where: { id: s.id } });
    expect(Number(saved.costTotal)).toBe(1760); // 2 × (200 + 400 + 280)

    // El promedio de venta del pan cuenta lo que se usó en tostados.
    expect((await avgDailySales(prisma, owner.storeId)).get(pan)).toBeCloseTo(0.2 / 7);

    await pos.post('/pos/sync', { events: [ev('SALE_VOIDED', owner.ownerId, { saleId: s.id })] });
    expect([await stock(pan), await stock(jamon), await stock(queso)]).toEqual([5, 2, 2]);
  });

  it('no se puede usar un producto con receta como ingrediente ni ponerse a sí mismo', async () => {
    const { t, pan } = await tostado();
    const combo = (await owner.api.post('/products', { name: 'Combo', price: 6000 })).body.id;
    expect((await owner.api.put(`/products/${combo}/recipe`, { items: [{ ingredientId: t, qty: 1 }] })).body.error).toBe('nested_recipe');
    expect((await owner.api.put(`/products/${combo}/recipe`, { items: [{ ingredientId: combo, qty: 1 }] })).body.error).toBe('bad_recipe');
    expect((await owner.api.put(`/products/${pan}/recipe`, { items: [{ ingredientId: combo, qty: 1 }] })).body.error).toBe('used_as_ingredient');
  });

  it('los productos con receta no aparecen en stock %, reponer ni conteos', async () => {
    const { t } = await tostado();
    await pos.post('/pos/sync', { events: [sale(owner.ownerId, [{ productId: t, qty: 3, price: 4500 }])] });
    const levels = (await owner.api.get('/stock/levels')).body.map((r: { productId: string }) => r.productId);
    expect(levels).not.toContain(t);
    const reorder = (await owner.api.get('/reorder')).body.flatMap((g: { items: { productId: string }[] }) => g.items.map((i) => i.productId));
    expect(reorder).not.toContain(t);
  });
});

describe('cuentas abiertas por mesa', () => {
  it('se anota sin internet, se corrige, se cobra con una venta y queda cerrada', async () => {
    const sofia = await createEmployee(app, owner, { name: 'Sofía', perms: ['sell'] });
    const cerveza = (await owner.api.post('/stock/quick', { barcode: '1', product: { name: 'Cerveza', price: 1800 }, qty: 24 })).body.product.id;
    const papas = (await owner.api.post('/stock/quick', { barcode: '2', product: { name: 'Papas', price: 2800 }, qty: 10 })).body.product.id;
    const tabId = randomUUID();
    const res = await pos.post('/pos/sync', {
      events: [
        ev('TAB_OPEN', sofia.id, { tabId, label: 'Mesa 3', table: 3 }),
        ev('TAB_ITEM', sofia.id, { tabId, productId: cerveza, qty: 1, unitPrice: 1800 }),
        ev('TAB_ITEM', sofia.id, { tabId, productId: papas, qty: 1, unitPrice: 2800 }),
        ev('TAB_ITEM', sofia.id, { tabId, productId: cerveza, qty: 3, unitPrice: 1800 }),
        ev('TAB_ITEM', sofia.id, { tabId, productId: papas, qty: 0, unitPrice: 2800 }),
      ],
    });
    expect(res.body.results.every((r: { status: string }) => r.status === 'ok')).toBe(true);
    // Anotar no descuenta stock: se descuenta al cobrar.
    expect(await stock(cerveza)).toBe(24);

    const tabs = (await pos.get('/pos/tabs')).body;
    expect(tabs).toEqual([expect.objectContaining({ id: tabId, label: 'Mesa 3', table: 3, total: 5400, pending: [], items: [expect.objectContaining({ name: 'Cerveza', qty: 3, unitPrice: 1800 })] })]);
    expect((await owner.api.get('/dashboard')).body.openTabs).toEqual({ count: 1, total: 5400 });

    const s = sale(sofia.id, [{ productId: cerveza, qty: 3, price: 1800 }], { tabId });
    await pos.post('/pos/sync', { events: [s] });
    expect(await prisma.tab.findUniqueOrThrow({ where: { id: tabId } })).toMatchObject({ status: 'PAID', saleId: s.id });
    expect((await pos.get('/pos/tabs')).body).toEqual([]);
    expect(await stock(cerveza)).toBe(21);

    // Una cuenta cerrada ya no se toca.
    const late = await pos.post('/pos/sync', { events: [ev('TAB_ITEM', sofia.id, { tabId, productId: papas, qty: 1, unitPrice: 2800 })] });
    expect(late.body.results[0]).toMatchObject({ status: 'rejected', error: 'tab_closed' });
  });

  it('una mesa que se va sin consumir se cancela', async () => {
    const tabId = randomUUID();
    await pos.post('/pos/sync', { events: [ev('TAB_OPEN', owner.ownerId, { tabId, label: 'Barra - Juan' }), ev('TAB_CANCEL', owner.ownerId, { tabId })] });
    expect(await prisma.tab.findUniqueOrThrow({ where: { id: tabId } })).toMatchObject({ status: 'CANCELLED', table: null });
  });
});

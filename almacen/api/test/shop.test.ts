import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { type App, client, type Client, createEmployee, type Owner, registerOwner, resetDb } from './helpers';

let app: App;
let owner: Owner;
let pos: Client;
const guest = () => client(app);
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

async function openShop() {
  const settings = (await owner.api.get('/auth/me')).body.store.settings;
  await owner.api.patch('/store', { settings: { ...settings, shopWhatsapp: '+54 9 341 555-1234', shopNote: 'Envíos en el barrio' } });
  const { path } = (await owner.api.post('/shop')).body;
  return (path as string).replace('/p/', '');
}
async function catalog() {
  const yerba = (await owner.api.post('/stock/quick', { barcode: '1', product: { name: 'Yerba 1kg', price: 4500 }, qty: 10 })).body.product.id as string;
  const queso = (await owner.api.post('/stock/quick', { barcode: '2', product: { name: 'Queso cremoso', price: 9800, unit: 'KG' }, qty: 3 })).body.product.id as string;
  const agotado = (await owner.api.post('/products', { name: 'Fideos', price: 1100 })).body.id as string;
  return { yerba, queso, agotado };
}
const order = (items: { productId: string; qty: number }[], extra: Record<string, unknown> = {}) => ({
  name: 'Ana',
  phone: '341 555-0000',
  delivery: true,
  address: 'Mitre 123',
  payment: 'CASH',
  items,
  ...extra,
});

describe('pedidos por WhatsApp', () => {
  it('el link muestra el catálogo con precios y stock reales; apagado o renovado no anda', async () => {
    const { yerba, queso, agotado } = await catalog();
    expect((await guest().get('/public/shop/cualquiera')).status).toBe(404);
    const slug = await openShop();
    const shop = (await guest().get(`/public/shop/${slug}`)).body;
    expect(shop).toMatchObject({ whatsapp: '5493415551234', delivery: true, note: 'Envíos en el barrio' });
    expect(shop.products.map((p: { id: string; available: boolean }) => [p.id, p.available])).toEqual([
      [agotado, false],
      [queso, true],
      [yerba, true],
    ]);
    const renewed = (await owner.api.post('/shop', { renew: true })).body.path.replace('/p/', '');
    expect((await guest().get(`/public/shop/${slug}`)).status).toBe(404);
    await owner.api.del('/shop');
    expect((await guest().get(`/public/shop/${renewed}`)).status).toBe(404);
  });

  it('el pedido queda numerado con el total y valida los datos', async () => {
    const { yerba, queso } = await catalog();
    const slug = await openShop();
    const r1 = await guest().post(`/public/shop/${slug}/orders`, order([{ productId: yerba, qty: 2 }, { productId: queso, qty: 0.5 }]));
    expect(r1.body).toMatchObject({ number: 1, total: 13900 });
    const r2 = await guest().post(`/public/shop/${slug}/orders`, order([{ productId: yerba, qty: 1.7 }], { delivery: false, address: 'se ignora', payment: 'QR' }));
    expect(r2.body).toMatchObject({ number: 2, total: 9000 }); // por unidad: 2
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: r2.body.id }, include: { items: true } });
    expect(saved).toMatchObject({ phone: '3415550000', delivery: false, address: null, payment: 'QR', status: 'NEW' });

    expect((await guest().post(`/public/shop/${slug}/orders`, order([{ productId: yerba, qty: 1 }], { address: undefined }))).body.error).toBe('address_required');
    expect((await guest().post(`/public/shop/${slug}/orders`, order([{ productId: 'otro', qty: 1 }]))).status).toBe(404);
    const settings = (await owner.api.get('/auth/me')).body.store.settings;
    await owner.api.patch('/store', { settings: { ...settings, shopDelivery: false } });
    expect((await guest().post(`/public/shop/${slug}/orders`, order([{ productId: yerba, qty: 1 }]))).body.error).toBe('no_delivery');
  });

  it('el equipo lo prepara y avisa; cobrarlo en la caja lo marca entregado', async () => {
    const { yerba } = await catalog();
    const slug = await openShop();
    const { id } = (await guest().post(`/public/shop/${slug}/orders`, order([{ productId: yerba, qty: 2 }]))).body;
    const emp = await createEmployee(app, owner, { perms: ['sell'] });
    const list = (await emp.api.get('/orders')).body;
    expect(list[0]).toMatchObject({ id, number: 1, name: 'Ana', status: 'NEW', total: 9000, items: [{ name: 'Yerba 1kg', qty: 2, unitPrice: 4500 }] });
    await emp.api.post(`/orders/${id}/status`, { status: 'PREPARING' });
    await pos.post(`/pos/orders/${id}/status`, { status: 'READY' });
    expect((await pos.get('/pos/orders')).body[0].status).toBe('READY');

    const saleId = randomUUID();
    await pos.post('/pos/sync', {
      events: [
        {
          id: saleId,
          type: 'SALE',
          userId: emp.id,
          occurredAt: new Date().toISOString(),
          items: [{ productId: yerba, qty: 2, unitPrice: 4500, listPrice: 4500 }],
          payments: [{ method: 'CASH', amount: 9000 }],
          total: 9000,
          orderId: id,
        },
      ],
    });
    expect(await prisma.order.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'DELIVERED', saleId });
    expect((await emp.api.post(`/orders/${id}/status`, { status: 'CANCELLED' })).status).toBe(404);
  });
});

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { addDays, dateOnly, localYMD } from '../src/domain/dates';
import { suggestOffer } from '../src/domain/offers';
import { settleJobs } from '../src/services/messages';
import { type App, client, type Client, createEmployee, type Owner, registerOwner, resetDb } from './helpers';

const base = { price: 1000, unitCost: 500, tiers: [{ days: 7, pct: 20 }, { days: 3, pct: 35 }, { days: 1, pct: 50 }], allowBelowCostDays: 1, rounding: 10 };

describe('regla de ofertas por vencimiento', () => {
  it('si se vende a tiempo no hay oferta', () => {
    expect(suggestOffer({ ...base, daysToExpiry: 5, qtyAhead: 10, perDay: 3 })).toBeNull();
  });
  it('si no llega a venderse aplica el escalón según los días que faltan', () => {
    expect(suggestOffer({ ...base, daysToExpiry: 6, qtyAhead: 30, perDay: 2 })).toMatchObject({ discountPct: 20, offerPrice: 800, daysToSell: 15 });
    expect(suggestOffer({ ...base, daysToExpiry: 2, qtyAhead: 30, perDay: 2 })).toMatchObject({ discountPct: 35, offerPrice: 650 });
  });
  it('no vende bajo costo salvo en los últimos días', () => {
    const cheap = { ...base, unitCost: 700 };
    expect(suggestOffer({ ...cheap, daysToExpiry: 2, qtyAhead: 30, perDay: 1 })).toMatchObject({ offerPrice: 700 });
    expect(suggestOffer({ ...cheap, daysToExpiry: 1, qtyAhead: 30, perDay: 1 })).toMatchObject({ offerPrice: 500, discountPct: 50 });
  });
  it('sin ventas registradas también sugiere, y lejos del vencimiento no', () => {
    expect(suggestOffer({ ...base, daysToExpiry: 3, qtyAhead: 5, perDay: 0 })?.discountPct).toBe(35);
    expect(suggestOffer({ ...base, daysToExpiry: 20, qtyAhead: 500, perDay: 0 })).toBeNull();
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

// Fechas en la zona horaria del local (Buenos Aires), no la de la máquina.
const day = (n: number) => addDays(dateOnly(localYMD('America/Argentina/Buenos_Aires')), n).toISOString().slice(0, 10);
function saleEv(productId: string, qty: number, price: number, extra: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    type: 'SALE',
    userId: owner.ownerId,
    occurredAt: new Date().toISOString(),
    items: [{ productId, qty, unitPrice: price, listPrice: 1000, ...extra }],
    payments: [{ method: 'CASH', amount: qty * price }],
    total: qty * price,
  };
}

describe('revisión diaria', () => {
  it('lote que no se va a vender a tiempo => oferta sugerida; aprobada llega a la caja y se vende', async () => {
    const r = await owner.api.post('/stock/quick', { barcode: '1', product: { name: 'Yogur', price: 1000 }, qty: 20, unitCost: 500, expiresAt: day(2) });
    const id = r.body.product.id;
    await pos.post('/pos/sync', { events: [saleEv(id, 1, 1000)] }); // 1 por semana => no llega

    expect((await owner.api.post('/jobs/run')).body.offers).toBe(1);
    const [offer] = (await owner.api.get('/offers')).body;
    expect(offer).toMatchObject({ status: 'SUGGESTED', offerPrice: 650, discountPct: 35, remaining: 19 });
    expect((await owner.api.get('/alerts')).body.map((a: { type: string }) => a.type)).toContain('OFFER_SUGGESTED');

    await owner.api.post(`/offers/${offer.id}/approve`);
    const boot = (await pos.get('/pos/bootstrap')).body;
    expect(boot.offers).toEqual([expect.objectContaining({ productId: id, offerPrice: 650, maxQty: 19 })]);

    await pos.post('/pos/sync', { events: [saleEv(id, 19, 650, { offerId: offer.id })] });
    const [ended] = (await owner.api.get('/offers?status=ENDED')).body;
    expect(ended).toMatchObject({ soldQty: 19, soldAmount: 12350 });
    expect((await owner.api.get('/offers/summary')).body.savedThisMonth).toBe(12350);
  });

  it('con aprobación automática la oferta queda activa directamente', async () => {
    await owner.api.patch('/store', { settings: { offerAutoApprove: true } });
    await owner.api.post('/stock/quick', { barcode: '1', product: { name: 'Leche', price: 1000 }, qty: 30, expiresAt: day(3) });
    await owner.api.post('/jobs/run');
    expect((await owner.api.get('/offers')).body[0].status).toBe('ACTIVE');
  });

  it('lote vencido => aviso + tarea "retirar vencidos"; al hacerla se registra la merma', async () => {
    const emp = await createEmployee(app, owner, { perms: ['sell', 'stock'] });
    const r = await owner.api.post('/stock/quick', { barcode: '1', product: { name: 'Queso', price: 1000 }, qty: 4, expiresAt: day(-1) });
    await owner.api.post('/stock/quick', { barcode: '2', product: { name: 'Crema', price: 1000 }, qty: 4, expiresAt: day(2) });
    await owner.api.post('/jobs/run');
    await settleJobs();

    const alerts = (await owner.api.get('/alerts')).body.map((a: { type: string }) => a.type).sort();
    expect(alerts).toEqual(['EXPIRED', 'EXPIRING', 'OFFER_SUGGESTED']);

    const [task] = (await emp.api.get('/messages')).body;
    expect(task).toMatchObject({ kind: 'TASK', from: null, meta: { type: 'REMOVE_EXPIRED' } });
    await emp.api.post(`/messages/${task.id}/done`, {});
    expect((await owner.api.get(`/products/${r.body.product.id}`)).body.stock).toBe(0);
    const waste = await prisma.stockMovement.findFirstOrThrow({ where: { type: 'WASTE' } });
    expect(Number(waste.qty)).toBe(-4);
    expect((await owner.api.get('/alerts')).body.map((a: { type: string }) => a.type)).not.toContain('EXPIRED');
  });

  it('correr la revisión dos veces no duplica avisos, ofertas ni tareas', async () => {
    await createEmployee(app, owner);
    await owner.api.post('/stock/quick', { barcode: '1', product: { name: 'Queso', price: 1000 }, qty: 4, expiresAt: day(-1) });
    await owner.api.post('/stock/quick', { barcode: '2', product: { name: 'Crema', price: 1000 }, qty: 40, expiresAt: day(2) });
    await owner.api.post('/jobs/run');
    await owner.api.post('/jobs/run');
    await settleJobs();
    expect(await prisma.alert.count()).toBe(3);
    expect(await prisma.offer.count()).toBe(1);
    expect(await prisma.message.count()).toBe(1);
  });

  it('una oferta descartada no se vuelve a sugerir', async () => {
    await owner.api.post('/stock/quick', { barcode: '1', product: { name: 'Crema', price: 1000 }, qty: 40, expiresAt: day(2) });
    await owner.api.post('/jobs/run');
    const [offer] = (await owner.api.get('/offers')).body;
    await owner.api.post(`/offers/${offer.id}/dismiss`);
    await owner.api.post('/jobs/run');
    expect((await owner.api.get('/offers')).body).toHaveLength(0);
  });
});

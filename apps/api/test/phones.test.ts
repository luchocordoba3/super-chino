import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { refreshRates } from '../src/services/fx';
import { runDailyJobs } from '../src/services/jobs';
import { type App, client, type Client, createEmployee, multipart, type Owner, registerOwner, resetDb, tinyPng } from './helpers';

let app: App;
let owner: Owner;
let pos: Client;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb();
  owner = await registerOwner(app, { storeName: 'Celus Test', businessType: 'PHONES', lang: 'es' });
  await owner.api.patch('/store', { settings: { fxSource: 'manual', fxManual: 1000 } });
  const { token } = (await owner.api.post('/pos/devices', { name: 'Caja 1' })).body;
  pos = client(app, undefined, { 'x-device-token': token });
});

/** IMEI válido (dígito verificador Luhn) a partir de 14 dígitos. */
let seq = 0;
function imei() {
  const base = `35${String(1234567890 + ++seq * 7919).padStart(12, '0')}`.slice(0, 14);
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(base[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return base + ((10 - (sum % 10)) % 10);
}
const now = () => new Date().toISOString();

async function phoneModel(name = 'iPhone 13 128GB', price = 600) {
  return (await owner.api.post('/products', { name, price, currency: 'USD', serialized: true })).body as { id: string };
}
async function receive(productId: string, items: Record<string, unknown>[]) {
  const r = await owner.api.post('/serials', { productId, items });
  expect(r.status).toBe(200);
  return r.body.ids as string[];
}
const serial = async (id: string) => (await owner.api.get(`/serials/${id}`)).body;
const sync = async (events: unknown[]) => (await pos.post('/pos/sync', { events })).body.results as { status: string; error?: string }[];
async function openCash(opening = 10000, openingUsd = 100) {
  const cashSessionId = randomUUID();
  await sync([{ id: randomUUID(), type: 'CASH_OPEN', userId: owner.ownerId, occurredAt: now(), cashSessionId, openingAmount: opening, openingUsd }]);
  return cashSessionId;
}

describe('dólar', () => {
  it('si dolarapi falla usa bluelytics, y la cotización del local suma el ajuste', async () => {
    const fake = (async (url: string) => {
      if (String(url).includes('dolarapi')) return new Response('caído', { status: 503 });
      return Response.json({ oficial: { value_buy: 950, value_sell: 1000 }, blue: { value_buy: 1180, value_sell: 1200 } });
    }) as typeof fetch;
    expect(await refreshRates(fake)).toBe(2);
    await owner.api.patch('/store', { settings: { fxSource: 'blue', fxMarkup: 10 } });
    const fx = (await owner.api.get('/fx')).body;
    expect(fx.rate).toBe(1210);
    expect(fx.quotes.map((q: { casa: string }) => q.casa).sort()).toEqual(['blue', 'oficial']);
    // La caja recibe la cotización para trabajar sin internet.
    expect((await pos.get('/pos/bootstrap')).body.rate).toBe(1210);
  });
});

describe('equipos con IMEI', () => {
  it('ingresa equipos, rechaza IMEI inválidos o repetidos y los busca por IMEI', async () => {
    const m = await phoneModel();
    const [a] = await receive(m.id, [{ imei1: imei(), cost: 450, condition: 'NEW', color: 'Azul' }]);
    const s = await serial(a);
    expect(s.status).toBe('AVAILABLE');
    expect(s.events[0].type).toBe('IN');
    expect((await owner.api.post('/serials', { productId: m.id, items: [{ imei1: '123456789012345' }] })).body.error).toBe('invalid_imei');
    expect((await owner.api.post('/serials', { productId: m.id, items: [{ imei1: s.imei1 }] })).status).toBe(409);
    expect((await owner.api.get(`/serials/lookup/${s.imei1}`)).body.item.id).toBe(a);
    // El stock del modelo son los equipos disponibles.
    expect((await owner.api.get(`/products/${m.id}`)).body.stock).toBe(1);
  });

  it('venta con IMEI en dólares y pesos: costo, garantía, cajón de dólares y anulación', async () => {
    const m = await phoneModel('Samsung A55', 400);
    const [u] = await receive(m.id, [{ imei1: imei(), cost: 300 }]);
    const boot = (await pos.get('/pos/bootstrap')).body;
    expect(boot.serials).toHaveLength(1);
    expect(boot.businessType).toBe('PHONES');
    const cashSessionId = await openCash(10000, 100);
    const saleId = randomUUID();
    const customer = { id: randomUUID(), name: 'Juan Pérez', phone: '11 2345 6789', dni: '30111222' };
    // US$ 400 a $1000 = $400.000: paga US$ 300 en efectivo y $100.000 en efectivo.
    const res = await sync([
      {
        id: saleId,
        type: 'SALE',
        userId: owner.ownerId,
        occurredAt: now(),
        cashSessionId,
        items: [{ productId: m.id, qty: 1, unitPrice: 400000, listPrice: 400000, serialItemId: u }],
        payments: [
          { method: 'CASH', currency: 'USD', amount: 300000, fx: 300 },
          { method: 'CASH', amount: 100000 },
        ],
        total: 400000,
        rate: 1000,
        cashArs: 100000,
        cashUsd: 300,
        newCustomer: customer,
      },
    ]);
    expect(res[0].status).toBe('ok');
    const s = await serial(u);
    expect(s.status).toBe('SOLD');
    expect(s.customer.name).toBe('Juan Pérez');
    expect(s.warrantyUntil).toBeTruthy();
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, include: { items: true } });
    expect(Number(sale.costTotal)).toBe(300000);
    expect(Number(sale.items[0].cost)).toBe(300000);
    // Nuevo: 6 meses de garantía.
    const months = (sale.items[0].warrantyUntil!.getTime() - Date.now()) / (30 * 86_400_000);
    expect(months).toBeGreaterThan(5.5);
    expect(months).toBeLessThan(6.5);

    // Cierre: pesos 10.000 + 100.000; dólares 100 + 300.
    await sync([{ id: randomUUID(), type: 'CASH_CLOSE', userId: owner.ownerId, occurredAt: now(), cashSessionId, countedAmount: 110000, countedUsd: 400 }]);
    const cs = await prisma.cashSession.findUniqueOrThrow({ where: { id: cashSessionId } });
    expect(Number(cs.expectedAmount)).toBe(110000);
    expect(Number(cs.expectedUsd)).toBe(400);
    expect(Number(cs.differenceUsd)).toBe(0);

    // Anular devuelve el equipo al stock.
    await sync([{ id: randomUUID(), type: 'SALE_VOIDED', userId: owner.ownerId, occurredAt: now(), saleId }]);
    expect((await serial(u)).status).toBe('AVAILABLE');
  });

  it('vender dos veces el mismo equipo (dos cajas sin internet) no pierde la venta: avisa', async () => {
    const m = await phoneModel();
    const [u] = await receive(m.id, [{ imei1: imei(), cost: 400 }]);
    const ev = () => ({
      id: randomUUID(),
      type: 'SALE',
      userId: owner.ownerId,
      occurredAt: now(),
      items: [{ productId: m.id, qty: 1, unitPrice: 600000, listPrice: 600000, serialItemId: u }],
      payments: [{ method: 'TRANSFER', amount: 600000 }],
      total: 600000,
      rate: 1000,
    });
    expect((await sync([ev(), ev()])).map((r) => r.status)).toEqual(['ok', 'ok']);
    const alerts = await prisma.alert.findMany({ where: { storeId: owner.storeId, type: 'UNIT_CONFLICT' } });
    expect(alerts).toHaveLength(1);
  });
});

describe('toma de usados', () => {
  async function fullTradeIn(productId: string, code = imei()) {
    const t = (
      await owner.api.post('/tradeins', {
        customer: { name: 'Ana Gómez', dni: '28.444.555', phone: '1155556666' },
        model: 'iPhone 11 64GB',
        imei1: code,
        grade: 'B',
        battery: 84,
        checklist: { screen: true, faceId: true },
        offeredUsd: 180,
      })
    ).body;
    expect(t.number).toBe(1);
    // Sin DNI, ENACOM ni firma no se puede aceptar.
    const incomplete = await owner.api.post(`/tradeins/${t.id}/accept`);
    expect(incomplete.body.error).toBe('trade_in_incomplete');
    for (const kind of ['dniFront', 'dniBack', 'enacom', 'signature']) {
      const { payload, headers } = multipart({}, { name: 'photo', filename: 'x.png', type: 'image/png', data: tinyPng });
      const r = await app.inject({ method: 'POST', url: `/api/tradeins/${t.id}/photo?kind=${kind}`, payload, headers: { ...headers, cookie: owner.cookie } });
      expect(r.statusCode).toBe(200);
    }
    await owner.api.patch(`/tradeins/${t.id}`, { enacomResult: 'CLEAN', accountFree: true, imeiMatches: true, productId });
    const ok = await owner.api.post(`/tradeins/${t.id}/accept`);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('ACCEPTED');
    return ok.body as { id: string; serialItemId: string };
  }

  it('aceptar exige los controles y el equipo entra como usado con costo = lo que se pagó', async () => {
    const m = await phoneModel('iPhone 11 64GB', 300);
    const t = await fullTradeIn(m.id);
    const s = await serial(t.serialItemId);
    expect(s.condition).toBe('USED');
    expect(s.origin).toBe('TRADE_IN');
    expect(s.cost).toBe(180);
    // Libro de usados para la inspección.
    const csv = await owner.api.get('/tradeins-book.csv');
    expect(String(csv.body)).toContain(s.imei1);
    expect(String(csv.body)).toContain('Ana Gómez');
  });

  it('un IMEI denunciado en ENACOM no se puede aceptar', async () => {
    const t = (await owner.api.post('/tradeins', { customer: { name: 'X', dni: '1' }, model: 'Moto G', imei1: imei(), enacomResult: 'REPORTED' })).body;
    expect((await owner.api.post(`/tradeins/${t.id}/accept`)).body.error).toBe('imei_reported');
  });

  it('el crédito de la toma se usa como pago una sola vez', async () => {
    const used = await phoneModel('iPhone 11 64GB', 300);
    const t = await fullTradeIn(used.id);
    const m = await phoneModel('iPhone 15', 900);
    const [u] = await receive(m.id, [{ imei1: imei(), cost: 750 }]);
    expect((await pos.get('/pos/bootstrap')).body.tradeIns.map((x: { id: string }) => x.id)).toEqual([t.id]);
    const sale = () => ({
      id: randomUUID(),
      type: 'SALE',
      userId: owner.ownerId,
      occurredAt: now(),
      items: [{ productId: m.id, qty: 1, unitPrice: 900000, listPrice: 900000, serialItemId: u }],
      payments: [
        { method: 'TRADE_IN', amount: 180000, ref: t.id },
        { method: 'TRANSFER', amount: 720000 },
      ],
      total: 900000,
      rate: 1000,
    });
    await sync([sale()]);
    expect((await prisma.tradeIn.findUniqueOrThrow({ where: { id: t.id } })).usedSaleId).toBeTruthy();
    expect((await pos.get('/pos/bootstrap')).body.tradeIns).toHaveLength(0);
    await sync([sale()]);
    const conflict = await prisma.alert.findFirst({ where: { storeId: owner.storeId, type: 'UNIT_CONFLICT' } });
    expect((conflict?.data as { kind: string }).kind).toBe('serial_not_available');
  });
});

describe('señas', () => {
  it('reserva el equipo, se descuenta al cobrar y si vence lo libera', async () => {
    const m = await phoneModel();
    const [a, b] = await receive(m.id, [{ imei1: imei(), cost: 400 }, { imei1: imei(), cost: 400 }]);
    const cashSessionId = await openCash(0, 0);
    const depositId = randomUUID();
    await sync([{ id: randomUUID(), type: 'DEPOSIT_IN', userId: owner.ownerId, occurredAt: now(), cashSessionId, depositId, serialItemId: a, amount: 100000, currency: 'USD', fx: 100, method: 'CASH', newCustomer: { id: randomUUID(), name: 'Leo' } }]);
    expect((await serial(a)).status).toBe('RESERVED');
    await sync([
      {
        id: randomUUID(),
        type: 'SALE',
        userId: owner.ownerId,
        occurredAt: now(),
        cashSessionId,
        items: [{ productId: m.id, qty: 1, unitPrice: 600000, listPrice: 600000, serialItemId: a }],
        payments: [
          { method: 'DEPOSIT', amount: 100000, ref: depositId },
          { method: 'CASH', amount: 500000 },
        ],
        total: 600000,
        rate: 1000,
        cashArs: 500000,
        cashUsd: 0,
      },
    ]);
    expect((await prisma.deposit.findUniqueOrThrow({ where: { id: depositId } })).status).toBe('USED');
    // La seña en dólares cuenta en el cajón de dólares.
    await sync([{ id: randomUUID(), type: 'CASH_CLOSE', userId: owner.ownerId, occurredAt: now(), cashSessionId, countedAmount: 500000, countedUsd: 100 }]);
    const cs = await prisma.cashSession.findUniqueOrThrow({ where: { id: cashSessionId } });
    expect([Number(cs.expectedAmount), Number(cs.expectedUsd)]).toEqual([500000, 100]);

    // Seña vencida: se libera el otro equipo.
    const s2 = await openCash(0, 0);
    const dep2 = randomUUID();
    await sync([{ id: randomUUID(), type: 'DEPOSIT_IN', userId: owner.ownerId, occurredAt: now(), cashSessionId: s2, depositId: dep2, serialItemId: b, amount: 50000, method: 'TRANSFER', expiresAt: new Date(Date.now() - 60_000).toISOString() }]);
    expect((await serial(b)).status).toBe('RESERVED');
    await runDailyJobs(owner.storeId);
    expect((await serial(b)).status).toBe('AVAILABLE');
    expect(await prisma.alert.count({ where: { storeId: owner.storeId, type: 'DEPOSIT_EXPIRED' } })).toBe(1);
  });
});

describe('servicio técnico', () => {
  it('ingreso, presupuesto aprobado por el cliente desde el link, repuestos del stock y cobro en la caja', async () => {
    const glass = (await owner.api.post('/products', { name: 'Módulo pantalla iPhone 11', price: 50000 })).body;
    await owner.api.post('/stock/entries', { items: [{ productId: glass.id, qty: 3, unitCost: 30000 }] });
    const tech = await createEmployee(app, owner, { name: 'Técnico', perms: ['repairs'] });
    const r = (
      await owner.api.post('/repairs', {
        customer: { name: 'Carla', phone: '1144445555' },
        device: 'iPhone 11',
        imei: imei(),
        problem: 'Pantalla rota',
        lockType: 'PIN',
        lockSecret: '1234',
        technicianId: tech.id,
        diagnosisFee: 5000,
      })
    ).body;
    expect(r.number).toBe(1);
    expect(r.lockSecret).toBe('1234'); // el dueño lo ve
    // Un vendedor sin ser el técnico no ve el código.
    const seller = await createEmployee(app, owner, { name: 'Vendedor', perms: ['sell'] });
    expect((await seller.api.get(`/repairs/${r.id}`)).body.lockSecret).toBeNull();
    expect((await tech.api.get(`/repairs/${r.id}`)).body.lockSecret).toBe('1234');

    await tech.api.patch(`/repairs/${r.id}`, {
      status: 'QUOTE_SENT',
      diagnosis: 'Módulo roto',
      quote: [
        { kind: 'PART', productId: glass.id, name: 'Módulo', qty: 1, price: 70000 },
        { kind: 'LABOR', name: 'Mano de obra', qty: 1, price: 30000 },
      ],
    });
    const pub = await app.inject({ method: 'GET', url: `/api/public/repairs/${r.publicToken}` });
    expect(pub.json().quoteTotal).toBe(100000);
    expect(pub.json().canAnswer).toBe(true);
    const ans = await app.inject({ method: 'POST', url: `/api/public/repairs/${r.publicToken}/answer`, payload: { approve: true } });
    expect(ans.json().status).toBe('APPROVED');

    await tech.api.patch(`/repairs/${r.id}`, { status: 'IN_REPAIR' });
    expect((await owner.api.get(`/products/${glass.id}`)).body.stock).toBe(2);
    // Entregar sin cobrar no se puede: se cobra en la caja.
    await tech.api.patch(`/repairs/${r.id}`, { status: 'READY' });
    expect((await tech.api.patch(`/repairs/${r.id}`, { status: 'DELIVERED' })).body.error).toBe('charge_in_pos');

    const boot = (await pos.get('/pos/bootstrap')).body;
    const toCharge = boot.repairs.find((x: { id: string }) => x.id === r.id);
    expect(toCharge.amount).toBe(100000);
    await sync([
      {
        id: randomUUID(),
        type: 'SALE',
        userId: owner.ownerId,
        occurredAt: now(),
        items: [{ productId: boot.repairProductId, qty: 1, unitPrice: 100000, listPrice: 100000, repairOrderId: r.id }],
        payments: [{ method: 'QR', amount: 100000 }],
        total: 100000,
      },
    ]);
    const done = (await owner.api.get(`/repairs/${r.id}`)).body;
    expect(done.status).toBe('DELIVERED');
    expect(done.partsCost).toBe(30000);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: done.saleId }, include: { items: true } });
    expect(Number(sale.costTotal)).toBe(30000);
    expect(sale.items[0].warrantyUntil).toBeTruthy();
  });

  it('si rechaza el presupuesto se cobra solo el diagnóstico', async () => {
    const r = (await owner.api.post('/repairs', { customer: { name: 'Mario' }, device: 'Moto G', problem: 'No carga', diagnosisFee: 8000 })).body;
    await owner.api.patch(`/repairs/${r.id}`, { status: 'QUOTE_SENT', quote: [{ kind: 'LABOR', name: 'Pin de carga', qty: 1, price: 25000 }] });
    await app.inject({ method: 'POST', url: `/api/public/repairs/${r.publicToken}/answer`, payload: { approve: false } });
    await owner.api.patch(`/repairs/${r.id}`, { status: 'READY' });
    expect((await owner.api.get(`/repairs/${r.id}`)).body.charge).toBe(8000);
  });
});

describe('pedidos y entregas', () => {
  it('pedido contra entrega: cadete entrega, se genera la venta, rinde y avisa si falta plata', async () => {
    const m = await phoneModel('Xiaomi Redmi 13', 200);
    const [u] = await receive(m.id, [{ imei1: imei(), cost: 150 }]);
    const courier = await createEmployee(app, owner, { name: 'Cadete', perms: ['deliveries'] });
    const o = (
      await owner.api.post('/orders', {
        channel: 'INSTAGRAM',
        customer: { name: 'Lucía', phone: '1166667777' },
        items: [{ productId: m.id, serialItemId: u }],
        deliveryFee: 5000,
        address: 'Av. Siempreviva 742',
      })
    ).body;
    expect(o.number).toBe(1);
    expect(o.total).toBe(200000);
    expect(o.status).toBe('RESERVED');
    expect((await serial(u)).status).toBe('RESERVED');

    await owner.api.post(`/orders/${o.id}/assign`, { courierId: courier.id });
    const mine = (await courier.api.get('/deliveries')).body;
    expect(mine).toHaveLength(1);
    expect(mine[0].collectAmount).toBe(205000);
    await courier.api.post(`/deliveries/${mine[0].id}/start`);
    const done = await courier.api.post(`/deliveries/${mine[0].id}/done`, { receiverName: 'Lucía', imeiConfirmed: true, collected: 205000 });
    expect(done.status).toBe(200);
    const order = (await owner.api.get(`/orders/${o.id}`)).body;
    expect(order.status).toBe('DELIVERED');
    expect(order.withdrawalUntil).toBeTruthy();
    expect((await serial(u)).status).toBe('SOLD');
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: order.saleId } });
    expect(sale.channel).toBe('ORDER');
    expect(Number(sale.total)).toBe(205000);

    // Rinde en la caja $200.000 de $205.000: aviso de diferencia.
    const boot = (await pos.get('/pos/bootstrap')).body;
    expect(boot.couriers.find((c: { id: string }) => c.id === courier.id).pendingArs).toBe(205000);
    const cashSessionId = await openCash(0, 0);
    await sync([{ id: randomUUID(), type: 'CASH_MOVE', userId: owner.ownerId, occurredAt: now(), cashSessionId, kind: 'COURIER', amount: 200000, refId: courier.id }]);
    expect(await prisma.alert.count({ where: { storeId: owner.storeId, type: 'COURIER_DIFF' } })).toBe(1);
    expect(await prisma.delivery.count({ where: { storeId: owner.storeId, settledAt: null } })).toBe(0);

    // Arrepentimiento: se anula la venta y el equipo vuelve.
    expect((await owner.api.post(`/orders/${o.id}/return`, { reason: 'No le gustó' })).status).toBe(200);
    expect((await serial(u)).status).toBe('AVAILABLE');
  });
});

describe('reportes', () => {
  it('ganancia por equipo en dólares y antigüedad del stock', async () => {
    const m = await phoneModel('Moto Edge', 500);
    const [a] = await receive(m.id, [{ imei1: imei(), cost: 350 }, { imei1: imei(), cost: 350 }]);
    await sync([
      {
        id: randomUUID(),
        type: 'SALE',
        userId: owner.ownerId,
        occurredAt: now(),
        items: [{ productId: m.id, qty: 1, unitPrice: 500000, listPrice: 500000, serialItemId: a }],
        payments: [{ method: 'TRANSFER', amount: 500000 }],
        total: 500000,
        rate: 1000,
      },
    ]);
    const r = (await owner.api.get('/phone-reports')).body;
    expect(r.sales.profitUsd).toBe(150);
    expect(r.sales.units[0].profitUsd).toBe(150);
    expect(r.stock.units).toBe(1);
    expect(r.stock.costUsd).toBe(350);
    expect(r.stock.aging[0]).toMatchObject({ bucket: '0-30', units: 1 });
  });
});

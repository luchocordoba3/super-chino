import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { env } from '../src/env';
import { hmacSha256 } from '../src/lib/crypto';
import { type App, client, type Client, type Owner, registerOwner, resetDb } from './helpers';

let app: App;
let owner: Owner;
let pos: Client;
const TOKEN = 'APP_USR-1234567890-abcdef-TEST';

/** Mercado Pago de mentira: guarda lo que se le pidió y responde como la API real. */
const fake = { calls: [] as { method: string; path: string; body: Record<string, unknown> | null; headers: Record<string, string> }[], orderStatus: 'created' };
function fakeFetch(input: string | URL | Request, init: RequestInit = {}) {
  const url = new URL(String(input));
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
  const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
  fake.calls.push({ method, path: url.pathname, body, headers });
  const json = (status: number, data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } }));
  if (url.pathname === '/oauth/token') return json(200, { access_token: TOKEN, refresh_token: 'TG-refresh', expires_in: 15552000, user_id: 555 });
  if (headers.authorization !== `Bearer ${TOKEN}`) return json(401, { message: 'invalid_token' });
  if (method === 'GET' && url.pathname === '/users/me') return json(200, { id: 555, nickname: 'ALMACEN' });
  if (method === 'POST' && url.pathname === '/users/555/stores') return json(201, { id: 9001 });
  if (method === 'POST' && url.pathname === '/pos') return json(201, { id: fake.calls.length, qr: { image: `https://mp.test/qr/${body?.external_id}.png` } });
  if (method === 'POST' && url.pathname === '/v1/orders') return json(201, { id: 'ORD01TEST', status: 'created' });
  if (method === 'GET' && url.pathname === '/v1/orders/ORD01TEST') return json(200, { id: 'ORD01TEST', status: fake.orderStatus, transactions: { payments: [{ id: 'PAY01TEST' }] } });
  if (method === 'POST' && url.pathname === '/v1/orders/ORD01TEST/cancel') {
    fake.orderStatus = 'canceled';
    return json(200, { id: 'ORD01TEST', status: 'canceled' });
  }
  return json(404, { message: 'not_found' });
}
const mpCalls = (path: string, method = 'POST') => fake.calls.filter((c) => c.path === path && c.method === method);

beforeAll(async () => {
  app = await buildApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb();
  fake.calls = [];
  fake.orderStatus = 'created';
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  owner = await registerOwner(app);
  const { token } = (await owner.api.post('/pos/devices', { name: 'Caja 1' })).body;
  pos = client(app, undefined, { 'x-device-token': token });
});
afterEach(() => {
  vi.unstubAllGlobals();
  env.MP_WEBHOOK_SECRET = '';
  env.MP_CLIENT_ID = '';
  env.MP_CLIENT_SECRET = '';
});

const address = { streetName: 'Av. Siempreviva', streetNumber: '742', city: 'Rosario', state: 'Santa Fe', latitude: -32.95, longitude: -60.66 };
async function connectAndSetup() {
  expect((await owner.api.post('/mp/token', { accessToken: TOKEN })).status).toBe(200);
  const r = await owner.api.post('/mp/setup', { address });
  expect(r.status).toBe(200);
  return r.body as { table: number | null; externalId: string; qrImage: string }[];
}

describe('Mercado Pago: conectar y QR fijos', () => {
  it('con el Access Token del dueño: queda conectado (cifrado) y arma un QR por mesa más el mostrador', async () => {
    expect((await owner.api.post('/mp/token', { accessToken: 'APP_USR-token-que-no-sirve-xx' })).body.error).toBe('mp_bad_token');
    expect((await owner.api.post('/mp/token', { accessToken: TOKEN })).status).toBe(200);
    const acc = await prisma.mpAccount.findUniqueOrThrow({ where: { storeId: owner.storeId } });
    expect(acc.userId).toBe('555');
    expect(acc.accessToken).not.toContain(TOKEN);

    expect((await owner.api.post('/mp/setup', {})).body.error).toBe('mp_address_required');
    const qrs = (await owner.api.post('/mp/setup', { address })).body;
    expect(qrs.map((q: { table: number | null }) => q.table)).toEqual([null, 1, 2, 3, 4, 5, 6]);
    expect(qrs[3]).toEqual({ table: 3, externalId: `ALM${owner.storeCode}M3`, qrImage: `https://mp.test/qr/ALM${owner.storeCode}M3.png` });
    expect(mpCalls('/users/555/stores')[0].body).toMatchObject({ external_id: `ALM${owner.storeCode}`, location: { street_name: 'Av. Siempreviva', city_name: 'Rosario', latitude: -32.95 } });
    expect(mpCalls('/pos')[0].body).toMatchObject({ name: 'Mostrador', fixed_amount: true, store_id: 9001 });

    // Repetir no duplica nada; la caja se entera de que puede cobrar con QR.
    await owner.api.post('/mp/setup', {});
    expect(mpCalls('/pos')).toHaveLength(7);
    expect((await pos.get('/pos/bootstrap')).body.store.mp).toBe(true);
    expect((await owner.api.get('/mp')).body).toMatchObject({ connected: true, userId: '555', hasStore: true });
  });

  it('con "Conectar Mercado Pago": ida y vuelta firmada', async () => {
    env.MP_CLIENT_ID = '123';
    env.MP_CLIENT_SECRET = 'shh';
    const { url } = (await owner.api.get('/mp/connect')).body;
    const state = new URL(url).searchParams.get('state')!;
    expect(url).toContain('client_id=123');
    const bad = await app.inject({ method: 'GET', url: `/api/mp/callback?code=X&state=${state}x` });
    expect(bad.headers.location).toBe('/settings?mp=error');
    const ok = await app.inject({ method: 'GET', url: `/api/mp/callback?code=TG-code&state=${state}` });
    expect(ok.headers.location).toBe('/settings?mp=ok');
    expect(mpCalls('/oauth/token')[0].body).toMatchObject({ grant_type: 'authorization_code', code: 'TG-code', client_id: '123' });
    expect(await prisma.mpAccount.findUniqueOrThrow({ where: { storeId: owner.storeId } })).toMatchObject({ userId: '555' });
  });
});

describe('Mercado Pago: cobrar con el monto cargado', () => {
  it('la caja crea la orden en el QR de la mesa, sin duplicar si reintenta, y se entera cuando pagan', async () => {
    await connectAndSetup();
    const chargeId = randomUUID();
    const created = (await pos.post('/pos/mp/charges', { chargeId, amount: 5400, table: 3, description: 'Mesa 3' })).body;
    expect(created).toMatchObject({ chargeId, orderId: 'ORD01TEST', status: 'created', paid: false, table: 3 });
    const order = mpCalls('/v1/orders')[0];
    expect(order.body).toEqual({
      type: 'qr',
      total_amount: '5400.00',
      description: 'Mesa 3',
      external_reference: chargeId,
      expiration_time: 'PT15M',
      config: { qr: { external_pos_id: `ALM${owner.storeCode}M3`, mode: 'static' } },
      transactions: { payments: [{ amount: '5400.00' }] },
    });
    expect(order.headers['x-idempotency-key']).toBe(chargeId);
    await pos.post('/pos/mp/charges', { chargeId, amount: 5400, table: 3 });
    expect(mpCalls('/v1/orders')).toHaveLength(1);

    // Todavía no pagaron.
    await prisma.mpCharge.update({ where: { id: chargeId }, data: { updatedAt: new Date(Date.now() - 5000) } });
    expect((await pos.get(`/pos/mp/charges/${chargeId}`)).body.paid).toBe(false);
    // Pagaron: la próxima consulta lo ve.
    fake.orderStatus = 'processed';
    await prisma.mpCharge.update({ where: { id: chargeId }, data: { updatedAt: new Date(Date.now() - 5000) } });
    expect((await pos.get(`/pos/mp/charges/${chargeId}`)).body).toMatchObject({ paid: true, status: 'processed', paymentId: 'PAY01TEST' });
  });

  it('sin QR propio para esa mesa usa el del mostrador; cancelar anula la orden', async () => {
    await connectAndSetup();
    const chargeId = randomUUID();
    await pos.post('/pos/mp/charges', { chargeId, amount: 1800, table: 9 });
    expect(mpCalls('/v1/orders')[0].body).toMatchObject({ config: { qr: { external_pos_id: `ALM${owner.storeCode}CAJA` } } });
    const r = (await pos.post(`/pos/mp/charges/${chargeId}/cancel`)).body;
    expect(r).toMatchObject({ status: 'canceled', paid: false });
  });

  it('sin Mercado Pago conectado no se puede cobrar con QR', async () => {
    const r = await pos.post('/pos/mp/charges', { chargeId: randomUUID(), amount: 100 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('mp_qr_missing');
  });
});

describe('Mercado Pago: aviso de pago (webhook)', () => {
  it('con la firma correcta actualiza el cobro; con otra firma se rechaza', async () => {
    await connectAndSetup();
    const chargeId = randomUUID();
    await pos.post('/pos/mp/charges', { chargeId, amount: 2500 });
    env.MP_WEBHOOK_SECRET = 'clave-del-webhook';
    fake.orderStatus = 'processed';
    const ts = '1727300000';
    const v1 = hmacSha256('clave-del-webhook', `id:ord01test;request-id:req-1;ts:${ts};`);
    const call = (sig: string) =>
      app.inject({
        method: 'POST',
        url: '/api/mp/webhook?data.id=ORD01TEST&type=order',
        headers: { 'x-signature': sig, 'x-request-id': 'req-1', 'content-type': 'application/json' },
        payload: { action: 'order.processed', type: 'order', data: { id: 'ORD01TEST' } },
      });
    expect((await call(`ts=${ts},v1=${'0'.repeat(64)}`)).statusCode).toBe(401);
    expect(await prisma.mpCharge.findUniqueOrThrow({ where: { id: chargeId } })).toMatchObject({ status: 'created' });
    expect((await call(`ts=${ts},v1=${v1}`)).statusCode).toBe(200);
    expect(await prisma.mpCharge.findUniqueOrThrow({ where: { id: chargeId } })).toMatchObject({ status: 'processed', paymentId: 'PAY01TEST' });
  });
});

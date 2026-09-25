import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { type App, client, type Client, type Owner, registerOwner, resetDb } from './helpers';

let app: App;
let owner: Owner;
let pos: Client;
let guest: Client;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb();
  owner = await registerOwner(app);
  const { token } = (await owner.api.post('/pos/devices', { name: 'Caja 1' })).body;
  pos = client(app, undefined, { 'x-device-token': token });
  guest = client(app); // el cliente en la mesa: sin sesión
});

async function menuOf(table: number) {
  const tables = (await owner.api.get('/menu/tables')).body as { table: number; path: string }[];
  return tables.find((t) => t.table === table)!.path.replace('/m/', '');
}
async function products() {
  const bar = (await owner.api.post('/categories', { name: 'Bar' })).body?.id ?? null;
  const fernet = (await owner.api.post('/stock/quick', { barcode: '9', product: { name: 'Fernet con coca', price: 5000 }, qty: 10 })).body.product.id as string;
  await owner.api.patch(`/products/${fernet}`, { menu: true, categoryId: bar });
  const papas = (await owner.api.post('/stock/quick', { barcode: '1', product: { name: 'Papas fritas', price: 2800 }, qty: 5 })).body.product.id as string;
  await owner.api.patch(`/products/${papas}`, { menu: true });
  const agotado = (await owner.api.post('/products', { name: 'Maní', price: 900, menu: true })).body.id as string;
  const secreto = (await owner.api.post('/products', { name: 'Lavandina', price: 1100 })).body.id as string;
  return { fernet, papas, agotado, secreto };
}

describe('menú QR en las mesas', () => {
  it('un QR por mesa con token propio; la carta muestra solo lo del menú y si hay', async () => {
    const tables = (await owner.api.get('/menu/tables')).body;
    expect(tables.map((t: { table: number }) => t.table)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await owner.api.get('/menu/tables')).body).toEqual(tables); // no cambian
    const { fernet, papas, agotado } = await products();
    // Para el tostado con receta: disponible aunque no tenga stock propio.
    const pan = (await owner.api.post('/stock/quick', { barcode: '2', product: { name: 'Pan', price: 1 }, qty: 1 })).body.product.id;
    const tostado = (await owner.api.post('/products', { name: 'Tostado', price: 4500, menu: true })).body.id;
    await owner.api.put(`/products/${tostado}/recipe`, { items: [{ ingredientId: pan, qty: 0.1 }] });

    const menu = (await guest.get(`/public/menu/${await menuOf(3)}`)).body;
    expect(menu).toMatchObject({ table: 3, tab: null, payQr: false });
    expect(menu.products.map((p: { id: string; available: boolean }) => [p.id, p.available])).toEqual([
      [fernet, true],
      [agotado, false],
      [papas, true],
      [tostado, true],
    ]);
  });

  it('el pedido queda pendiente en la cuenta de la mesa hasta que la caja lo acepta', async () => {
    const { fernet, papas } = await products();
    const token = await menuOf(3);
    const r = await guest.post(`/public/menu/${token}/order`, {
      items: [
        { productId: fernet, qty: 2 },
        { productId: papas, qty: 1 },
      ],
    });
    expect(r.status).toBe(200);
    const [tab] = (await pos.get('/pos/tabs')).body;
    expect(tab).toMatchObject({ label: 'Mesa 3', table: 3, items: [], total: 0 });
    expect(tab.pending.map((p: { name: string; qty: number }) => [p.name, p.qty])).toEqual([
      ['Fernet con coca', 2],
      ['Papas fritas', 1],
    ]);
    let view = (await guest.get(`/public/menu/${token}`)).body.tab;
    expect(view.total).toBe(0);
    expect(view.items.map((i: { name: string; pending: boolean }) => [i.name, i.pending])).toEqual([
      ['Fernet con coca', true],
      ['Papas fritas', true],
    ]);

    // La caja ya tenía un fernet anotado: al aceptar se suma en el mismo renglón. Las papas se rechazan.
    const at = new Date().toISOString();
    await pos.post('/pos/sync', {
      events: [
        { id: randomUUID(), type: 'TAB_ITEM', userId: owner.ownerId, occurredAt: at, tabId: tab.id, productId: fernet, qty: 1, unitPrice: 5000 },
        { id: randomUUID(), type: 'TAB_ACCEPT', userId: owner.ownerId, occurredAt: at, tabId: tab.id, itemId: tab.pending[0].id },
        { id: randomUUID(), type: 'TAB_REJECT', userId: owner.ownerId, occurredAt: at, tabId: tab.id, itemId: tab.pending[1].id },
      ],
    });
    const [after] = (await pos.get('/pos/tabs')).body;
    expect(after.pending).toEqual([]);
    expect(after.items.map((i: { name: string; qty: number }) => [i.name, i.qty])).toEqual([['Fernet con coca', 3]]);
    expect(after.total).toBe(15000);
    view = (await guest.get(`/public/menu/${token}`)).body.tab;
    expect(view).toMatchObject({ total: 15000, billRequested: false });

    // Pedir la cuenta.
    expect((await guest.post(`/public/menu/${token}/bill`)).status).toBe(200);
    expect((await pos.get('/pos/tabs')).body[0].billAt).not.toBeNull();
  });

  it('no se puede pedir con un QR inválido, lo que no está en la carta ni en una mesa que ya no existe', async () => {
    const { secreto, fernet } = await products();
    const token = await menuOf(3);
    expect((await guest.get('/public/menu/cualquiera')).status).toBe(404);
    expect((await guest.post(`/public/menu/${token}/order`, { items: [{ productId: secreto, qty: 1 }] })).status).toBe(404);
    expect((await guest.post(`/public/menu/${token}/bill`)).body.error).toBe('no_open_tab');
    // El dueño cambia el QR de la mesa 3: el viejo deja de andar.
    const fresh = (await owner.api.post('/menu/tables/3/rotate')).body.path.replace('/m/', '');
    expect((await guest.get(`/public/menu/${token}`)).status).toBe(404);
    expect((await guest.get(`/public/menu/${fresh}`)).status).toBe(200);
    // Con 2 mesas, la mesa 3 ya no existe.
    const settings = (await owner.api.get('/auth/me')).body.store.settings;
    await owner.api.patch('/store', { settings: { ...settings, tables: 2 } });
    expect((await guest.get(`/public/menu/${fresh}`)).status).toBe(404);
    expect(await prisma.tab.count()).toBe(0);
    void fernet;
  });

  it('no deja llenar la cuenta de pedidos pendientes', async () => {
    const { fernet } = await products();
    const token = await menuOf(1);
    const twenty = { items: Array.from({ length: 20 }, () => ({ productId: fernet, qty: 1 })) };
    expect((await guest.post(`/public/menu/${token}/order`, twenty)).status).toBe(200);
    expect((await guest.post(`/public/menu/${token}/order`, twenty)).status).toBe(200);
    expect((await guest.post(`/public/menu/${token}/order`, twenty)).status).toBe(429);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { seedDemo } from '../src/services/demo';
import { type App, client, cookieFrom, resetDb } from './helpers';

let app: App;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

describe('demo', () => {
  it('reiniciar la demo vuelve a los datos de ejemplo sin cerrar la sesión del dueño', async () => {
    const first = await seedDemo();
    const login = await app.inject({ method: 'POST', url: '/api/auth/owner-login', payload: { email: 'dueno@demo.com', password: 'demo1234' } });
    const owner = client(app, cookieFrom(login));
    const ownerId = (await owner.get('/auth/me')).body.user.id;

    await owner.post('/users', { name: 'Carla', username: 'carla', pin: '4321' });
    await owner.post('/products', { name: 'Producto de prueba', price: 1 });
    const again = await seedDemo();

    expect(again.storeId).toBe(first.storeId);
    expect((await owner.get('/auth/me')).body.user.id).toBe(ownerId);
    expect((await owner.get('/users')).body.map((u: { username: string }) => u.username).sort()).toEqual(['dueno', 'martin', 'sofia']);
    expect(await prisma.product.count()).toBe(14);
    expect(await prisma.sale.count()).toBe(first.sales);
  });

  it('el botón de reinicio solo existe en servidores de demo', async () => {
    await seedDemo();
    const login = await app.inject({ method: 'POST', url: '/api/auth/owner-login', payload: { email: 'dueno@demo.com', password: 'demo1234' } });
    expect((await client(app, cookieFrom(login)).post('/demo/reset')).status).toBe(403);
  });
});

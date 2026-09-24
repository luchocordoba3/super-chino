import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { type App, client, createEmployee, registerOwner, resetDb } from './helpers';

let app: App;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

describe('login y usuarios', () => {
  it('el registro crea el local con código y deja al dueño logueado', async () => {
    const owner = await registerOwner(app);
    expect(owner.me.user.role).toBe('OWNER');
    expect(owner.me.user.lang).toBe('zh');
    expect(owner.storeCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(owner.me.store.settings.expiryAlertDays).toBe(7);
  });

  it('el dueño entra con email y contraseña', async () => {
    await registerOwner(app, { email: 'dueno@test.com' });
    const bad = await client(app).post('/auth/owner-login', { email: 'dueno@test.com', password: 'mal' });
    expect(bad.status).toBe(401);
    const ok = await client(app).post('/auth/owner-login', { email: 'DUENO@test.com', password: 'secreto123' });
    expect(ok.status).toBe(200);
  });

  it('el empleado entra con código de local + usuario + PIN', async () => {
    const owner = await registerOwner(app);
    const emp = await createEmployee(app, owner, { username: 'sofia', pin: '4321' });
    const me = await emp.api.get('/auth/me');
    expect(me.body.user.username).toBe('sofia');
    expect(me.body.user.perms).toEqual(['sell', 'stock']);

    const wrong = await client(app).post('/auth/login', { storeCode: owner.storeCode, username: 'sofia', pin: '0000' });
    expect(wrong.status).toBe(401);
  });

  it('un empleado dado de baja queda afuera al instante', async () => {
    const owner = await registerOwner(app);
    const emp = await createEmployee(app, owner);
    expect((await emp.api.get('/auth/me')).status).toBe(200);
    await owner.api.patch(`/users/${emp.id}`, { active: false });
    expect((await emp.api.get('/auth/me')).status).toBe(401);
  });

  it('un empleado no puede administrar empleados ni la configuración', async () => {
    const owner = await registerOwner(app);
    const emp = await createEmployee(app, owner);
    expect((await emp.api.post('/users', { name: 'X', username: 'x1', pin: '1111' })).status).toBe(403);
    expect((await emp.api.patch('/store', { settings: { targetMargin: 10 } })).status).toBe(403);
    expect((await emp.api.patch(`/users/${emp.id}`, { perms: ['sell', 'stock', 'prices'] })).status).toBe(403);
  });

  it('cada usuario elige su idioma', async () => {
    const owner = await registerOwner(app);
    const emp = await createEmployee(app, owner);
    const res = await emp.api.patch('/auth/me', { lang: 'zh' });
    expect(res.body.lang).toBe('zh');
  });

  it('la configuración se valida y se completa con valores por defecto', async () => {
    const owner = await registerOwner(app);
    const ok = await owner.api.patch('/store', { settings: { targetMargin: 35 } });
    expect(ok.body.settings.targetMargin).toBe(35);
    expect(ok.body.settings.priceRounding).toBe(10);
    const bad = await owner.api.patch('/store', { settings: { targetMargin: -5 } });
    expect(bad.status).toBe(400);
  });

  it('la configuración pública indica si es un servidor de demo (por defecto no)', async () => {
    expect((await client(app).get('/public/config')).body).toEqual({ demo: false });
  });

  it('un local no ve ni toca los datos de otro', async () => {
    const a = await registerOwner(app);
    const b = await registerOwner(app);
    const empA = await createEmployee(app, a);
    const listB = await b.api.get('/users');
    expect(listB.body.map((u: { id: string }) => u.id)).not.toContain(empA.id);
    expect((await b.api.patch(`/users/${empA.id}`, { active: false })).status).toBe(404);
  });
});

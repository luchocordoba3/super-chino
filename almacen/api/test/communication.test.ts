import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { settleJobs } from '../src/services/messages';
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
  owner = await registerOwner(app, { lang: 'es' });
  const { token } = (await owner.api.post('/pos/devices', { name: 'Caja 1' })).body;
  pos = client(app, undefined, { 'x-device-token': token });
});

const at = (minutesAgo = 0) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

describe('pase de turno', () => {
  it('las novedades del cierre le llegan al dueño y al equipo, y la caja las muestra al abrir', async () => {
    const sofia = await createEmployee(app, owner, { name: 'Sofía', perms: ['sell'] });
    const martin = await createEmployee(app, owner, { name: 'Martín', perms: ['sell'] });
    const s1 = randomUUID();
    const notes = 'Se terminó el cambio chico. Vino el de Coca, vuelve el jueves.';
    const res = await pos.post('/pos/sync', {
      events: [
        { id: randomUUID(), type: 'CASH_OPEN', userId: sofia.id, occurredAt: at(60), cashSessionId: s1, openingAmount: 1000 },
        { id: randomUUID(), type: 'CASH_CLOSE', userId: sofia.id, occurredAt: at(1), cashSessionId: s1, countedAmount: 1000, notes: `  ${notes}  ` },
      ],
    });
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(['ok', 'ok']);
    await settleJobs();

    expect((await prisma.cashSession.findUniqueOrThrow({ where: { id: s1 } })).notes).toBe(notes);
    const msg = await prisma.message.findFirstOrThrow({ include: { recipients: true } });
    expect(msg).toMatchObject({ fromUserId: sofia.id, text: notes, meta: { type: 'HANDOVER', cashSessionId: s1 } });
    expect(msg.recipients.map((r) => r.userId).sort()).toEqual([owner.ownerId, martin.id].sort());
    // Martín lo ve en sus mensajes.
    const inbox = (await martin.api.get('/messages')).body;
    expect(inbox.some((m: { text: string }) => m.text === notes)).toBe(true);

    const boot = (await pos.get('/pos/bootstrap')).body;
    expect(boot.handover).toMatchObject({ notes, user: 'Sofía' });
  });

  it('sin novedades no se manda nada', async () => {
    const sofia = await createEmployee(app, owner, { name: 'Sofía', perms: ['sell'] });
    const s1 = randomUUID();
    await pos.post('/pos/sync', {
      events: [
        { id: randomUUID(), type: 'CASH_OPEN', userId: sofia.id, occurredAt: at(60), cashSessionId: s1, openingAmount: 0 },
        { id: randomUUID(), type: 'CASH_CLOSE', userId: sofia.id, occurredAt: at(1), cashSessionId: s1, countedAmount: 0, notes: '   ' },
      ],
    });
    expect(await prisma.message.count()).toBe(0);
    expect((await pos.get('/pos/bootstrap')).body.handover).toBeNull();
  });
});

describe('se está terminando', () => {
  it('desde la caja (sin internet también): avisa al dueño, entra en reponer y se cierra al reponer', async () => {
    const sofia = await createEmployee(app, owner, { name: 'Sofía', perms: ['sell'] });
    const yerba = (await owner.api.post('/stock/quick', { barcode: '779', product: { name: 'Yerba 1kg', price: 100 }, qty: 30 })).body.product.id;
    // Con 30 y sin ventas, los números dicen que no hace falta reponer.
    expect((await owner.api.get('/reorder')).body).toEqual([]);

    const res = await pos.post('/pos/sync', { events: [{ id: randomUUID(), type: 'SHORTAGE', userId: sofia.id, occurredAt: at(), productId: yerba }] });
    expect(res.body.results[0].status).toBe('ok');
    const alert = await prisma.alert.findFirstOrThrow({ where: { type: 'SHORTAGE' } });
    expect(alert).toMatchObject({ severity: 'warn', resolvedAt: null, data: { productId: yerba, name: 'Yerba 1kg', stock: 30, by: 'Sofía' } });

    const reorder = (await owner.api.get('/reorder')).body;
    expect(reorder[0].items).toEqual([expect.objectContaining({ productId: yerba, reportedBy: 'Sofía', qty: 1 })]);

    await owner.api.post('/stock/quick', { barcode: '779', qty: 12 });
    expect((await prisma.alert.findFirstOrThrow({ where: { type: 'SHORTAGE' } })).resolvedAt).not.toBeNull();
    expect((await owner.api.get('/reorder')).body).toEqual([]);
  });

  it('desde el celular del empleado; un producto de otro local no', async () => {
    const emp = await createEmployee(app, owner, { name: 'Martín', perms: ['sell'] });
    const p = (await owner.api.post('/products', { name: 'Fernet', price: 100 })).body;
    expect((await emp.api.post('/stock/shortage', { productId: p.id })).status).toBe(200);
    expect(await prisma.alert.count({ where: { type: 'SHORTAGE' } })).toBe(1);

    const other = await registerOwner(app);
    const foreign = (await other.api.post('/products', { name: 'Ajeno', price: 1 })).body;
    expect((await emp.api.post('/stock/shortage', { productId: foreign.id })).status).toBe(404);
    const bad = await pos.post('/pos/sync', { events: [{ id: randomUUID(), type: 'SHORTAGE', userId: emp.id, occurredAt: at(), productId: foreign.id }] });
    expect(bad.body.results[0]).toMatchObject({ status: 'rejected', error: 'product_not_found' });
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiService } from '../src/ai';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';
import { settleJobs } from '../src/services/messages';
import { type App, createEmployee, multipart, type Owner, registerOwner, resetDb, tinyPng } from './helpers';

let app: App;
let owner: Owner;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDb();
  owner = await registerOwner(app); // dueño en chino
});
afterEach(() => vi.restoreAllMocks());

function fakeTranslator() {
  vi.spyOn(aiService, 'enabled').mockReturnValue(true);
  return vi.spyOn(aiService, 'translate').mockImplementation(async (text, from, to) => ({
    data: `[${from}->${to}] ${text}`,
    usage: { model: 'test', input: 10, output: 5 },
  }));
}

describe('indicaciones del dueño', () => {
  it('el dueño escribe en chino y el empleado lo lee en español', async () => {
    const tr = fakeTranslator();
    const emp = await createEmployee(app, owner, { lang: 'es' });
    const sent = await owner.api.post('/messages', { text: '明天八点到货', to: 'all' });
    expect(sent.status).toBe(200);
    await settleJobs();

    expect(tr).toHaveBeenCalledWith('明天八点到货', 'zh', 'es');
    const inbox = (await emp.api.get('/messages')).body;
    expect(inbox[0]).toMatchObject({ text: '明天八点到货', translationStatus: 'done', translations: { es: '[zh->es] 明天八点到货' }, from: { name: 'Li Wei' } });
    expect(await prisma.aiUsage.count()).toBe(1);
  });

  it('el empleado le escribe al dueño y le llega traducido al chino', async () => {
    fakeTranslator();
    const emp = await createEmployee(app, owner, { lang: 'es' });
    await emp.api.post('/messages', { text: 'Falta leche', to: 'owner' });
    await settleJobs();
    const inbox = (await owner.api.get('/messages')).body;
    expect(inbox[0].translations).toEqual({ zh: '[es->zh] Falta leche' });
  });

  it('un empleado no puede mandar a todo el equipo', async () => {
    const emp = await createEmployee(app, owner);
    expect((await emp.api.post('/messages', { text: 'hola', to: 'all' })).status).toBe(403);
  });

  it('sin IA el mensaje llega igual, con el texto original', async () => {
    const emp = await createEmployee(app, owner);
    await owner.api.post('/messages', { text: '你好', to: 'all' });
    await settleJobs();
    const [m] = (await emp.api.get('/messages')).body;
    expect(m).toMatchObject({ text: '你好', translationStatus: 'failed' });
  });

  it('confirmación de lectura como en WhatsApp', async () => {
    const emp = await createEmployee(app, owner, { name: 'Sofía' });
    const { id } = (await owner.api.post('/messages', { text: 'hola', to: [emp.id] })).body;
    expect((await emp.api.get('/messages/unread')).body.unread).toBe(1);
    await emp.api.post(`/messages/${id}/read`);
    const [m] = (await owner.api.get('/messages?box=sent')).body;
    expect(m.recipients[0]).toMatchObject({ name: 'Sofía', readAt: expect.any(String) });
    expect((await emp.api.get('/messages/unread')).body.unread).toBe(0);
  });

  it('tarea con foto obligatoria: sin foto no se puede cerrar; con foto sí, y la foto es privada del local', async () => {
    const emp = await createEmployee(app, owner);
    const { id } = (await owner.api.post('/messages', { text: 'Ordenar heladera', to: 'all', kind: 'TASK', requiresPhoto: true })).body;
    expect((await emp.api.get('/messages/unread')).body.openTasks).toBe(1);
    const noPhoto = await emp.api.post(`/messages/${id}/done`, {});
    expect(noPhoto.body.error).toBe('photo_required');

    const mp = multipart({ note: 'listo' }, { name: 'photo', filename: 'foto.png', type: 'image/png', data: tinyPng });
    const done = await app.inject({ method: 'POST', url: `/api/messages/${id}/done`, payload: mp.payload, headers: { ...mp.headers, cookie: emp.cookie } });
    expect(done.statusCode).toBe(200);
    const [m] = (await owner.api.get('/messages?box=sent')).body;
    expect(m).toMatchObject({ doneNote: 'listo', doneBy: 'Sofía', donePhoto: expect.stringMatching(/^\/api\/files\//) });

    expect((await owner.api.get(m.donePhoto.replace('/api', ''))).status).toBe(200);
    const other = await registerOwner(app);
    expect((await other.api.get(m.donePhoto.replace('/api', ''))).status).toBe(404);
  });
});

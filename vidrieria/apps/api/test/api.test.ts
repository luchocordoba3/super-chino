import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => [] as { endpoint: string; payload: string }[]);
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }, payload: string) => {
      if (sub.endpoint.includes('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push({ endpoint: sub.endpoint, payload });
    },
  },
}));
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';

let app: FastifyInstance;
/** Sufijo único por corrida: la base de test no se borra entre corridas. */
const run = Date.now().toString(36);
const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function signup(name: string, emailUser: string) {
  const businessName = `${name} ${run}`;
  const email = `${emailUser.split('@')[0]}-${run}@test.com`;
  const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { businessName, name: 'Dueño', email, password: 'clave1234' } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === 'vd_session')!;
  const c = `${cookie.name}=${cookie.value}`;
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: c } });
  return { cookie: c, slug: me.json().business.slug as string };
}

const call = (cookie: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { cookie }, payload: payload as object });

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('vidrierías', () => {
  it('alta con catálogo y plantillas de ejemplo; cada una ve solo lo suyo', async () => {
    const a = await signup('Vidriería Uno', 'uno@test.com');
    const b = await signup('Vidriería Dos', 'dos@test.com');
    const catA = (await call(a.cookie, 'GET', '/api/catalog')).json();
    const tplA = (await call(a.cookie, 'GET', '/api/templates')).json();
    expect(catA.length).toBeGreaterThan(20);
    expect(tplA.length).toBeGreaterThan(4);
    const res = await call(b.cookie, 'PATCH', `/api/catalog/${catA[0].id}`, { price: 1 });
    expect(res.statusCode).toBe(404);
    expect(a.slug).toBe(`vidrieria-uno-${run}`);
  });

  it('consulta desde la web -> presupuesto -> el cliente lo ve y lo acepta', async () => {
    const { cookie, slug } = await signup('Cristales Test', 'test@test.com');
    await call(cookie, 'PATCH', '/api/business', { dollarSource: 'MANUAL', dollarManual: 1000, freightPerKm: 500 });

    const lead = await app.inject({
      method: 'POST',
      url: `/api/public/site/${slug}/leads`,
      payload: { kind: 'Mampara de baño', widthCm: 120, heightCm: 180, name: 'Laura', phone: '11 5555-0101', photos: [tiny] },
    });
    expect(lead.statusCode).toBe(200);
    const leads = (await call(cookie, 'GET', '/api/leads?status=NEW')).json();
    expect(leads).toHaveLength(1);
    expect(leads[0].photoIds).toHaveLength(1);
    // La foto de la consulta es privada.
    expect((await app.inject({ method: 'GET', url: `/api/assets/${leads[0].photoIds[0]}` })).statusCode).toBe(401);
    expect((await call(cookie, 'GET', `/api/assets/${leads[0].photoIds[0]}`)).statusCode).toBe(200);

    const customer = (await call(cookie, 'POST', '/api/customers', { name: 'Laura', phone: '11 5555-0101' })).json();
    const vidrio = { name: 'Templado 8 mm', basis: 'm2', factor: 1, unitPrice: 60, currency: 'USD', applyWaste: true };
    const res = await call(cookie, 'POST', '/api/quotes', {
      customerId: customer.id,
      leadId: leads[0].id,
      title: 'Mampara',
      items: [{ title: 'Mampara', widthMm: 1200, heightMm: 1800, quantity: 1, lines: [vidrio] }],
      extras: [],
      freightKm: 10,
    });
    expect(res.statusCode).toBe(200);
    const quote = res.json();
    expect(quote.number).toBe(1);
    // 2,16 m² + 15 % × US$60 × 1000 + 10 km × 500
    expect(Number(quote.total)).toBe(149040 + 5000);
    expect((await call(cookie, 'GET', `/api/leads/${leads[0].id}`)).json().status).toBe('QUOTED');

    await call(cookie, 'POST', `/api/quotes/${quote.id}/sent`);
    // Vista previa del dueño: no lo marca como visto.
    await app.inject({ method: 'GET', url: `/api/public/quotes/${quote.publicToken}?preview=1` });
    expect((await call(cookie, 'GET', `/api/quotes/${quote.id}`)).json().status).toBe('SENT');

    const pub = await app.inject({ method: 'GET', url: `/api/public/quotes/${quote.publicToken}` });
    expect(pub.statusCode).toBe(200);
    const body = pub.json();
    expect(body.quote.total).toBe(154040);
    expect(body.quote.items[0].lines[0]).not.toHaveProperty('unitPriceArs');
    expect(JSON.stringify(body)).not.toContain('dollarRate');
    expect((await call(cookie, 'GET', `/api/quotes/${quote.id}`)).json().status).toBe('VIEWED');

    expect((await app.inject({ method: 'POST', url: `/api/public/quotes/${quote.publicToken}/accept` })).statusCode).toBe(200);
    expect((await call(cookie, 'GET', `/api/quotes/${quote.id}`)).json().status).toBe('ACCEPTED');
  });

  it('presupuesto vencido no se puede aceptar', async () => {
    const { cookie } = await signup('Vidriería Tres', 'tres@test.com');
    const q = (
      await call(cookie, 'POST', '/api/quotes', {
        items: [],
        extras: [{ name: 'Medición', basis: 'fijo', factor: 1, unitPrice: 15000, currency: 'ARS', applyWaste: false }],
      })
    ).json();
    await call(cookie, 'POST', `/api/quotes/${q.id}/sent`);
    await prisma.quote.update({ where: { id: q.id }, data: { validUntil: new Date(Date.now() - 1000) } });
    const res = await app.inject({ method: 'POST', url: `/api/public/quotes/${q.publicToken}/accept` });
    expect(res.statusCode).toBe(409);
    expect((await call(cookie, 'GET', `/api/quotes/${q.id}`)).json().status).toBe('EXPIRED');
  });

  it('importa la lista del proveedor y sube precios por %', async () => {
    const { cookie } = await signup('Vidriería Cuatro', 'cuatro@test.com');
    const imp = await call(cookie, 'POST', '/api/catalog/import', [
      { name: 'Templado 8 mm', price: 80, currency: 'USD', unit: 'M2', category: 'VIDRIO' },
      { name: 'Float gris 4 mm', price: 30, currency: 'USD', unit: 'M2', category: 'VIDRIO' },
    ]);
    expect(imp.json()).toEqual({ created: 1, updated: 1 });
    await call(cookie, 'POST', '/api/catalog/bulk-price', { pct: 10, currency: 'USD', category: 'VIDRIO' });
    const cat = (await call(cookie, 'GET', '/api/catalog')).json() as { name: string; price: number }[];
    expect(cat.find((c) => c.name === 'Templado 8 mm')!.price).toBe(88);
    expect(cat.find((c) => c.name === 'Float gris 4 mm')!.price).toBe(33);
  });

  it('la web pública no expone datos internos', async () => {
    const { slug } = await signup('Vidriería Cinco', 'cinco@test.com');
    const res = await app.inject({ method: 'GET', url: `/api/public/site/${slug}` });
    expect(res.statusCode).toBe(200);
    const text = res.body;
    expect(text).not.toContain('dollarManual');
    expect(text).not.toContain('wastePct');
  });
});

const vidrioUsd = { name: 'Templado 8 mm', basis: 'm2', factor: 1, unitPrice: 60, currency: 'USD', applyWaste: true, unitCost: 40 };
const kitArs = { name: 'Kit', basis: 'unidad', factor: 1, unitPrice: 50000, currency: 'ARS', applyWaste: false };
const item = (lines: object[]) => ({ title: 'Mampara', widthMm: 1200, heightMm: 1800, quantity: 1, lines });
const waitFor = async (fn: () => boolean) => {
  for (let i = 0; i < 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe('ideas del panel', () => {
  it('opciones: el cliente elige la B, la acepta, sube el comprobante y el dueño confirma el cobro', async () => {
    const { cookie } = await signup('Opciones', 'opciones@test.com');
    await call(cookie, 'PATCH', '/api/business', { dollarSource: 'MANUAL', dollarManual: 1000, payAlias: 'cristales.ariel', payHolder: 'Ariel' });
    const res = await call(cookie, 'POST', '/api/quotes', {
      title: 'Mampara',
      items: [],
      extras: [],
      options: [
        { label: 'Simple', items: [item([vidrioUsd])], extras: [] },
        { label: 'Premium', items: [item([vidrioUsd, kitArs])], extras: [], discount: 1000 },
      ],
    });
    expect(res.statusCode).toBe(200);
    const q = res.json();
    expect(q.options).toHaveLength(2);
    expect(Number(q.total)).toBe(149040);
    // Ganancia: 2,484 m² × US$40 × 1000 de costo
    expect(q.result.cost).toBe(99360);
    expect(q.result.profit).toBe(149040 - 99360);

    const pub = (await app.inject({ method: 'GET', url: `/api/public/quotes/${q.publicToken}` })).json();
    expect(pub.quote.options.map((o: { label: string; total: number }) => [o.label, o.total])).toEqual([
      ['Simple', 149040],
      ['Premium', 149040 + 50000 - 1000],
    ]);
    expect(JSON.stringify(pub)).not.toMatch(/cost|profit|unitPrice/);
    expect(pub.business.pay.alias).toBe('cristales.ariel');

    // Antes de aceptar no se puede subir comprobante.
    expect((await app.inject({ method: 'POST', url: `/api/public/quotes/${q.publicToken}/deposit`, payload: { file: tiny } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/public/quotes/${q.publicToken}/accept`, payload: { option: 1 } })).statusCode).toBe(200);
    const acc = (await call(cookie, 'GET', `/api/quotes/${q.id}`)).json();
    expect(acc.status).toBe('ACCEPTED');
    expect(acc.chosenOption).toBe(1);
    expect(Number(acc.total)).toBe(198040);
    const after = (await app.inject({ method: 'GET', url: `/api/public/quotes/${q.publicToken}` })).json().quote;
    expect(after.options).toBeNull();
    expect(after.chosenLabel).toBe('Premium');

    const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 comprobante').toString('base64');
    expect((await app.inject({ method: 'POST', url: `/api/public/quotes/${q.publicToken}/deposit`, payload: { file: pdf } })).statusCode).toBe(200);
    let dash = (await call(cookie, 'GET', '/api/dashboard')).json();
    expect(dash.depositsToConfirm.map((d: { id: string }) => d.id)).toEqual([q.id]);
    const withProof = (await call(cookie, 'GET', `/api/quotes/${q.id}`)).json();
    expect((await call(cookie, 'GET', `/api/assets/${withProof.depositProofId}`)).headers['content-type']).toBe('application/pdf');
    expect((await app.inject({ method: 'GET', url: `/api/assets/${withProof.depositProofId}` })).statusCode).toBe(401);

    expect((await call(cookie, 'POST', `/api/quotes/${q.id}/deposit-paid`, { paid: true })).statusCode).toBe(200);
    dash = (await call(cookie, 'GET', '/api/dashboard')).json();
    expect(dash.depositsToConfirm).toHaveLength(0);
    expect(dash.month.depositsPaid).toBe(acc.deposit);
    expect(dash.month.count).toBe(1);
    expect(dash.toBuy).toBe(1);

    // Lista de compras: aparece y se marca como comprada.
    const buy = (await call(cookie, 'GET', '/api/purchases')).json();
    expect(buy.map((b: { id: string }) => b.id)).toEqual([q.id]);
    expect((await call(cookie, 'POST', '/api/purchases/mark', { ids: [q.id] })).json().count).toBe(1);
    expect((await call(cookie, 'GET', '/api/purchases')).json()).toHaveLength(0);
  });

  it('subió el dólar: Inicio lo avisa y "actualizar" lo pasa al dólar de hoy', async () => {
    const { cookie } = await signup('Dolar', 'dolar@test.com');
    await call(cookie, 'PATCH', '/api/business', { dollarSource: 'MANUAL', dollarManual: 1000, dollarAlertPct: 3 });
    const q = (await call(cookie, 'POST', '/api/quotes', { title: 'Mampara', items: [item([vidrioUsd, kitArs])], extras: [] })).json();
    await call(cookie, 'POST', `/api/quotes/${q.id}/sent`);
    await call(cookie, 'PATCH', '/api/business', { dollarManual: 1020 });
    // +2 % del dólar: no llega al 3 % de alerta.
    expect((await call(cookie, 'GET', '/api/dashboard')).json().dollarStale).toHaveLength(0);
    await call(cookie, 'PATCH', '/api/business', { dollarManual: 1100 });
    const stale = (await call(cookie, 'GET', '/api/dashboard')).json().dollarStale;
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ id: q.id, total: 199040, newTotal: Math.round(2.484 * 60 * 1100) + 50000 });

    const up = (await call(cookie, 'POST', `/api/quotes/${q.id}/redollar`)).json();
    expect(Number(up.dollarRate)).toBe(1100);
    expect(up.status).toBe('SENT');
    expect((await call(cookie, 'GET', '/api/dashboard')).json().dollarStale).toHaveLength(0);
  });

  it('avisos: cuenta las vistas del cliente (no la del dueño) y avisa al celular', async () => {
    const { cookie, slug } = await signup('Avisos', 'avisos@test.com');
    const ep = `https://push.example.com/${run}`;
    expect((await call(cookie, 'POST', '/api/push/subscribe', { endpoint: ep, keys: { p256dh: 'k', auth: 'a' } })).statusCode).toBe(200);
    await call(cookie, 'POST', '/api/push/subscribe', { endpoint: `https://push.example.com/gone-${run}`, keys: { p256dh: 'k', auth: 'a' } });
    expect((await call(cookie, 'GET', '/api/push/key')).json().publicKey).toMatch(/^[\w-]{80,}$/);

    const customer = (await call(cookie, 'POST', '/api/customers', { name: 'Juan', phone: '1155550000' })).json();
    const q = (await call(cookie, 'POST', '/api/quotes', { customerId: customer.id, title: 'Espejo', items: [item([kitArs])], extras: [] })).json();
    await call(cookie, 'POST', `/api/quotes/${q.id}/sent`);

    // El dueño logueado lo abre: no cuenta.
    await call(cookie, 'GET', `/api/public/quotes/${q.publicToken}`);
    expect((await call(cookie, 'GET', `/api/quotes/${q.id}`)).json().viewCount).toBe(0);

    await app.inject({ method: 'GET', url: `/api/public/quotes/${q.publicToken}` });
    await app.inject({ method: 'GET', url: `/api/public/quotes/${q.publicToken}` }); // recarga: no suma
    const seen = (await call(cookie, 'GET', `/api/quotes/${q.id}`)).json();
    expect(seen.viewCount).toBe(1);
    expect(seen.status).toBe('VIEWED');
    await waitFor(() => sent.some((s) => s.endpoint === ep));
    expect(JSON.parse(sent.find((s) => s.endpoint === ep)!.payload)).toMatchObject({ title: 'Juan está mirando tu presupuesto', url: `/panel/presupuestos/${q.id}` });
    // El celular que ya no existe se borra.
    await waitFor(() => false);
    expect(await prisma.pushSubscription.count({ where: { endpoint: { contains: `gone-${run}` } } })).toBe(0);

    await app.inject({ method: 'POST', url: `/api/public/site/${slug}/leads`, payload: { kind: 'Espejo', name: 'Ana', phone: '1155551111' } });
    await waitFor(() => sent.some((s) => s.payload.includes('Consulta nueva')));
    expect(sent.some((s) => s.payload.includes('Espejo · Ana'))).toBe(true);
  });

  it('fotos de la medición: privadas y guardadas en el presupuesto', async () => {
    const { cookie } = await signup('Medicion', 'medicion@test.com');
    const photo = (await call(cookie, 'POST', '/api/assets', { dataUrl: tiny, kind: 'quote' })).json();
    expect((await app.inject({ method: 'GET', url: photo.url })).statusCode).toBe(401);
    const q = (await call(cookie, 'POST', '/api/quotes', { title: 'Medición', items: [item([kitArs])], extras: [], photoIds: [photo.id, 'otro-id'] })).json();
    expect(q.photoIds).toEqual([photo.id]);
  });
});

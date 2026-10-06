import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => {
  process.env.IMAGE_API_KEY ||= 'test-image-key';
  return [] as { endpoint: string; payload: string }[];
});
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

describe('planes y trabajos', () => {
  it('el plan corta lo que no incluye y el admin de Lumina lo cambia', async () => {
    const a = await signup('Plan Inicial', 'plan@test.com');
    const me = (await call(a.cookie, 'GET', '/api/auth/me')).json();
    expect(me.business.plan).toBe('COMPLETO');
    expect(me.isAdmin).toBe(false);
    await prisma.business.update({ where: { id: me.business.id }, data: { plan: 'INICIAL' } });
    const r = await call(a.cookie, 'GET', '/api/jobs');
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toBe('Disponible en el plan Profesional');
    expect((await call(a.cookie, 'GET', '/api/purchases')).statusCode).toBe(403);
    expect((await call(a.cookie, 'GET', '/api/admin/businesses')).statusCode).toBe(403);

    const admin = await signup('Lumina', 'admin@test.com');
    const adminEmail = (await call(admin.cookie, 'GET', '/api/auth/me')).json().user.email;
    process.env.LUMINA_ADMINS = `otro@test.com, ${adminEmail}`;
    const list = (await call(admin.cookie, 'GET', '/api/admin/businesses')).json();
    expect(list.some((b: { id: string }) => b.id === me.business.id)).toBe(true);
    expect((await call(admin.cookie, 'PATCH', `/api/admin/businesses/${me.business.id}`, { plan: 'PROFESIONAL' })).json().plan).toBe('PROFESIONAL');
    expect((await call(a.cookie, 'GET', '/api/jobs')).statusCode).toBe(200);
    delete process.env.LUMINA_ADMINS;
  });

  it('aceptado → trabajo → pedido con fecha prometida → agenda → el colocador termina → stock y garantía', async () => {
    const { cookie } = await signup('Trabajos', 'trabajos@test.com');
    await call(cookie, 'PATCH', '/api/business', { dollarSource: 'MANUAL', dollarManual: 1000 });
    const catalog = (await call(cookie, 'GET', '/api/catalog')).json();
    const temp8 = catalog.find((c: { name: string }) => c.name === 'Templado 8 mm');
    const kit = catalog.find((c: { name: string }) => c.name === 'Kit mampara corrediza');
    await call(cookie, 'PATCH', `/api/stock/${kit.id}`, { stockQty: 5, stockMin: 2 });
    const customer = (await call(cookie, 'POST', '/api/customers', { name: 'Marta', phone: '1155550101', address: 'Mitre 123, Villa Ballester' })).json();
    const line = (c: { id: string; name: string; price: number; currency: string }, basis: string, applyWaste: boolean) => ({
      catalogItemId: c.id,
      name: c.name,
      basis,
      factor: 1,
      unitPrice: Number(c.price),
      currency: c.currency,
      applyWaste,
    });
    const q = (
      await call(cookie, 'POST', '/api/quotes', {
        customerId: customer.id,
        title: 'Mampara',
        items: [{ title: 'Mampara', widthMm: 1200, heightMm: 1800, quantity: 1, lines: [line(temp8, 'm2', true), line(kit, 'unidad', false)] }],
        extras: [],
      })
    ).json();
    await app.inject({ method: 'POST', url: `/api/public/quotes/${q.publicToken}/accept`, payload: {} });

    const [job] = (await call(cookie, 'GET', '/api/jobs')).json();
    expect(job).toMatchObject({ status: 'PENDING', needsFactory: true, address: 'Mitre 123, Villa Ballester', quote: { number: q.number } });

    const ordered = (await call(cookie, 'POST', `/api/jobs/${job.id}/status`, { status: 'ORDERED' })).json();
    const days = (new Date(ordered.promisedAt).getTime() - new Date(ordered.orderedAt).getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(14); // 10 días hábiles = 2 semanas corridas
    expect(new Date(ordered.promisedAt).getDay()).not.toBe(0);

    const crew = (await call(cookie, 'POST', '/api/crews', { name: 'Equipo 1', members: 'Juan, Pedro', dayRate: 40000 })).json();
    const when = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const scheduled = (await call(cookie, 'PATCH', `/api/jobs/${job.id}`, { scheduledAt: when, crewId: crew.id })).json();
    expect(scheduled.status).toBe('SCHEDULED');

    // Ficha del colocador, sin login
    const sheet = (await app.inject({ method: 'GET', url: `/api/public/jobs/${job.crewToken}` })).json();
    expect(sheet.pieces[0]).toMatchObject({ glass: 'Templado 8 mm', weightKg: 43.2 });
    expect(sheet.crew).toBe('Equipo 1');
    expect((await app.inject({ method: 'POST', url: `/api/public/jobs/${job.crewToken}/photos`, payload: { kind: 'after', photos: [tiny] } })).json().count).toBe(1);
    expect((await app.inject({ method: 'POST', url: `/api/public/jobs/${job.crewToken}/done`, payload: { checklist: { medidas: true } } })).statusCode).toBe(200);

    const done = (await call(cookie, 'GET', `/api/jobs/${job.id}`)).json();
    expect(done.status).toBe('INSTALLED');
    expect(done.afterIds).toHaveLength(1);
    expect(Number((await prisma.catalogItem.findUniqueOrThrow({ where: { id: kit.id } })).stockQty)).toBe(4);

    const w = (await app.inject({ method: 'GET', url: `/api/public/warranty/${job.warrantyToken}` })).json();
    expect(w.warrantyMonths).toBe(12);
    expect(new Date(w.until).getFullYear()).toBe(new Date(done.installedAt).getFullYear() + 1);
    expect(JSON.stringify(w)).not.toMatch(/phone|total|price/);

    // Retazo: se carga y se usa
    const rem = (await call(cookie, 'POST', '/api/remnants', { catalogItemId: temp8.id, glassName: temp8.name, widthMm: 700, heightMm: 900 })).json();
    expect((await call(cookie, 'GET', '/api/remnants')).json().map((r: { id: string }) => r.id)).toContain(rem.id);
    await call(cookie, 'POST', `/api/remnants/${rem.id}/use`, { quoteId: q.id });
    expect((await call(cookie, 'GET', '/api/remnants')).json().map((r: { id: string }) => r.id)).not.toContain(rem.id);
  });
});

describe('plata', () => {
  const mampara = (deposit = false) => ({
    title: 'Mampara',
    items: [item([kitArs])],
    extras: [],
    ...(deposit ? {} : {}),
  });

  it('caja: neto por medio, seña a la caja, cuentas por cobrar, jornales, gastos y monotributo', async () => {
    const { cookie } = await signup('Caja', 'caja@test.com');
    await call(cookie, 'PATCH', '/api/business', { payFees: { CREDITO: 5.99 }, monotributoCategory: 'K' });
    const customer = (await call(cookie, 'POST', '/api/customers', { name: 'Constructora', phone: '1155550000', type: 'CONSTRUCTORA' })).json();
    const q = (await call(cookie, 'POST', '/api/quotes', { ...mampara(), customerId: customer.id })).json();
    await call(cookie, 'POST', `/api/quotes/${q.id}/status`, { status: 'ACCEPTED' });
    // Seña cobrada por transferencia: entra a la caja.
    await call(cookie, 'POST', `/api/quotes/${q.id}/deposit-paid`, { paid: true, method: 'TRANSFERENCIA' });
    // Parte del saldo con crédito: se descuenta la comisión.
    const credit = (await call(cookie, 'POST', '/api/payments', { quoteId: q.id, kind: 'SALDO', method: 'CREDITO', amount: 10000 })).json();
    expect(Number(credit.net)).toBe(9401);
    const pays = (await call(cookie, 'GET', '/api/payments')).json();
    expect(pays.map((p: { kind: string }) => p.kind).sort()).toEqual(['SALDO', 'SENA']);

    const rec = (await call(cookie, 'GET', '/api/receivables')).json();
    expect(rec[0].customer.name).toBe('Constructora');
    expect(rec[0].due).toBe(50000 - 25000 - 10000);

    const crew = (await call(cookie, 'POST', '/api/crews', { name: 'Equipo', members: 'Juan, Yamil y Pedro', dayRate: 40000 })).json();
    expect((await call(cookie, 'POST', '/api/workdays/crew', { crewId: crew.id, date: new Date().toISOString() })).json().count).toBe(3);
    await call(cookie, 'POST', '/api/expenses', { category: 'ALQUILER', amount: 300000, date: new Date().toISOString(), recurring: true });
    await call(cookie, 'POST', '/api/invoices/manual', { ptoVta: 1, number: 15, date: new Date().toISOString(), amount: 1_000_000 });

    const n = (await call(cookie, 'GET', '/api/numbers')).json();
    expect(n.monotributo).toMatchObject({ category: 'K', cap: 126610838.75, invoiced: 1_000_000, banked: 35000 });
    expect(n.month).toMatchObject({ income: 35000, wages: 120000, expenses: 300000 });
    expect(n.cashflow30).toMatchObject({ receivable: 15000, fixed: 300000 });
  });

  it('Mercado Pago: el cliente paga la seña con el link y el aviso la registra una sola vez', async () => {
    const { cookie } = await signup('MP', 'mp@test.com');
    await call(cookie, 'PATCH', '/api/business', { mpAccessToken: 'APP_USR-test' });
    const biz = (await call(cookie, 'GET', '/api/business')).json();
    expect(biz.mpConnected).toBe(true);
    expect(JSON.stringify(biz)).not.toContain('APP_USR');
    const q = (await call(cookie, 'POST', '/api/quotes', mampara())).json();
    await app.inject({ method: 'POST', url: `/api/public/quotes/${q.publicToken}/accept`, payload: {} });
    expect((await app.inject({ method: 'GET', url: `/api/public/quotes/${q.publicToken}` })).json().business.mp).toBe(true);

    const calls: string[] = [];
    const mpId = String(Date.now()); // los ids de Mercado Pago son únicos: uno por corrida
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const u = String(url);
      calls.push(`${init?.method ?? 'GET'} ${u}`);
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer APP_USR-test');
      if (u.endsWith('/checkout/preferences')) {
        const body = JSON.parse(String(init?.body));
        expect(body.items[0].unit_price).toBe(25000);
        expect(body.external_reference).toBe(`${q.id}:SENA`);
        return new Response(JSON.stringify({ id: 'pref1', init_point: 'https://mp.test/pagar' }), { status: 201 });
      }
      return new Response(JSON.stringify({ id: Number(mpId), status: 'approved', external_reference: `${q.id}:SENA`, transaction_amount: 25000, date_approved: new Date().toISOString(), transaction_details: { net_received_amount: 24000 } }));
    });
    try {
      const link = (await app.inject({ method: 'POST', url: `/api/public/quotes/${q.publicToken}/mp`, payload: { kind: 'SENA' } })).json();
      expect(link.url).toBe('https://mp.test/pagar');
      const biz2 = (await call(cookie, 'GET', '/api/auth/me')).json().business;
      for (let i = 0; i < 2; i++) await app.inject({ method: 'POST', url: `/api/public/mp/${biz2.id}`, payload: { type: 'payment', data: { id: mpId } } });
    } finally {
      spy.mockRestore();
    }
    const pays = await prisma.payment.findMany({ where: { quoteId: q.id } });
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ method: 'MERCADOPAGO', mpPaymentId: mpId });
    expect(Number(pays[0].net)).toBe(24000);
    expect((await call(cookie, 'GET', `/api/quotes/${q.id}`)).json().depositPaidAt).not.toBeNull();
    expect(calls.filter((c) => c.includes(`/v1/payments/${mpId}`))).toHaveLength(1);
  });

  it('ARCA: firma el pedido con el certificado y emite la factura C con CAE', async () => {
    const forge = (await import('node-forge')).default;
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 86_400_000);
    cert.validity.notAfter = new Date(Date.now() + 86_400_000 * 365);
    cert.setSubject([{ name: 'commonName', value: 'vidrieria' }]);
    cert.setIssuer([{ name: 'commonName', value: 'vidrieria' }]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const certPem = forge.pki.certificateToPem(cert);
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

    const { cookie } = await signup('ARCA', 'arca@test.com');
    expect((await call(cookie, 'PATCH', '/api/business', { arcaCert: 'basura' })).statusCode).toBe(400);
    await call(cookie, 'PATCH', '/api/business', { arcaCuit: '20-12345678-9', arcaPtoVta: 3, arcaCert: certPem, arcaKey: keyPem });
    expect((await call(cookie, 'GET', '/api/business')).json().arcaReady).toBe(true);
    const { resetArcaTickets } = await import('../src/services/arca');
    resetArcaTickets();

    let fecae = '';
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const body = String(init?.body);
      if (String(url).includes('LoginCms')) {
        const cms = body.match(/<wsaa:in0>([^<]+)</)![1];
        // El CMS es DER válido y lleva adentro el pedido de acceso al servicio de facturas.
        forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.decode64(cms)));
        expect(forge.util.decode64(cms)).toContain('<service>wsfe</service>');
        const ret = '<loginTicketResponse><credentials><token>TOK</token><sign>SIG</sign></credentials><header><expirationTime>2099-01-01T00:00:00Z</expirationTime></header></loginTicketResponse>'.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return new Response(`<soapenv:Envelope><soapenv:Body><loginCmsResponse><loginCmsReturn>${ret}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`);
      }
      if (body.includes('FECompUltimoAutorizado')) {
        expect(body).toContain('<ar:Cuit>20123456789</ar:Cuit>');
        return new Response('<soap:Envelope><soap:Body><FECompUltimoAutorizadoResult><PtoVta>3</PtoVta><CbteTipo>11</CbteTipo><CbteNro>7</CbteNro></FECompUltimoAutorizadoResult></soap:Body></soap:Envelope>');
      }
      fecae = body;
      return new Response('<soap:Envelope><soap:Body><FECAESolicitarResult><FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>76123456789012</CAE><CAEFchVto>20261020</CAEFchVto></FECAEDetResponse></FeDetResp></FECAESolicitarResult></soap:Body></soap:Envelope>');
    });
    try {
      const inv = (await call(cookie, 'POST', '/api/invoices/arca', { amount: 491885.5, customerName: 'Laura' })).json();
      expect(inv).toMatchObject({ ptoVta: 3, number: 8, cae: '76123456789012', type: 'C' });
      expect(fecae).toContain('<ar:CbteTipo>11</ar:CbteTipo>');
      expect(fecae).toContain('<ar:ImpTotal>491885.50</ar:ImpTotal>');
      expect(fecae).toContain('<ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('ajustes', () => {
  it('guarda el ajuste por tipo de cliente aunque no estén todos los tipos', async () => {
    const { cookie } = await signup('Ajustes', 'ajustes@test.com');
    const r = await call(cookie, 'PATCH', '/api/business', { customerAdjust: { VIDRIERIA: -10 } });
    expect(r.statusCode).toBe(200);
    expect(r.json().customerAdjust).toEqual({ VIDRIERIA: -10 });
  });
});

describe('vender', () => {
  const floatMampara = { title: 'Mampara corrediza', widthMm: 1200, heightMm: 1800, quantity: 1, lines: [{ name: 'Float incoloro 6 mm', basis: 'm2', factor: 1, unitPrice: 30000, currency: 'ARS', applyWaste: true }] };

  it('vidrio común en una mampara: el cliente tiene que confirmar antes de aceptar', async () => {
    const { cookie } = await signup('Seguridad', 'seguridad@test.com');
    const q = (await call(cookie, 'POST', '/api/quotes', { title: 'Mampara', items: [floatMampara], extras: [] })).json();
    const url = `/api/public/quotes/${q.publicToken}/accept`;
    const no = await app.inject({ method: 'POST', url, payload: {} });
    expect(no.statusCode).toBe(409);
    expect(no.json().error).toBe('safety_ack_required');
    expect((await app.inject({ method: 'POST', url, payload: { safetyAck: true } })).statusCode).toBe(200);
    expect((await call(cookie, 'GET', `/api/quotes/${q.id}`)).json().safetyAckAt).not.toBeNull();
  });

  it('prueba de precio: la mitad sale con recargo y queda marcada', async () => {
    const { cookie } = await signup('Precio', 'precio@test.com');
    await call(cookie, 'PATCH', '/api/business', { priceTestPct: 10 });
    const qs = [];
    for (let i = 0; i < 12; i++) qs.push((await call(cookie, 'POST', '/api/quotes', { title: 'Espejo', items: [item([kitArs])], extras: [] })).json());
    const b = qs.filter((q) => q.priceVariant === 'B');
    const a = qs.filter((q) => q.priceVariant === 'A');
    expect(a.length + b.length).toBe(12);
    for (const q of b) expect(Number(q.total)).toBe(55000);
    for (const q of a) expect(Number(q.total)).toBe(50000);
  });

  it('origen de la consulta: cartel, recomendación, Google y urgencias', async () => {
    const { cookie, slug } = await signup('Origen', 'origen@test.com');
    const me = (await call(cookie, 'GET', '/api/auth/me')).json();
    const sign = await prisma.sign.create({ data: { businessId: me.business.id, code: `c${run}`, name: 'Obra Mitre' } });
    const referrer = await prisma.customer.create({ data: { businessId: me.business.id, name: 'Laura', referralCode: `r${run}` } });
    const lead = (p: object) => app.inject({ method: 'POST', url: `/api/public/site/${slug}/leads`, payload: { kind: 'Espejo', name: 'Ana', phone: '1155551111', ...p } });
    await lead({ sign: sign.code });
    await lead({ ref: referrer.referralCode });
    await lead({ referrer: 'https://www.google.com/' });
    await lead({ kind: 'Cambio de vidrio roto', when: 'Urgente' });
    const leads = await prisma.lead.findMany({ where: { businessId: me.business.id }, orderBy: { createdAt: 'asc' } });
    expect(leads.map((l) => l.source)).toEqual(['CARTEL', 'RECOMENDACION', 'GOOGLE', 'WEB']);
    expect(leads[0].signId).toBe(sign.id);
    expect(leads[1].refCode).toBe(referrer.referralCode);
    expect(leads.map((l) => l.urgent)).toEqual([false, false, false, true]);
  });

  it('formato para la aseguradora, cuotas en el link y foto "así quedaría"', async () => {
    const { cookie } = await signup('Seguro', 'seguro@test.com');
    await call(cookie, 'PATCH', '/api/business', { installmentRates: { '3': 10 } });
    const q = (await call(cookie, 'POST', '/api/quotes', { title: 'Mampara', items: [item([vidrioUsd, kitArs])], extras: [] })).json();
    await call(cookie, 'PUT', `/api/quotes/${q.id}/insurance`, { company: 'La Segunda', claim: 'S-123' });
    const pub = (await app.inject({ method: 'GET', url: `/api/public/quotes/${q.publicToken}?seguro=1&preview=1` })).json();
    expect(pub.insurance.claim).toMatchObject({ company: 'La Segunda', claim: 'S-123' });
    expect(pub.insurance.items[0].lines[1]).toMatchObject({ name: 'Kit', unitPrice: 50000 });
    expect(pub.business.installments).toEqual({ '3': 10 });
    expect((await app.inject({ method: 'GET', url: `/api/public/quotes/${q.publicToken}?preview=1` })).json().insurance).toBeNull();

    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      expect(String(url)).toContain('generativelanguage.googleapis.com');
      expect(JSON.parse(String(init?.body)).contents[0].parts[0].text).toContain('mampara');
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: tiny.split(',')[1] } }] } }] }));
    });
    try {
      const r = (await call(cookie, 'POST', `/api/quotes/${q.id}/render`, { photo: tiny })).json();
      expect(r.url).toMatch(/^\/api\/assets\//);
      expect((await app.inject({ method: 'GET', url: r.url })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: `/api/public/quotes/${q.publicToken}?preview=1` })).json().quote.renders).toEqual([r.url]);
      expect((await call(cookie, 'GET', '/api/render/status')).json()).toMatchObject({ enabled: true, used: 1, quota: 100 });
    } finally {
      spy.mockRestore();
    }
  });

  it('edificios de un consorcio con sus vidrios', async () => {
    const { cookie } = await signup('Consorcio', 'consorcio@test.com');
    const c = (await call(cookie, 'POST', '/api/customers', { name: 'Adm. Pérez', type: 'CONSORCIO' })).json();
    const bld = (await call(cookie, 'POST', '/api/buildings', { customerId: c.id, name: 'Edificio Mitre 1200', glasses: [{ place: 'Puerta de entrada', widthMm: 900, heightMm: 2100, glass: 'Laminado 5+5' }] })).json();
    expect(bld.glasses).toHaveLength(1);
    expect((await call(cookie, 'GET', `/api/buildings?customerId=${c.id}`)).json()[0].name).toBe('Edificio Mitre 1200');
  });
});

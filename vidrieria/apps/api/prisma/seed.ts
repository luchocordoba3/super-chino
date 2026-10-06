/**
 * Demo: Cristales Ariel (Villa Ballester). No duplica: si ya existe, no hace nada (con --reset la vuelve a crear).
 * Precios de ejemplo: Ariel los reemplaza por los suyos desde el panel.
 */
import type { ExpenseCategory, LeadSource, PayKind, PayMethod, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { calcQuote, linesFromTemplate, netOf, type QuoteBody, type QuoteInput, type QuoteSettings, type TemplateLine } from '@vidrieria/shared';
import { num, prisma } from '../src/db';
import { ensureJob } from '../src/services/jobs';
import { createQuote } from '../src/services/quotes';
import { defaultSite, loadStarterKit } from '../src/services/starter';

const SLUG = 'cristales-ariel';
const DEMO_EMAIL = 'ariel@demo.com';
/** Subir este número cuando la demo cambie: al publicar se vuelve a crear sola (solo si sigue siendo la demo). */
export const DEMO_VERSION = 3;

/** ¿Existe la demo y quedó vieja? Nunca toca una cuenta real: tiene que tener la marca de demo y el usuario de demo. */
export async function demoOutdated() {
  const b = await prisma.business.findUnique({ where: { slug: SLUG }, include: { users: { where: { email: DEMO_EMAIL } } } });
  if (!b || !b.users.length) return false;
  // La primera demo no tenía marca: cuenta como versión 1.
  const v = (b.site as { demoVersion?: number }).demoVersion ?? 1;
  return v < DEMO_VERSION;
}

/** Comprobante de transferencia de ejemplo (PDF mínimo armado a mano). */
function demoReceipt(amount: string) {
  const text = `BT /F1 20 Tf 50 760 Td (Comprobante de transferencia) Tj /F1 13 Tf 0 -36 Td (Importe: ${amount}) Tj 0 -22 Td (Destino: cristales.ariel) Tj 0 -22 Td (Concepto: Sena presupuesto) Tj 0 -22 Td (Operacion de ejemplo - demo) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Imágenes ilustrativas generadas con Higgsfield (hasta tener las fotos reales de Ariel). */
const CDN = 'https://d8j0ntlcm91z4.cloudfront.net/user_3Hq3BUFDflm9iqDmd7XPa8cr6Rw/';
const IMG = {
  hero: CDN + 'hf_20261006_005353_e6806973-7d51-4a69-ac82-21e9d2a627b1.png',
  mampara: CDN + 'hf_20261006_005354_41076835-e2f7-45dd-bb6c-f19b6da0aa66.png',
  baranda: CDN + 'hf_20261006_005353_3a3ebe5d-5c52-4c82-b5e0-cde6a9170da1.png',
  cambio: CDN + 'hf_20261006_005413_4befdefa-5f4d-4809-b95d-c9364016923d.png',
  espejo: CDN + 'hf_20261006_005414_73487843-27d5-40a4-9f62-d4e8d3163a40.png',
  templado: CDN + 'hf_20261006_005354_dd7247a0-456b-49fb-b304-f95949ab5f57.png',
  frente: CDN + 'hf_20261006_005413_43be6cc3-5567-48f7-8f59-a2bc0ce74b9b.png',
  // Pares para la foto con IA ("Así quedaría"): la foto del cliente y cómo quedaría.
  bathBefore: CDN + 'hf_20261006_215249_a208f1d4-8364-4afe-8487-437d2eb8f98e.png',
  bathAfter: CDN + 'hf_20261006_215333_dc66400a-c4ef-467e-ba1e-664411c953be.png',
  stairsBefore: CDN + 'hf_20261006_215302_1d852d94-0a8d-4549-81fa-3179c4db7c13.png',
  stairsAfter: CDN + 'hf_20261006_215338_fd543c6c-b899-45d5-a17e-b1bde206d557.png',
};
const DAY = 86_400_000;

/** Baja fotos de ejemplo y las guarda como si las hubiera subido el colocador. Sin conexión, el trabajo queda sin fotos. */
async function demoPhotos(bid: string, urls: string[]) {
  const ids: (string | null)[] = [];
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(String(r.status));
      const data = Buffer.from(await r.arrayBuffer());
      ids.push((await prisma.asset.create({ data: { businessId: bid, mime: r.headers.get('content-type') ?? 'image/png', data, size: data.length, kind: 'job', public: false } })).id);
    } catch {
      ids.push(null);
    }
  }
  return ids;
}

const randomCode = () => Math.random().toString(36).slice(2, 8);

export async function seedDemo({ reset = false } = {}) {
  const existing = await prisma.business.findUnique({ where: { slug: SLUG } });
  if (existing && !reset) return { created: false };
  if (existing) {
    await prisma.user.deleteMany({ where: { businessId: existing.id } });
    await prisma.business.delete({ where: { id: existing.id } });
  }

  const zones = 'CABA y zona norte';
  const site = {
    ...defaultSite('Cristales Ariel', zones),
    demoVersion: DEMO_VERSION,
    headline: 'Vidrios, mamparas y espejos a medida',
    subheadline: 'Medimos, fabricamos e instalamos en CABA y zona norte, en menos de una semana. Pedí tu presupuesto y te respondemos por WhatsApp.',
    heroImage: IMG.hero,
    illustrativeImages: true,
    faqs: [
      { q: '¿Cuánto tardan en instalar?', a: 'Menos de una semana desde que confirmás el presupuesto.' },
      { q: '¿Cómo se paga?', a: 'Efectivo, transferencia, Mercado Pago o cheque. Para empezar se deja una seña del 50 %.' },
      { q: '¿Hasta dónde llegan?', a: 'Trabajamos en CABA y alrededores. El traslado se calcula según la distancia.' },
      { q: '¿Trabajan con constructoras y arquitectos?', a: 'Sí, hacemos obras completas y también vendemos a otras vidrierías.' },
      { q: '¿Hacen factura?', a: 'Sí, hacemos factura.' },
    ],
  };
  const images = [IMG.mampara, IMG.baranda, IMG.cambio, IMG.espejo, IMG.templado, IMG.frente];
  site.services = site.services.map((s, i) => ({ ...s, image: images[i] ?? null }));
  site.gallery = [
    { image: IMG.hero, caption: 'Escalera con baranda de vidrio laminado', kind: 'Baranda / escalera de vidrio', zone: 'Villa Ballester' },
    { image: IMG.mampara, caption: 'Mampara corrediza en templado 8 mm', kind: 'Mampara corrediza', zone: 'Villa Urquiza' },
    { image: IMG.baranda, caption: 'Baranda de vidrio en balcón', kind: 'Baranda / escalera de vidrio', zone: 'Belgrano' },
    { image: IMG.espejo, caption: 'Espejo a medida con cantos pulidos', kind: 'Espejo a medida', zone: 'San Martín' },
  ];

  const passwordHash = await bcrypt.hash('demo1234', 10);
  const b = await prisma.$transaction(async (tx) => {
    const b = await tx.business.create({
      data: {
        slug: SLUG,
        name: 'Cristales Ariel',
        whatsapp: '113364056',
        address: 'Villa Ballester, Buenos Aires',
        zones,
        hours: 'Lunes a sábado',
        instagram: 'Cristales Ariel',
        site,
        dollarSource: 'OFICIAL',
        dollarManual: 1450,
        wastePct: 15,
        depositPct: 50,
        urgencyPct: 20,
        freightPerKm: 800,
        validDays: 10,
        customerAdjust: { VIDRIERIA: -10 },
        quoteFooter: 'Precios con IVA incluido. Seña del 50 % para empezar; el saldo, al terminar la instalación.',
        payAlias: 'cristales.ariel',
        payHolder: 'Ariel (Cristales Ariel)',
        payNote: 'También podés pagar en efectivo en el local.',
        supplierName: 'Elasic',
        plan: 'COMPLETO',
        payFees: { MERCADOPAGO: 6.3, CREDITO: 3.5, DEBITO: 1.2 },
        installmentRates: { '3': 12, '6': 25 },
        referralBenefit: '10 % de descuento en la colocación',
        monotributoCategory: 'F',
      },
    });
    await loadStarterKit(tx, b.id);
    // Costos de ejemplo para que se vea la ganancia: materiales al 60 %, mano de obra al 50 %, procesos al 35 %.
    for (const [category, k] of [['VIDRIO', 0.6], ['HERRAJE', 0.6], ['PERFIL', 0.6], ['SERVICIO', 0.5], ['PROCESO', 0.35]] as const) {
      const items = await tx.catalogItem.findMany({ where: { businessId: b.id, category } });
      for (const it of items) await tx.catalogItem.update({ where: { id: it.id }, data: { cost: Math.round(num(it.price) * k * 100) / 100 } });
    }
    await tx.user.create({ data: { businessId: b.id, name: 'Ariel', email: 'ariel@demo.com', passwordHash, role: 'OWNER' } });
    await tx.user.create({ data: { businessId: b.id, name: 'Socio', email: 'socio@demo.com', passwordHash, role: 'PARTNER' } });
    return b;
  });

  const owner = await prisma.user.findFirstOrThrow({ where: { businessId: b.id, role: 'OWNER' } });
  const [catalog, templates] = await Promise.all([
    prisma.catalogItem.findMany({ where: { businessId: b.id } }),
    prisma.template.findMany({ where: { businessId: b.id } }),
  ]);
  const cat = catalog.map((c) => ({ id: c.id, name: c.name, price: num(c.price), currency: c.currency, isGlass: c.isGlass, cost: c.cost == null ? null : num(c.cost) }));
  const tpl = (name: string) => templates.find((t) => t.name === name)!;
  const item = (name: string, w: number, h: number, quantity = 1) => ({
    title: name,
    widthMm: w,
    heightMm: h,
    quantity,
    lines: linesFromTemplate(tpl(name).lines as unknown as TemplateLine[], cat),
  });
  const medicion = catalog.find((c) => c.name === 'Medición')!;

  const customers = await Promise.all(
    [
      { name: 'Laura Fernández', phone: '11 5555-0101', address: 'Av. Triunvirato 4100, Villa Urquiza', type: 'PARTICULAR' as const, source: 'GOOGLE' as const },
      { name: 'Constructora Norte SRL', phone: '11 5555-0202', address: 'Mitre 1200, San Martín', type: 'CONSTRUCTORA' as const, source: 'RECOMENDACION' as const },
      { name: 'Arq. Pablo Gómez', phone: '11 5555-0303', address: 'Juramento 2100, Belgrano', type: 'ARQUITECTO' as const, source: 'INSTAGRAM' as const },
      { name: 'Vidriería El Sol', phone: '11 5555-0404', address: 'Av. Mitre 3000, Munro', type: 'VIDRIERIA' as const, source: 'WHATSAPP' as const },
    ].map((c) => prisma.customer.create({ data: { ...c, businessId: b.id } })),
  );

  const base = (over: Partial<QuoteBody>): QuoteBody => ({
    title: '',
    notes: '',
    items: [],
    extras: [],
    freightKm: 0,
    urgent: false,
    adjustPct: 0,
    discount: 0,
    ...over,
  });
  const make = async (over: Partial<QuoteBody>, patch: Record<string, unknown>) => {
    const q = await createQuote(b, owner.id, base(over));
    return prisma.quote.update({ where: { id: q.id }, data: patch });
  };
  const ago = (d: number) => new Date(Date.now() - d * DAY);
  /** Lo deja calculado con un dólar más bajo (como si se hubiera mandado antes de una suba). */
  const olderDollar = async (id: string, factor: number) => {
    const q = await prisma.quote.findUniqueOrThrow({ where: { id } });
    const settings = { ...(q.settings as unknown as QuoteSettings), dollarRate: Math.round(num(q.dollarRate) * factor) };
    const result = calcQuote(q.input as unknown as QuoteInput, settings);
    await prisma.quote.update({
      where: { id },
      data: { settings: settings as object, result: result as object, total: result.total, deposit: result.deposit, dollarRate: settings.dollarRate },
    });
  };
  const temp10 = catalog.find((c) => c.name === 'Templado 10 mm')!;
  const withGlass = (it: ReturnType<typeof item>, glass: typeof temp10) => ({
    ...it,
    lines: it.lines.map((l) => (l.applyWaste ? { ...l, catalogItemId: glass.id, name: glass.name, unitPrice: num(glass.price), unitCost: glass.cost == null ? null : num(glass.cost) } : l)),
  });

  const mampara = item('Mampara corrediza', 1200, 1800);
  const mamparaQ = await make(
    {
      customerId: customers[0].id,
      title: 'Mampara de baño',
      freightKm: 12,
      options: [
        { label: 'Templado 8 mm', items: [mampara], extras: [], discount: 0 },
        { label: 'Templado 10 mm (más firme)', items: [withGlass(mampara, temp10)], extras: [], discount: 0 },
      ],
    },
    { status: 'VIEWED', sentAt: ago(3), viewedAt: ago(2), lastViewedAt: new Date(Date.now() - 40 * 60_000), viewCount: 3, createdAt: ago(3) },
  );
  const baranda = await make(
    { customerId: customers[2].id, title: 'Baranda de escalera', items: [item('Baranda / escalera de vidrio', 3200, 1000), item('Espejo a medida', 900, 1200)], freightKm: 8 },
    { status: 'VIEWED', sentAt: ago(4), viewedAt: ago(2), lastViewedAt: ago(2), viewCount: 1, createdAt: ago(4) },
  );
  await olderDollar(baranda.id, 0.92);
  const dvh = await make(
    { customerId: customers[1].id, title: 'Obra calle Mitre: 6 vidrios DVH', items: [item('DVH a medida', 1500, 1100, 6)], freightKm: 15, adjustPct: 0 },
    { status: 'ACCEPTED', sentAt: ago(5), viewedAt: ago(5), lastViewedAt: ago(1), viewCount: 2, acceptedAt: ago(1), createdAt: ago(6) },
  );
  const receipt = demoReceipt(`$ ${Math.round(num(dvh.deposit)).toLocaleString('es-AR')}`);
  const proof = await prisma.asset.create({ data: { businessId: b.id, mime: 'application/pdf', data: receipt, size: receipt.length, kind: 'receipt', public: false } });
  await prisma.quote.update({ where: { id: dvh.id }, data: { depositProofId: proof.id, depositReportedAt: new Date(Date.now() - 3 * 3_600_000) } });
  await make(
    { customerId: customers[3].id, title: 'Templados para reventa', items: [item('Mampara corrediza', 1000, 1800, 2)], adjustPct: -10 },
    { status: 'DRAFT', createdAt: ago(0) },
  );
  const cambioQ = await make(
    {
      customerId: customers[0].id,
      title: 'Cambio de vidrio de ventana',
      items: [item('Cambio de vidrio', 600, 900, 2)],
      extras: [{ catalogItemId: medicion.id, name: medicion.name, basis: 'fijo', factor: 1, unitPrice: num(medicion.price), currency: medicion.currency, applyWaste: false }],
      urgent: true,
    },
    { status: 'ACCEPTED', sentAt: ago(9), viewedAt: ago(8), viewCount: 1, acceptedAt: ago(4), depositPaidAt: ago(4), createdAt: ago(9) },
  );

  // ——— Demo v3: la obra, la plata y el marketing ———
  const [laura, constructora, pablo, elSol] = customers;
  const extra: { name: string; phone: string; address: string; source: LeadSource; type?: 'CONSORCIO' }[] = [
    { name: 'Marcela Ortiz', phone: '11 5555-0707', address: 'Pueyrredón 2300, Villa Ballester', source: 'GOOGLE' },
    { name: 'Jorge Benítez', phone: '11 5555-0808', address: 'Av. San Martín 4500, Villa Ballester', source: 'CARTEL' },
    { name: 'Lucía Romero', phone: '11 5555-1010', address: 'Holmberg 3100, Villa Urquiza', source: 'INSTAGRAM' },
    { name: 'Ricardo Sosa', phone: '11 5555-1111', address: 'Belgrano 900, Villa Ballester', source: 'WHATSAPP' },
    { name: 'Consorcio Mitre 1450', phone: '11 5555-0909', address: 'Mitre 1450, San Martín', source: 'RECOMENDACION', type: 'CONSORCIO' },
    { name: 'Gabriela Núñez', phone: '11 5555-1212', address: 'Lavalle 2500, Villa Ballester', source: 'CARTEL' },
    { name: 'Hernán Díaz', phone: '11 5555-1313', address: 'Pacífico 700, Villa Ballester', source: 'GOOGLE' },
  ];
  const [marcela, jorge, lucia, ricardo, consorcio, gabriela, hernan] = await Promise.all(
    extra.map(({ type, ...c }) => prisma.customer.create({ data: { ...c, type: type ?? 'PARTICULAR', businessId: b.id } })),
  );
  const lauraCode = randomCode();
  await prisma.customer.update({ where: { id: laura.id }, data: { referralCode: lauraCode } });

  const crews = await Promise.all(
    [
      { name: 'Equipo Ariel', members: 'Ariel, Nico', dayRate: 45000, color: '#1d4ed8' },
      { name: 'Equipo Diego', members: 'Diego, Matías', dayRate: 42000, color: '#16a34a' },
      { name: 'Taller', members: 'Ramón', dayRate: 38000, color: '#ea580c' },
    ].map((c) => prisma.crew.create({ data: { ...c, businessId: b.id } })),
  );
  const [crewAriel, crewDiego] = crews;

  // Hora argentina (UTC-3) de un día relativo a hoy.
  const at = (d: number, h: number) => {
    const x = new Date(Date.now() + d * DAY);
    x.setUTCHours(h + 3, 0, 0, 0);
    return x;
  };
  const fees: Record<string, number> = { MERCADOPAGO: 6.3, CREDITO: 3.5, DEBITO: 1.2 };
  type Cheque = { chequeBank?: string; chequeNumber?: string; chequeDueAt?: Date; chequeStatus?: 'CARTERA' | 'COBRADO'; note?: string };
  const pay = (q: { id: string; customerId: string | null }, kind: PayKind, method: PayMethod, amount: number, date: Date, more: Cheque = {}) =>
    prisma.payment.create({
      data: { businessId: b.id, quoteId: q.id, customerId: q.customerId, kind, method, amount, feePct: fees[method] ?? 0, net: netOf(amount, fees[method] ?? 0), date, ...more },
    });
  const rest = (q: { total: unknown; deposit: unknown }) => num(q.total as number) - num(q.deposit as number);
  /** Presupuesto aceptado hace `days` días, con su seña cobrada y el trabajo en el estado indicado. */
  const job = async (over: Partial<QuoteBody>, days: number, data: Prisma.JobUncheckedUpdateInput, sena: PayMethod | null = 'TRANSFERENCIA') => {
    const q = await make(over, {
      status: 'ACCEPTED',
      sentAt: ago(days + 2),
      viewedAt: ago(days + 1),
      viewCount: 2,
      acceptedAt: ago(days),
      createdAt: ago(days + 2),
      ...(sena ? { depositPaidAt: ago(days) } : {}),
    });
    if (sena) await pay(q, 'SENA', sena, num(q.deposit), ago(days));
    const j = await ensureJob(q.id);
    // Todos estos ya tienen el material pedido: no aparecen en Compras.
    await prisma.quote.update({ where: { id: q.id }, data: { purchasedAt: (data.orderedAt as Date | undefined) ?? ago(days) } });
    return { q, j: await prisma.job.update({ where: { id: j.id }, data }) };
  };
  const work = async (jobId: string, crew: (typeof crews)[number], date: Date, paid: boolean) => {
    for (const worker of crew.members.split(/,\s*/))
      await prisma.workDay.create({ data: { businessId: b.id, crewId: crew.id, worker, date, jobId, amount: crew.dayRate, paidAt: paid ? new Date(date.getTime() + 3 * DAY) : null } });
  };
  const sent = (d: number) => ({ confirmSentAt: ago(d + 1), reviewSentAt: ago(d), check30SentAt: d > 30 ? ago(d - 30) : null, maint6SentAt: d > 180 ? ago(d - 180) : null });

  // Los aceptados de arriba: la obra de DVH espera la seña; el cambio de vidrio ya está señado y falta pedir el material.
  await ensureJob(dvh.id);
  await pay(cambioQ, 'SENA', 'TRANSFERENCIA', num(cambioQ.deposit), ago(4));
  await ensureJob(cambioQ.id);

  // Un trabajo en cada estado.
  await job({ customerId: marcela.id, title: 'Box de ducha', items: [item('Box de ducha', 1600, 1900)], freightKm: 6 }, 3, {
    status: 'ORDERED',
    orderedAt: ago(2),
    promisedAt: new Date(Date.now() + 10 * DAY),
  });
  await job(
    { customerId: jorge.id, title: 'Mampara de bañera', items: [item('Mampara corrediza', 1400, 1500)], freightKm: 4 },
    16,
    { status: 'MAKING', orderedAt: ago(15), promisedAt: ago(1) },
    'MERCADOPAGO',
  );
  await job(
    { customerId: lucia.id, title: 'Espejo del living', items: [item('Espejo a medida', 1000, 1500)], freightKm: 10 },
    9,
    { status: 'RECEIVED', orderedAt: ago(8), promisedAt: ago(1), receivedAt: ago(1) },
    'EFECTIVO',
  );
  const vidrios = await job({ customerId: ricardo.id, title: 'Vidrios de ventanas', items: [item('Cambio de vidrio', 800, 1000, 3)] }, 6, {
    status: 'SCHEDULED',
    orderedAt: ago(5),
    receivedAt: ago(2),
    scheduledAt: at(1, 9),
    crewId: crewAriel.id,
  });
  await job({ customerId: consorcio.id, title: 'Vidrios del palier', items: [item('Cambio de vidrio', 900, 1200, 4)] }, 7, {
    status: 'SCHEDULED',
    orderedAt: ago(6),
    receivedAt: ago(1),
    scheduledAt: at(3, 14),
    crewId: crewDiego.id,
  });

  // Colocado hace 2 días, con las fotos del colocador: falta pedir la reseña y el saldo es un cheque en cartera.
  const [before, after] = await demoPhotos(b.id, [IMG.stairsBefore, IMG.stairsAfter]);
  const escalera = await job({ customerId: gabriela.id, title: 'Baranda de escalera', items: [item('Baranda / escalera de vidrio', 3000, 1000)], freightKm: 5 }, 12, {
    status: 'INSTALLED',
    orderedAt: ago(11),
    promisedAt: ago(3),
    receivedAt: ago(4),
    scheduledAt: at(-2, 9),
    crewId: crewDiego.id,
    arrivedAt: at(-2, 9),
    installedAt: at(-2, 13),
    confirmSentAt: ago(3),
    beforeIds: before ? [before] : [],
    afterIds: after ? [after] : [],
    stockUsedAt: ago(2),
  });
  await pay(escalera.q, 'SALDO', 'CHEQUE', rest(escalera.q), ago(2), { chequeBank: 'Banco Provincia', chequeNumber: '04512387', chequeDueAt: new Date(Date.now() + 20 * DAY), chequeStatus: 'CARTERA' });
  await work(escalera.j.id, crewDiego, at(-2, 9), false);

  // Hace 35 días (control de los 30 días) y hace 190 (mantenimiento de los 6 meses).
  const mamp = await job({ customerId: laura.id, title: 'Mampara del baño de servicio', items: [item('Mampara corrediza', 1100, 1800)], freightKm: 12 }, 45, {
    status: 'CLOSED',
    orderedAt: ago(44),
    receivedAt: ago(38),
    scheduledAt: at(-35, 10),
    crewId: crewAriel.id,
    installedAt: at(-35, 12),
    closedAt: ago(35),
    confirmSentAt: ago(36),
    reviewSentAt: ago(35),
    stockUsedAt: ago(35),
  });
  await pay(mamp.q, 'SALDO', 'CREDITO', rest(mamp.q), ago(35), { note: '3 cuotas' });
  await work(mamp.j.id, crewAriel, at(-35, 10), true);
  const box = await job({ customerId: hernan.id, title: 'Box de ducha', items: [item('Box de ducha', 1500, 1900)] }, 200, {
    status: 'CLOSED',
    orderedAt: ago(199),
    receivedAt: ago(193),
    scheduledAt: at(-190, 10),
    crewId: crewAriel.id,
    installedAt: at(-190, 12),
    closedAt: ago(190),
    confirmSentAt: ago(191),
    reviewSentAt: ago(190),
    check30SentAt: ago(160),
    stockUsedAt: ago(190),
  }, 'EFECTIVO');
  await pay(box.q, 'SALDO', 'EFECTIVO', rest(box.q), ago(190));
  await work(box.j.id, crewAriel, at(-190, 10), true);

  // Historia de los últimos meses (para Números): trabajos cerrados y cobrados.
  const history: [Partial<QuoteBody>, number, PayMethod, PayMethod][] = [
    [{ customerId: constructora.id, title: 'Obra Mitre: frente vidriado', items: [item('DVH a medida', 1500, 1100, 6)], freightKm: 15 }, 4, 'TRANSFERENCIA', 'TRANSFERENCIA'],
    [{ customerId: constructora.id, title: 'Obra Pueyrredón: 8 vidrios DVH', items: [item('DVH a medida', 1200, 1100, 8)], freightKm: 15 }, 60, 'TRANSFERENCIA', 'ECHEQ'],
    [{ customerId: pablo.id, title: 'Espejos del vestidor', items: [item('Espejo a medida', 1200, 2000, 2)], freightKm: 8 }, 95, 'TRANSFERENCIA', 'TRANSFERENCIA'],
    [{ customerId: lucia.id, title: 'Mampara del baño', items: [item('Mampara corrediza', 1200, 1800)], freightKm: 10 }, 130, 'MERCADOPAGO', 'MERCADOPAGO'],
    [{ customerId: elSol.id, title: 'Templados para reventa', items: [item('Mampara corrediza', 1000, 1800, 2)], adjustPct: -10 }, 150, 'EFECTIVO', 'EFECTIVO'],
    [{ customerId: jorge.id, title: 'Cambio de vidrios', items: [item('Cambio de vidrio', 600, 900, 4)] }, 160, 'EFECTIVO', 'DEBITO'],
  ];
  for (const [over, d, sena, saldo] of history) {
    const h = await job(over, d + 8, { status: 'CLOSED', orderedAt: ago(d + 7), receivedAt: ago(d + 2), scheduledAt: at(-d, 10), crewId: crewDiego.id, installedAt: at(-d, 12), closedAt: ago(d), ...sent(d), stockUsedAt: ago(d) }, sena);
    await pay(h.q, 'SALDO', saldo, rest(h.q), ago(d), saldo === 'ECHEQ' ? { chequeBank: 'Banco Galicia', chequeNumber: 'E-778120', chequeDueAt: ago(d - 30), chequeStatus: 'COBRADO' } : {});
    await work(h.j.id, crewDiego, at(-d, 10), true);
  }
  // Un adelanto de esta semana, todavía sin liquidar.
  await prisma.workDay.create({ data: { businessId: b.id, crewId: crewDiego.id, worker: 'Matías', date: ago(1), amount: 20000, advance: true } });

  // Gastos fijos del mes y gastos de obra.
  const month1 = new Date();
  month1.setUTCDate(1);
  month1.setUTCHours(12, 0, 0, 0);
  const fixed: [ExpenseCategory, string, number][] = [
    ['ALQUILER', 'Alquiler del taller', 380000],
    ['LUZ', 'Luz', 65000],
    ['CONTADOR', 'Contador', 80000],
    ['VEHICULO', 'Seguro de la camioneta', 95000],
    ['IMPUESTOS', 'Monotributo', 120000],
  ];
  await prisma.expense.createMany({ data: fixed.map(([category, description, amount]) => ({ businessId: b.id, category, description, amount, date: month1, recurring: true })) });
  await prisma.expense.createMany({
    data: [
      { businessId: b.id, category: 'COMBUSTIBLE', description: 'Nafta', amount: 18000, date: ago(2), jobId: escalera.j.id },
      { businessId: b.id, category: 'COMBUSTIBLE', description: 'Nafta', amount: 22000, date: ago(35), jobId: mamp.j.id },
      { businessId: b.id, category: 'MATERIAL', description: 'Silicona y tarugos', amount: 30000, date: ago(6) },
    ],
  });

  // Rotura, retazos y stock (dos cosas por reponer).
  await prisma.breakage.create({
    data: { businessId: b.id, jobId: vidrios.j.id, where: 'TRASLADO', description: 'Se rajó un vidrio de 80 × 100 en la camioneta', cost: 32000, responsible: 'Equipo Ariel', reordered: true },
  });
  const byName = (n: string) => catalog.find((c) => c.name === n);
  const remnants: [string, number, number, string][] = [
    ['Float incoloro 4 mm', 700, 900, 'Sobró de las ventanas de Sosa'],
    ['Espejo 4 mm', 600, 1200, ''],
    ['Laminado 3+3', 500, 800, 'Tiene un canto pulido'],
  ];
  await prisma.remnant.createMany({
    data: remnants.map(([glassName, widthMm, heightMm, notes]) => ({ businessId: b.id, catalogItemId: byName(glassName)?.id ?? null, glassName, thicknessMm: byName(glassName)?.thicknessMm ?? null, widthMm, heightMm, notes })),
  });
  const stock: [string, number, number][] = [
    ['Kit mampara corrediza', 3, 2],
    ['Kit box de ducha', 1, 2],
    ['Bisagras vidrio-pared (par)', 6, 4],
    ['Silicona (cartucho)', 4, 6],
    ['Zócalo de aluminio para baranda', 12, 6],
  ];
  for (const [n, stockQty, stockMin] of stock) {
    const c = byName(n);
    if (c) await prisma.catalogItem.update({ where: { id: c.id }, data: { stockQty, stockMin } });
  }

  // Facturas de los últimos 12 meses (cargadas a mano), para ver el tope del monotributo.
  const names = ['Consumidor final', 'Constructora Norte SRL', 'Laura Fernández', 'Arq. Pablo Gómez', 'Consumidor final', 'Hernán Díaz'];
  const invoices: Prisma.InvoiceCreateManyInput[] = [];
  for (let m = 11; m >= 0; m--)
    for (const k of [0, 1])
      invoices.push({ businessId: b.id, type: 'C', ptoVta: 2, number: 120 + invoices.length, amount: 1_050_000 + ((m * 7 + k * 3) % 5) * 180_000, date: ago(m * 30 + k * 12 + 3), customerName: names[(m + k) % names.length], manual: true });
  await prisma.invoice.createMany({ data: invoices });

  // Edificio del consorcio con sus vidrios cargados.
  await prisma.building.create({
    data: {
      businessId: b.id,
      customerId: consorcio.id,
      name: 'Mitre 1450',
      address: 'Mitre 1450, San Martín',
      glasses: [
        { place: 'Puerta de entrada', widthMm: 900, heightMm: 2100, glass: 'Laminado 4+4', notes: 'Vidrio de seguridad' },
        { place: 'Ventanas del palier (PB a 4°)', widthMm: 900, heightMm: 1200, glass: 'Float incoloro 4 mm', notes: '' },
        { place: 'Mirilla del ascensor', widthMm: 200, heightMm: 600, glass: 'Laminado 3+3', notes: '' },
      ],
      notes: 'Llaves en portería.',
    },
  });

  // Foto con IA en el presupuesto de la mampara: la foto del baño y cómo quedaría.
  await prisma.quote.update({ where: { id: mamparaQ.id }, data: { renderUrls: [IMG.bathAfter] } });
  await prisma.render.create({ data: { businessId: b.id, quoteId: mamparaQ.id, sourceUrl: IMG.bathBefore, resultUrl: IMG.bathAfter, prompt: 'Mampara corrediza de templado 8 mm sobre la bañera, herrajes negros' } });

  // Carteles de obra y consultas de cada origen.
  const [obra, camioneta] = await Promise.all([
    prisma.sign.create({ data: { businessId: b.id, code: randomCode(), name: 'Obra Lavalle 2500', address: 'Lavalle 2500, Villa Ballester', visits: 23 } }),
    prisma.sign.create({ data: { businessId: b.id, code: randomCode(), name: 'Camioneta', visits: 41 } }),
  ]);
  await prisma.lead.createMany({
    data: [
      { businessId: b.id, kind: 'Box de ducha', widthCm: 160, heightCm: 190, quantity: 1, details: 'Frente y un lateral, herrajes negros.', zone: 'Villa Ballester', name: 'Martín Ruiz', phone: '11 5555-0505', when: 'Este mes', source: 'WEB' },
      { businessId: b.id, kind: 'Cambio de vidrio roto', widthCm: 50, heightCm: 70, quantity: 1, details: 'Se rompió el vidrio de la puerta del balcón.', zone: 'Saavedra', name: 'Sofía Paz', phone: '11 5555-0606', when: 'Urgente', urgent: true, source: 'GOOGLE', createdAt: ago(1) },
      { businessId: b.id, kind: 'Mampara corrediza', widthCm: 120, heightCm: 150, quantity: 1, details: 'Me pasó el dato Laura. Es para la bañera.', zone: 'Villa Urquiza', name: 'Paula Medina', phone: '11 5555-1414', when: 'Este mes', source: 'RECOMENDACION', refCode: lauraCode, status: 'QUOTED', createdAt: ago(2) },
      { businessId: b.id, kind: 'Baranda / escalera de vidrio', details: 'Vi el cartel en la obra de Lavalle.', zone: 'Villa Ballester', name: 'Diego Ferreyra', phone: '11 5555-1515', when: 'Estoy averiguando', source: 'CARTEL', signId: obra.id, status: 'QUOTED', createdAt: ago(5) },
      { businessId: b.id, kind: 'Espejo a medida', zone: 'Villa Urquiza', name: 'Lucía Romero', phone: '11 5555-1010', source: 'INSTAGRAM', status: 'CLOSED', customerId: lucia.id, createdAt: ago(11) },
      { businessId: b.id, kind: 'Cambio de vidrio', zone: 'Villa Ballester', name: 'Ricardo Sosa', phone: '11 5555-1111', source: 'WHATSAPP', status: 'CLOSED', customerId: ricardo.id, createdAt: ago(8) },
      { businessId: b.id, kind: 'Box de ducha', zone: 'Villa Ballester', name: 'Marcela Ortiz', phone: '11 5555-0707', source: 'GOOGLE', status: 'CLOSED', customerId: marcela.id, createdAt: ago(6) },
      { businessId: b.id, kind: 'Mampara corrediza', zone: 'Villa Ballester', name: 'Jorge Benítez', phone: '11 5555-0808', source: 'CARTEL', signId: camioneta.id, status: 'CLOSED', customerId: jorge.id, createdAt: ago(19) },
      { businessId: b.id, kind: 'Baranda / escalera de vidrio', zone: 'Villa Ballester', name: 'Gabriela Núñez', phone: '11 5555-1212', source: 'CARTEL', signId: obra.id, status: 'CLOSED', customerId: gabriela.id, createdAt: ago(15) },
      { businessId: b.id, kind: 'Cambio de vidrio', zone: 'San Martín', name: 'Consorcio Mitre 1450', phone: '11 5555-0909', source: 'RECOMENDACION', refCode: lauraCode, status: 'CLOSED', customerId: consorcio.id, createdAt: ago(10) },
    ],
  });
  return { created: true };
}

// Ejecutado directo: pnpm db:seed [--reset]
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDemo({ reset: process.argv.includes('--reset') })
    .then((r) => console.log(r.created ? 'Demo de Cristales Ariel cargada' : 'La demo ya existía (usá --reset para recrearla)'))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

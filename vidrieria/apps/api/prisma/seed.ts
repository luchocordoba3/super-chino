/**
 * Demo: Cristales Ariel (Villa Ballester). No duplica: si ya existe, no hace nada (con --reset la vuelve a crear).
 * Precios de ejemplo: Ariel los reemplaza por los suyos desde el panel.
 */
import bcrypt from 'bcryptjs';
import { calcQuote, linesFromTemplate, type QuoteBody, type QuoteInput, type QuoteSettings, type TemplateLine } from '@vidrieria/shared';
import { num, prisma } from '../src/db';
import { createQuote } from '../src/services/quotes';
import { defaultSite, loadStarterKit } from '../src/services/starter';

const SLUG = 'cristales-ariel';
const DEMO_EMAIL = 'ariel@demo.com';
/** Subir este número cuando la demo cambie: al publicar se vuelve a crear sola (solo si sigue siendo la demo). */
export const DEMO_VERSION = 2;

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
};
const DAY = 86_400_000;

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
      { name: 'Laura Fernández', phone: '11 5555-0101', address: 'Villa Urquiza, CABA', type: 'PARTICULAR' as const },
      { name: 'Constructora Norte SRL', phone: '11 5555-0202', address: 'San Martín', type: 'CONSTRUCTORA' as const },
      { name: 'Arq. Pablo Gómez', phone: '11 5555-0303', address: 'Belgrano, CABA', type: 'ARQUITECTO' as const },
      { name: 'Vidriería El Sol', phone: '11 5555-0404', address: 'Munro', type: 'VIDRIERIA' as const },
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
  await make(
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
  await make(
    {
      customerId: customers[0].id,
      title: 'Cambio de vidrio de ventana',
      items: [item('Cambio de vidrio', 600, 900, 2)],
      extras: [{ catalogItemId: medicion.id, name: medicion.name, basis: 'fijo', factor: 1, unitPrice: num(medicion.price), currency: medicion.currency, applyWaste: false }],
      urgent: true,
    },
    { status: 'ACCEPTED', sentAt: ago(9), viewedAt: ago(8), viewCount: 1, acceptedAt: ago(4), depositPaidAt: ago(4), createdAt: ago(9) },
  );

  await prisma.lead.createMany({
    data: [
      { businessId: b.id, kind: 'Box de ducha', widthCm: 160, heightCm: 190, quantity: 1, details: 'Frente y un lateral, herrajes negros.', zone: 'Villa Ballester', name: 'Martín Ruiz', phone: '11 5555-0505', when: 'Este mes' },
      { businessId: b.id, kind: 'Cambio de vidrio roto', widthCm: 50, heightCm: 70, quantity: 1, details: 'Se rompió el vidrio de la puerta del balcón.', zone: 'Saavedra', name: 'Sofía Paz', phone: '11 5555-0606', when: 'Urgente', createdAt: ago(1) },
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

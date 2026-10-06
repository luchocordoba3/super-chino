/**
 * Demo: Cristales Ariel (Villa Ballester). No duplica: si ya existe, no hace nada (con --reset la vuelve a crear).
 * Precios de ejemplo: Ariel los reemplaza por los suyos desde el panel.
 */
import bcrypt from 'bcryptjs';
import { linesFromTemplate, type QuoteBody, type TemplateLine } from '@vidrieria/shared';
import { num, prisma } from '../src/db';
import { createQuote } from '../src/services/quotes';
import { defaultSite, loadStarterKit } from '../src/services/starter';

const SLUG = 'cristales-ariel';
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
    headline: 'Vidrios, mamparas y espejos a medida',
    subheadline: 'Medimos, fabricamos e instalamos en CABA y zona norte, en menos de una semana. Pedí tu presupuesto y te respondemos por WhatsApp.',
    heroImage: '/demo/hero.jpg',
    illustrativeImages: true,
    faqs: [
      { q: '¿Cuánto tardan en instalar?', a: 'Menos de una semana desde que confirmás el presupuesto.' },
      { q: '¿Cómo se paga?', a: 'Efectivo, transferencia, Mercado Pago o cheque. Para empezar se deja una seña del 50 %.' },
      { q: '¿Hasta dónde llegan?', a: 'Trabajamos en CABA y alrededores. El traslado se calcula según la distancia.' },
      { q: '¿Trabajan con constructoras y arquitectos?', a: 'Sí, hacemos obras completas y también vendemos a otras vidrierías.' },
      { q: '¿Hacen factura?', a: 'Sí, hacemos factura.' },
    ],
  };
  const images = ['/demo/mampara.jpg', '/demo/baranda.jpg', '/demo/cambio.jpg', '/demo/espejo.jpg', '/demo/templado.jpg', '/demo/frente.jpg'];
  site.services = site.services.map((s, i) => ({ ...s, image: images[i] ?? null }));
  site.gallery = [
    { image: '/demo/mampara.jpg', caption: 'Mampara corrediza en templado 8 mm' },
    { image: '/demo/baranda.jpg', caption: 'Escalera con baranda de vidrio laminado' },
    { image: '/demo/espejo.jpg', caption: 'Espejo a medida con cantos pulidos' },
    { image: '/demo/frente.jpg', caption: 'Frente vidriado para local' },
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
      },
    });
    await loadStarterKit(tx, b.id);
    await tx.user.create({ data: { businessId: b.id, name: 'Ariel', email: 'ariel@demo.com', passwordHash, role: 'OWNER' } });
    await tx.user.create({ data: { businessId: b.id, name: 'Socio', email: 'socio@demo.com', passwordHash, role: 'PARTNER' } });
    return b;
  });

  const owner = await prisma.user.findFirstOrThrow({ where: { businessId: b.id, role: 'OWNER' } });
  const [catalog, templates] = await Promise.all([
    prisma.catalogItem.findMany({ where: { businessId: b.id } }),
    prisma.template.findMany({ where: { businessId: b.id } }),
  ]);
  const cat = catalog.map((c) => ({ id: c.id, name: c.name, price: num(c.price), currency: c.currency, isGlass: c.isGlass }));
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
    await prisma.quote.update({ where: { id: q.id }, data: patch });
  };
  const ago = (d: number) => new Date(Date.now() - d * DAY);

  await make(
    { customerId: customers[0].id, title: 'Mampara de baño', items: [item('Mampara corrediza', 1200, 1800)], freightKm: 12 },
    { status: 'SENT', sentAt: ago(3), createdAt: ago(3) },
  );
  await make(
    { customerId: customers[2].id, title: 'Baranda de escalera', items: [item('Baranda / escalera de vidrio', 3200, 1000), item('Espejo a medida', 900, 1200)], freightKm: 8 },
    { status: 'VIEWED', sentAt: ago(4), viewedAt: ago(2), createdAt: ago(4) },
  );
  await make(
    { customerId: customers[1].id, title: 'Obra calle Mitre: 6 vidrios DVH', items: [item('DVH a medida', 1500, 1100, 6)], freightKm: 15, adjustPct: 0 },
    { status: 'ACCEPTED', sentAt: ago(5), viewedAt: ago(5), acceptedAt: ago(1), createdAt: ago(6) },
  );
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
    { status: 'ACCEPTED', sentAt: ago(9), acceptedAt: ago(8), createdAt: ago(9) },
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

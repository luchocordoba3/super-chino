/**
 * Datos de demostración: pnpm db:seed
 * Dueño: dueno@demo.com / demo1234 (PIN 0000) · Empleados: sofia (PIN 1234), martin (PIN 5678) · Código de local: DEMO01
 */
import { randomUUID } from 'node:crypto';
import { parseSettings } from '@super-chino/shared';
import { prisma } from '../src/db';
import { addDays, localYMD } from '../src/domain/dates';
import { hashPassword, hashPin, randomToken, sha256 } from '../src/lib/crypto';
import { processPosEvents } from '../src/services/sales';
import { createStockEntry } from '../src/services/stock';

if (await prisma.store.findUnique({ where: { code: 'DEMO01' } })) {
  console.log('El local demo ya existe (código DEMO01).');
  process.exit(0);
}

// Números pseudoaleatorios repetibles.
let seed = 42;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];

function ean13(n: number) {
  const base = `779${String(n).padStart(9, '0')}`;
  const sum = [...base].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return base + ((10 - (sum % 10)) % 10);
}

const store = await prisma.store.create({ data: { name: 'Supermercado Demo', code: 'DEMO01' } });
const storeId = store.id;
const settings = parseSettings(store.settings);
const owner = await prisma.user.create({
  data: { storeId, role: 'OWNER', name: 'Li Wei', username: 'dueno', email: 'dueno@demo.com', passwordHash: await hashPassword('demo1234'), pinHash: hashPin('0000'), lang: 'zh' },
});
const sofia = await prisma.user.create({
  data: { storeId, name: 'Sofía', username: 'sofia', pinHash: hashPin('1234'), perms: ['sell', 'stock'], lang: 'es' },
});
const martin = await prisma.user.create({ data: { storeId, name: 'Martín', username: 'martin', pinHash: hashPin('5678'), perms: ['sell'], lang: 'es' } });

const cat = async (name: string) => (await prisma.category.create({ data: { storeId, name } })).id;
const [almacen, bebidas, lacteos, limpieza] = [await cat('Almacén'), await cat('Bebidas'), await cat('Lácteos'), await cat('Limpieza')];
const norte = (await prisma.supplier.create({ data: { storeId, name: 'Distribuidora Norte', phone: '5491100000001', leadTimeDays: 2 } })).id;
const sur = (await prisma.supplier.create({ data: { storeId, name: 'Lácteos del Sur', phone: '5491100000002', leadTimeDays: 1 } })).id;

const catalog: [string, string, string, number, number, number, 'UNIT' | 'KG'][] = [
  ['Puré de tomate 520g', almacen, norte, 1200, 800, 6, 'UNIT'],
  ['Yerba mate 1kg', almacen, norte, 4500, 3100, 5, 'UNIT'],
  ['Fideos spaghetti 500g', almacen, norte, 1100, 700, 8, 'UNIT'],
  ['Arroz largo fino 1kg', almacen, norte, 1600, 1050, 6, 'UNIT'],
  ['Aceite de girasol 1,5L', almacen, norte, 3900, 2800, 4, 'UNIT'],
  ['Gaseosa cola 2,25L', bebidas, norte, 3200, 2200, 12, 'UNIT'],
  ['Agua mineral 2L', bebidas, norte, 1300, 800, 12, 'UNIT'],
  ['Cerveza lata 473ml', bebidas, norte, 1800, 1150, 24, 'UNIT'],
  ['Leche entera 1L', lacteos, sur, 1400, 1000, 12, 'UNIT'],
  ['Yogur bebible frutilla 1L', lacteos, sur, 2300, 1500, 6, 'UNIT'],
  ['Queso cremoso', lacteos, sur, 9800, 7000, 2, 'KG'],
  ['Manteca 200g', lacteos, sur, 2600, 1800, 4, 'UNIT'],
  ['Lavandina 1L', limpieza, norte, 1100, 650, 6, 'UNIT'],
  ['Detergente 750ml', limpieza, norte, 2100, 1400, 4, 'UNIT'],
];
const products: Awaited<ReturnType<typeof prisma.product.create>>[] = [];
for (const [i, [name, categoryId, supplierId, price, cost, minStock, unit]] of catalog.entries()) {
  products.push(await prisma.product.create({ data: { storeId, barcode: ean13(i + 1), name, categoryId, supplierId, price, cost, minStock, unit } }));
}
const byName = (n: string) => products.find((p) => p.name.startsWith(n))!;

// 1) Stock inicial de hace 20 días (sin vencimiento) que consumen las ventas de ejemplo.
await prisma.$transaction((tx) =>
  createStockEntry(tx, {
    storeId,
    userId: owner.id,
    settings,
    items: products.map((p) => ({ productId: p.id, qty: p.unit === 'KG' ? 12 : 45, unitCost: Number(p.cost) })),
  }),
);
await prisma.lot.updateMany({ where: { storeId }, data: { receivedAt: addDays(new Date(), -20) } });

// 2) Ventas de los últimos 14 días y de hoy.
const device = await prisma.device.create({ data: { storeId, name: 'Caja demo', tokenHash: sha256(randomToken()) } });
const events = [];
for (let d = 14; d >= 0; d--) {
  const perDay = d === 0 ? 6 : 7;
  for (let s = 0; s < perDay; s++) {
    const when = addDays(new Date(), -d);
    when.setHours(9 + Math.floor(rand() * 11), Math.floor(rand() * 60));
    if (when > new Date()) when.setTime(Date.now() - 60_000 * (s + 1));
    const items = [...new Set(Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(products)))].map((p) => {
      const qty = p.unit === 'KG' ? Math.round((0.2 + rand() * 0.4) * 1000) / 1000 : 1 + Math.floor(rand() * 2);
      return { productId: p.id, qty, unitPrice: Number(p.price), listPrice: Number(p.price) };
    });
    const total = Math.round(items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0) * 100) / 100;
    events.push({
      id: randomUUID(),
      type: 'SALE',
      userId: pick([sofia.id, martin.id]),
      occurredAt: when.toISOString(),
      items,
      payments: [{ method: pick(['CASH', 'CASH', 'DEBIT', 'QR']), amount: total }],
      total,
    });
  }
}
await processPosEvents(storeId, device.id, events);

// 3) Mercadería nueva con vencimientos (para ver avisos y ofertas).
const today = localYMD(store.timezone);
const inDays = (n: number) => addDays(new Date(today + 'T12:00:00Z'), n).toISOString().slice(0, 10);
await prisma.$transaction((tx) =>
  createStockEntry(tx, {
    storeId,
    userId: sofia.id,
    settings,
    supplierId: sur,
    invoiceNumber: 'R-0001-00012345',
    items: [
      { productId: byName('Leche').id, qty: 24, unitCost: 1000, lotCode: 'LA-01', expiresAt: inDays(3) },
      { productId: byName('Leche').id, qty: 24, unitCost: 1000, lotCode: 'LA-02', expiresAt: inDays(15) },
      { productId: byName('Yogur').id, qty: 18, unitCost: 1500, lotCode: 'YF-77', expiresAt: inDays(2) },
      { productId: byName('Yogur').id, qty: 3, unitCost: 1500, lotCode: 'YF-70', expiresAt: inDays(-1) },
      { productId: byName('Queso').id, qty: 4.5, unitCost: 7000, lotCode: 'QC-5', expiresAt: inDays(10) },
      { productId: byName('Manteca').id, qty: 10, unitCost: 1800, lotCode: 'MT-2', expiresAt: inDays(40) },
    ],
  }),
);

// 4) Mensajes del dueño (en chino, con traducción).
const msg = await prisma.message.create({
  data: {
    storeId,
    fromUserId: owner.id,
    text: '明天早上八点到货，请把仓库整理好。',
    lang: 'zh',
    translations: { es: 'Mañana a las 8 llega mercadería, por favor ordenen el depósito.' },
    translationStatus: 'done',
  },
});
await prisma.messageRecipient.createMany({ data: [sofia.id, martin.id].map((userId) => ({ messageId: msg.id, userId })) });
const task = await prisma.message.create({
  data: {
    storeId,
    fromUserId: owner.id,
    kind: 'TASK',
    text: '请整理乳制品冰柜，完成后拍照。',
    lang: 'zh',
    translations: { es: 'Ordená la heladera de lácteos y sacale una foto al terminar.' },
    translationStatus: 'done',
    requiresPhoto: true,
    dueAt: addDays(new Date(), 1),
  },
});
await prisma.messageRecipient.create({ data: { messageId: task.id, userId: sofia.id } });

console.log(`Listo. Local DEMO01 · dueño dueno@demo.com / demo1234 · empleados sofia (1234) y martin (5678). Ventas: ${events.length}`);
await prisma.$disconnect();

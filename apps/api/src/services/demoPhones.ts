/**
 * Local de demostración de la casa de celulares (DEMO02), con fechas relativas a hoy.
 * Dueño: celus@demo.com / demo1234 (PIN 0000) · vendedor (PIN 1234) · tecnico (PIN 2345) · cadete (PIN 3456).
 */
import { randomUUID } from 'node:crypto';
import { round2 } from '@super-chino/shared';
import { prisma } from '../db';
import { addDays } from '../domain/dates';
import { hashPassword, hashPin, randomToken, sha256 } from '../lib/crypto';
import { wipeStoreData } from './demo';
import { processPosEvents } from './sales';

export const PHONE_DEMO_CODE = 'DEMO02';
const RATE = 1200;

/** IMEI válido (Luhn) a partir de un número. */
function imeiFrom(n: number) {
  const base = `35${String(4870000000 + n * 7717).padStart(12, '0')}`.slice(0, 14);
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(base[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return base + ((10 - (sum % 10)) % 10);
}

export async function seedPhoneDemo() {
  let seed = 7;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];
  const now = new Date();
  const daysAgo = (d: number, h = 12) => new Date(addDays(now, -d).setHours(h, Math.floor(rand() * 59)));

  const keep = ['dueno', 'vendedor', 'tecnico', 'cadete'];
  const existing = await prisma.store.findUnique({ where: { code: PHONE_DEMO_CODE } });
  if (existing) await wipeStoreData(existing.id, keep);
  const settings = { fxSource: 'blue', fxManual: RATE, warrantyTerms: 'La garantía no cubre golpes, humedad, pantallas rotas ni equipos abiertos por terceros.' };
  const store = existing
    ? await prisma.store.update({ where: { id: existing.id }, data: { name: 'Celulares Demo', businessType: 'PHONES', settings } })
    : await prisma.store.create({ data: { name: 'Celulares Demo', code: PHONE_DEMO_CODE, businessType: 'PHONES', settings } });
  const storeId = store.id;

  const upsertUser = async (username: string, data: Omit<Parameters<typeof prisma.user.create>[0]['data'], 'store' | 'storeId' | 'username'>) =>
    prisma.user.upsert({ where: { storeId_username: { storeId, username } }, create: { storeId, username, ...data }, update: { ...data, active: true } });
  const owner = await upsertUser('dueno', { role: 'OWNER', name: 'Nico', email: 'celus@demo.com', passwordHash: await hashPassword('demo1234'), pinHash: hashPin('0000'), lang: 'es' });
  const seller = await upsertUser('vendedor', { name: 'Flor', pinHash: hashPin('1234'), perms: ['sell', 'stock', 'tradeins', 'orders'], lang: 'es' });
  const tech = await upsertUser('tecnico', { name: 'Leo (técnico)', pinHash: hashPin('2345'), perms: ['repairs', 'sell'], lang: 'es' });
  const courier = await upsertUser('cadete', { name: 'Tomi (cadete)', pinHash: hashPin('3456'), perms: ['deliveries'], lang: 'es' });

  // Cotización de ejemplo (si el servidor tiene internet, se actualiza sola).
  if (!(await prisma.exchangeRate.findFirst({ where: { casa: 'blue' } }))) {
    await prisma.exchangeRate.createMany({
      data: [
        { casa: 'blue', compra: RATE - 20, venta: RATE, source: 'demo' },
        { casa: 'oficial', compra: RATE - 180, venta: RATE - 140, source: 'demo' },
      ],
    });
  }

  const cat = async (name: string) => (await prisma.category.create({ data: { storeId, name } })).id;
  const [celus, accesorios, repuestos] = [await cat('Celulares'), await cat('Accesorios'), await cat('Repuestos')];
  const distri = (await prisma.supplier.create({ data: { storeId, name: 'Importadora Once', phone: '5491100000011', leadTimeDays: 3 } })).id;

  const models: [string, number, number][] = [
    ['iPhone 13 128GB', 650, 520],
    ['iPhone 14 128GB', 800, 650],
    ['iPhone 15 128GB', 950, 790],
    ['Samsung Galaxy A55 256GB', 420, 330],
    ['Samsung Galaxy S24 256GB', 900, 740],
    ['Motorola Moto G84 256GB', 260, 195],
    ['Xiaomi Redmi Note 13 256GB', 230, 170],
    ['iPhone 11 64GB', 330, 240],
  ];
  const phones = [];
  for (const [i, [name, price, cost]] of models.entries()) {
    phones.push(await prisma.product.create({ data: { storeId, name, barcode: `19${String(i + 1).padStart(11, '0')}`, categoryId: celus, supplierId: distri, price, cost, currency: 'USD', serialized: true } }));
  }
  const acc: [string, number, number, string, string][] = [
    ['Funda silicona iPhone', 12000, 4500, accesorios, 'ARS'],
    ['Vidrio templado 9D', 8000, 1800, accesorios, 'ARS'],
    ['Cargador 20W USB-C', 25000, 11000, accesorios, 'ARS'],
    ['Cable USB-C a Lightning', 9000, 3500, accesorios, 'ARS'],
    ['Auriculares Bluetooth', 30000, 14000, accesorios, 'ARS'],
    ['Módulo pantalla Galaxy A55', 60, 32, repuestos, 'USD'],
    ['Batería iPhone 13', 35, 18, repuestos, 'USD'],
    ['Pin de carga USB-C', 8000, 2500, repuestos, 'ARS'],
  ];
  const accessories = [];
  for (const [i, [name, price, cost, categoryId, currency]] of acc.entries()) {
    const p = await prisma.product.create({ data: { storeId, name, barcode: `77${String(i + 1).padStart(11, '0')}`, categoryId, supplierId: distri, price, cost, currency, minStock: 3 } });
    const lot = await prisma.lot.create({ data: { storeId, productId: p.id, qtyInitial: 25, qtyRemaining: 25, unitCost: cost, receivedAt: daysAgo(30) } });
    await prisma.stockMovement.create({ data: { storeId, productId: p.id, lotId: lot.id, type: 'ENTRY', qty: 25, unitCost: cost, userId: owner.id, createdAt: daysAgo(30) } });
    accessories.push(p);
  }

  // Equipos: nuevos de cada modelo, algunos usados y algunos parados hace mucho.
  let n = 0;
  const serials = [];
  for (const p of phones) {
    const count = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < count; k++) {
      const used = p.name.includes('iPhone 11') || rand() < 0.2;
      const received = daysAgo(used ? 20 + Math.floor(rand() * 70) : 5 + Math.floor(rand() * 40));
      const s = await prisma.serialItem.create({
        data: {
          storeId,
          productId: p.id,
          imei1: imeiFrom(++n),
          condition: used ? 'USED' : 'NEW',
          grade: used ? pick(['A', 'B', 'B', 'C']) : null,
          battery: used ? 78 + Math.floor(rand() * 20) : null,
          color: pick(['Negro', 'Azul', 'Blanco', 'Verde', 'Rosa']),
          accountFree: true,
          cost: used ? round2(Number(p.cost) * 0.7) : Number(p.cost),
          price: used ? round2(Number(p.price) * 0.8) : null,
          supplierId: used ? null : distri,
          origin: used ? 'TRADE_IN' : 'SUPPLIER',
          receivedAt: received,
          supplierWarrantyUntil: used ? null : addDays(received, 365),
        },
      });
      await prisma.serialEvent.create({ data: { serialItemId: s.id, type: used ? 'TRADE_IN' : 'IN', status: 'AVAILABLE', userId: owner.id, createdAt: received } });
      serials.push({ ...s, product: p });
    }
  }

  // Grilla de toma de usados.
  for (const p of phones) {
    for (const [g, f] of [['A', 0.55], ['B', 0.45], ['C', 0.35]] as const) {
      await prisma.tradeInPrice.create({ data: { storeId, productId: p.id, grade: g, price: Math.round(Number(p.price) * f) } });
    }
  }

  // Clientes.
  const names = ['Juan Pérez', 'María González', 'Lucas Fernández', 'Sofía Rodríguez', 'Martín López', 'Valentina Díaz', 'Agustín Romero', 'Camila Sosa', 'Bruno Torres', 'Julieta Acosta'];
  const customers: { id: string }[] = [];
  for (const [i, name] of names.entries()) {
    customers.push(await prisma.customer.create({ data: { storeId, name, dni: String(30000000 + i * 1234567), phone: `54911${String(40000000 + i * 1111111).slice(0, 8)}`, createdAt: daysAgo(40 - i) } }));
  }

  // Caja y ventas de las últimas dos semanas.
  const device = await prisma.device.create({ data: { storeId, name: 'Caja demo', tokenHash: sha256(randomToken()) } });
  const available = [...serials];
  let sales = 0;
  for (let d = 13; d >= 0; d--) {
    const cashSessionId = randomUUID();
    const sellerId = d % 2 ? seller.id : owner.id;
    const events: unknown[] = [{ id: randomUUID(), type: 'CASH_OPEN', userId: sellerId, occurredAt: daysAgo(d, 10).toISOString(), cashSessionId, openingAmount: 50000, openingUsd: 200 }];
    const perDay = 2 + Math.floor(rand() * 3);
    let cashArsDay = 50000;
    let cashUsdDay = 200;
    for (let k = 0; k < perDay; k++) {
      const items = [];
      const phone = rand() < 0.65 && available.length > 6 ? available.splice(Math.floor(rand() * available.length), 1)[0] : null;
      if (phone) {
        const price = round2(Number(phone.price ?? phone.product.price) * RATE);
        items.push({ productId: phone.productId, qty: 1, unitPrice: price, listPrice: price, serialItemId: phone.id });
      }
      const extras = 1 + Math.floor(rand() * 2);
      for (let e = 0; e < extras; e++) {
        const a = pick(accessories.filter((x) => x.currency === 'ARS'));
        if (items.some((i) => i.productId === a.id)) continue;
        items.push({ productId: a.id, qty: 1, unitPrice: Number(a.price), listPrice: Number(a.price) });
      }
      const total = round2(items.reduce((s, i) => s + i.unitPrice, 0));
      const kind = rand();
      let payments;
      let cashArs = 0;
      let cashUsd = 0;
      if (phone && kind < 0.45) {
        // Paga el equipo en dólares y el resto en pesos.
        const usdPart = round2(items[0].unitPrice / RATE);
        payments = [
          { method: 'CASH', currency: 'USD', amount: items[0].unitPrice, fx: usdPart },
          ...(total > items[0].unitPrice ? [{ method: 'CASH', amount: round2(total - items[0].unitPrice) }] : []),
        ];
        cashUsd = usdPart;
        cashArs = round2(total - items[0].unitPrice);
      } else if (kind < 0.7) {
        payments = [{ method: 'CREDIT', amount: total, installments: 3, surcharge: round2(total * 0.15) }];
      } else if (kind < 0.85) {
        payments = [{ method: 'TRANSFER', amount: total }];
      } else {
        payments = [{ method: 'CASH', amount: total }];
        cashArs = total;
      }
      cashArsDay += cashArs;
      cashUsdDay += cashUsd;
      const cust = phone || rand() < 0.3 ? pick(customers) : null;
      events.push({
        id: randomUUID(),
        type: 'SALE',
        userId: sellerId,
        occurredAt: daysAgo(d, 11 + k * 2).toISOString(),
        cashSessionId,
        items,
        payments,
        total,
        rate: RATE,
        cashArs,
        cashUsd,
        customerId: cust?.id ?? null,
      });
      sales++;
    }
    if (d > 0) {
      events.push({ id: randomUUID(), type: 'CASH_CLOSE', userId: sellerId, occurredAt: daysAgo(d, 20).toISOString(), cashSessionId, countedAmount: round2(cashArsDay), countedUsd: round2(cashUsdDay) });
    }
    await processPosEvents(storeId, device.id, events);
  }
  // Esos equipos se vendieron hace días: la historia queda con la fecha de la venta.
  const soldItems = await prisma.saleItem.findMany({ where: { sale: { storeId }, serialItemId: { not: null } }, include: { sale: { select: { occurredAt: true } } } });
  for (const it of soldItems) {
    await prisma.serialItem.update({ where: { id: it.serialItemId! }, data: { soldAt: it.sale.occurredAt } });
    await prisma.serialEvent.updateMany({ where: { serialItemId: it.serialItemId!, type: 'SOLD' }, data: { createdAt: it.sale.occurredAt } });
  }

  // Tomas de usados: una aceptada con crédito disponible, una compra para pagar y una en curso.
  const iphone11 = phones.find((p) => p.name.startsWith('iPhone 11'))!;
  const tradeIn = async (number: number, status: 'DRAFT' | 'ACCEPTED', payout: 'CREDIT' | 'CASH', customerIdx: number) => {
    const imei = imeiFrom(500 + number);
    const t = await prisma.tradeIn.create({
      data: {
        storeId,
        number,
        customerId: customers[customerIdx].id,
        productId: iphone11.id,
        model: iphone11.name,
        imei1: imei,
        grade: 'B',
        battery: 84,
        checklist: { screen: true, touch: true, faceId: true, cameras: true, speaker: true, buttons: true, charging: true },
        accountFree: status === 'ACCEPTED',
        imeiMatches: true,
        enacomResult: status === 'ACCEPTED' ? 'CLEAN' : null,
        enacomAt: status === 'ACCEPTED' ? daysAgo(1) : null,
        enacomBy: status === 'ACCEPTED' ? seller.id : null,
        offeredUsd: 150,
        payout,
        status,
        userId: seller.id,
        createdAt: daysAgo(1),
        acceptedAt: status === 'ACCEPTED' ? daysAgo(1) : null,
      },
    });
    if (status === 'ACCEPTED') {
      const s = await prisma.serialItem.create({ data: { storeId, productId: iphone11.id, imei1: imei, condition: 'USED', grade: 'B', battery: 84, cost: 150, origin: payout === 'CASH' ? 'PURCHASE' : 'TRADE_IN', accountFree: true, receivedAt: daysAgo(1) } });
      await prisma.serialEvent.create({ data: { serialItemId: s.id, type: 'TRADE_IN', status: 'AVAILABLE', refId: t.id, userId: seller.id } });
      await prisma.tradeIn.update({ where: { id: t.id }, data: { serialItemId: s.id } });
    }
  };
  await tradeIn(1, 'ACCEPTED', 'CREDIT', 2);
  await tradeIn(2, 'ACCEPTED', 'CASH', 5);
  await tradeIn(3, 'DRAFT', 'CREDIT', 7);

  // Seña vigente sobre un equipo.
  const reserved = available.find((s) => s.product.name.startsWith('iPhone 15'))!;
  await prisma.deposit.create({
    data: { id: randomUUID(), storeId, customerId: customers[3].id, serialItemId: reserved.id, amount: 100 * RATE, currency: 'USD', fx: 100, method: 'TRANSFER', userId: seller.id, expiresAt: addDays(now, 2), createdAt: daysAgo(1) },
  });
  await prisma.serialItem.update({ where: { id: reserved.id }, data: { status: 'RESERVED', customerId: customers[3].id } });

  // Servicio técnico en distintos estados.
  const a55Glass = accessories.find((a) => a.name.startsWith('Módulo pantalla'))!;
  const repair = async (number: number, status: 'RECEIVED' | 'QUOTE_SENT' | 'IN_REPAIR' | 'READY', device: string, problem: string, customerIdx: number, quote: object[], total: number, days: number) => {
    const r = await prisma.repairOrder.create({
      data: {
        storeId,
        number,
        customerId: customers[customerIdx].id,
        device,
        imei: imeiFrom(800 + number),
        problem,
        accessories: 'Funda',
        status,
        technicianId: tech.id,
        currency: 'USD',
        quote,
        quoteTotal: total,
        diagnosisFee: 8,
        quoteApproved: status === 'IN_REPAIR' || status === 'READY' ? true : null,
        quoteSentAt: status !== 'RECEIVED' ? daysAgo(days - 1) : null,
        readyAt: status === 'READY' ? daysAgo(0, 9) : null,
        publicToken: randomToken(18),
        promisedAt: addDays(now, 2),
        userId: seller.id,
        createdAt: daysAgo(days),
      },
    });
    await prisma.repairEvent.create({ data: { repairId: r.id, status: 'RECEIVED', userId: seller.id, createdAt: daysAgo(days) } });
    if (status !== 'RECEIVED') await prisma.repairEvent.create({ data: { repairId: r.id, status, userId: tech.id } });
  };
  await repair(1, 'READY', 'Samsung Galaxy A55', 'Pantalla rota', 0, [{ kind: 'PART', productId: a55Glass.id, name: 'Módulo pantalla A55', qty: 1, price: 60 }, { kind: 'LABOR', name: 'Mano de obra', qty: 1, price: 25 }], 85, 4);
  await repair(2, 'QUOTE_SENT', 'iPhone 13', 'La batería dura muy poco', 4, [{ kind: 'LABOR', name: 'Cambio de batería', qty: 1, price: 55 }], 55, 2);
  await repair(3, 'IN_REPAIR', 'Motorola G84', 'No carga', 6, [{ kind: 'LABOR', name: 'Cambio de pin de carga', qty: 1, price: 20 }], 20, 8);
  await repair(4, 'RECEIVED', 'Xiaomi Redmi Note 12', 'Se mojó', 8, [], 0, 0);

  // Pedidos por WhatsApp e Instagram.
  const moto = available.find((s) => s.product.name.startsWith('Motorola') && s.status === 'AVAILABLE')!;
  const items = [{ productId: moto.productId, name: moto.product.name, qty: 1, unitPrice: Number(moto.price ?? moto.product.price), currency: 'USD', serialized: true, serialItemId: moto.id, imei: moto.imei1 }];
  const total = round2(items[0].unitPrice * RATE);
  const o1 = await prisma.order.create({
    data: { storeId, number: 1, channel: 'INSTAGRAM', customerId: customers[9].id, items, total, rate: RATE, deliveryFee: 5000, paymentMode: 'COD', address: 'Av. Rivadavia 5000, CABA', window: '15 a 18 hs', scheduledFor: addDays(now, 0), status: 'ASSIGNED', userId: seller.id },
  });
  await prisma.serialItem.update({ where: { id: moto.id }, data: { status: 'RESERVED', customerId: customers[9].id } });
  await prisma.delivery.create({ data: { storeId, orderId: o1.id, courierId: courier.id, collectAmount: total + 5000, collectCurrency: 'ARS', fee: 3000 } });
  const funda = accessories[0];
  await prisma.order.create({
    data: {
      storeId,
      number: 2,
      channel: 'WHATSAPP',
      customerId: customers[1].id,
      items: [{ productId: funda.id, name: funda.name, qty: 2, unitPrice: Number(funda.price), currency: 'ARS', serialized: false, serialItemId: null, imei: null }],
      total: Number(funda.price) * 2,
      rate: RATE,
      paymentMode: 'PAID',
      paidMethod: 'TRANSFER',
      delivery: false,
      status: 'PAID',
      userId: seller.id,
    },
  });
  return { sales, storeId };
}

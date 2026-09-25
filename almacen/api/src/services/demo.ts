/**
 * Local de demostración (DEMO01): datos de ejemplo con fechas relativas a hoy.
 * Dueño: dueno@demo.com / demo1234 (PIN 0000) · Empleados: sofia (PIN 1234), martin (PIN 5678).
 */
import { randomUUID } from 'node:crypto';
import { parseSettings } from '@almacen/shared';
import { prisma } from '../db';
import { addDays, dateOnly, localDateTime, localYMD, startOfLocalDay } from '../domain/dates';
import { hashPassword, hashPin, randomToken, sha256 } from '../lib/crypto';
import { clock } from './attendance';
import { processPosEvents } from './sales';
import { createStockEntry } from './stock';

export const DEMO_CODE = 'DEMO01';

function ean13(n: number) {
  const base = `779${String(n).padStart(9, '0')}`;
  const sum = [...base].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return base + ((10 - (sum % 10)) % 10);
}

/** Borra todo lo cargado en el local (menos el local y los usuarios de la demo). */
async function wipeStoreData(storeId: string) {
  await prisma.$transaction([
    prisma.saleItemLot.deleteMany({ where: { saleItem: { sale: { storeId } } } }),
    prisma.saleItem.deleteMany({ where: { sale: { storeId } } }),
    prisma.sale.deleteMany({ where: { storeId } }),
    prisma.posEvent.deleteMany({ where: { storeId } }),
    prisma.cashMovement.deleteMany({ where: { storeId } }),
    prisma.cashSession.deleteMany({ where: { storeId } }),
    prisma.attendance.deleteMany({ where: { storeId } }),
    prisma.stockCountItem.deleteMany({ where: { count: { storeId } } }),
    prisma.stockCount.deleteMany({ where: { storeId } }),
    prisma.messageRecipient.deleteMany({ where: { message: { storeId } } }),
    prisma.message.deleteMany({ where: { storeId } }),
    prisma.alert.deleteMany({ where: { storeId } }),
    prisma.offer.deleteMany({ where: { storeId } }),
    prisma.stockMovement.deleteMany({ where: { storeId } }),
    prisma.priceChange.deleteMany({ where: { storeId } }),
    prisma.lot.deleteMany({ where: { storeId } }),
    prisma.stockEntry.deleteMany({ where: { storeId } }),
    prisma.invoiceScan.deleteMany({ where: { storeId } }),
    prisma.aiUsage.deleteMany({ where: { storeId } }),
    prisma.jobRun.deleteMany({ where: { storeId } }),
    prisma.device.deleteMany({ where: { storeId } }),
    prisma.product.deleteMany({ where: { storeId } }),
    prisma.category.deleteMany({ where: { storeId } }),
    prisma.supplier.deleteMany({ where: { storeId } }),
    prisma.user.deleteMany({ where: { storeId, username: { notIn: ['dueno', 'sofia', 'martin'] } } }),
  ]);
}

/**
 * Carga (o vuelve a cargar) la demo con datos de hoy. Si el local ya existía, conserva el local y
 * los tres usuarios (así las sesiones abiertas siguen valiendo) y reemplaza todo lo demás.
 */
export async function seedDemo() {
  // Números pseudoaleatorios repetibles.
  let seed = 42;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];

  const existing = await prisma.store.findUnique({ where: { code: DEMO_CODE } });
  if (existing) await wipeStoreData(existing.id);
  const store = existing
    ? await prisma.store.update({ where: { id: existing.id }, data: { name: 'Almacén Demo', settings: {} } })
    : await prisma.store.create({ data: { name: 'Almacén Demo', code: DEMO_CODE } });
  const storeId = store.id;
  const settings = parseSettings(store.settings);

  const upsertUser = async (username: string, data: Omit<Parameters<typeof prisma.user.create>[0]['data'], 'store' | 'storeId' | 'username'>) =>
    prisma.user.upsert({
      where: { storeId_username: { storeId, username } },
      create: { storeId, username, ...data },
      update: { ...data, lang: undefined, active: true },
    });
  const owner = await upsertUser('dueno', {
    role: 'OWNER',
    name: 'Carlos',
    email: 'dueno@demo.com',
    passwordHash: await hashPassword('demo1234'),
    pinHash: hashPin('0000'),
    lang: 'es',
  });
  const sofia = await upsertUser('sofia', { name: 'Sofía', pinHash: hashPin('1234'), perms: ['sell', 'stock'], lang: 'es' });
  const martin = await upsertUser('martin', { name: 'Martín', pinHash: hashPin('5678'), perms: ['sell'], lang: 'es' });

  const cat = async (name: string) => (await prisma.category.create({ data: { storeId, name } })).id;
  const [almacen, bebidas, lacteos, limpieza, kiosco] = [await cat('Almacén'), await cat('Bebidas'), await cat('Lácteos'), await cat('Limpieza'), await cat('Kiosco')];
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
    ['Alfajor triple', kiosco, norte, 1200, 750, 12, 'UNIT'],
    ['Chocolate con leche 100g', kiosco, norte, 2500, 1600, 6, 'UNIT'],
    ['Galletitas dulces 300g', kiosco, norte, 1500, 950, 6, 'UNIT'],
    ['Papas fritas 150g', kiosco, norte, 2800, 1800, 6, 'UNIT'],
    ['Gaseosa cola 500ml', bebidas, norte, 1500, 950, 12, 'UNIT'],
    ['Vino tinto 750ml', bebidas, norte, 4500, 3000, 4, 'UNIT'],
    ['Jamón cocido', lacteos, sur, 14000, 10000, 1, 'KG'],
  ];
  const products: Awaited<ReturnType<typeof prisma.product.create>>[] = [];
  for (const [i, [name, categoryId, supplierId, price, cost, minStock, unit]] of catalog.entries()) {
    products.push(await prisma.product.create({ data: { storeId, barcode: ean13(i + 1), name, categoryId, supplierId, price, cost, minStock, unit } }));
  }
  const byName = (n: string) => products.find((p) => p.name.startsWith(n))!;
  // Botones rápidos de la caja táctil: lo que más sale del kiosco y las bebidas frías.
  const quick = ['Alfajor', 'Chocolate', 'Galletitas', 'Papas fritas', 'Gaseosa cola 500ml', 'Cerveza lata', 'Agua mineral'];
  await prisma.product.updateMany({ where: { id: { in: quick.map((n) => byName(n).id) } }, data: { quickKey: true } });

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
  await prisma.product.update({ where: { id: byName('Cerveza lata').id }, data: { idealStock: 120 } });
  await prisma.product.update({ where: { id: byName('Alfajor').id }, data: { idealStock: 60 } });

  // 2) Ventas de los últimos 14 días y de hoy, en dos turnos de caja por día: Sofía a la mañana (8 a 14)
  //    y Martín a la tarde (14 a 21). Cada turno cierra con la plata justa; el turno en curso queda abierto.
  const device = await prisma.device.create({ data: { storeId, name: 'Caja demo', tokenHash: sha256(randomToken()) } });
  const now = Date.now();
  const H = 3_600_000;
  const iso = (t: number) => new Date(t).toISOString();
  const events: Record<string, unknown>[] = [];
  const todayStart = startOfLocalDay(store.timezone).getTime();
  for (let d = 14; d >= 0; d--) {
    const dayStart = startOfLocalDay(store.timezone, addDays(new Date(), -d)).getTime();
    // Hoy la caja abre sí o sí (aunque la demo se cargue de madrugada) para que haya ventas del día.
    const shifts = [
      { id: randomUUID(), user: sofia, open: d === 0 ? Math.min(dayStart + 8 * H, now - 3 * H) : dayStart + 8 * H, close: dayStart + 14 * H },
      { id: randomUUID(), user: martin, open: dayStart + 14 * H, close: dayStart + 21 * H },
    ].filter((s) => s.open < now);
    const cash = new Map(shifts.map((s) => [s.id, 30000]));
    for (const s of shifts) events.push({ id: randomUUID(), type: 'CASH_OPEN', userId: s.user.id, occurredAt: iso(s.open), cashSessionId: s.id, openingAmount: 30000 });
    const perDay = d === 0 ? 6 : 7;
    for (let n = 0; n < perDay; n++) {
      let when = dayStart + (9 + rand() * 11) * H;
      if (when > now) when = now - 60_000 * (n + 1);
      const shift = [...shifts].reverse().find((s) => when >= s.open) ?? shifts[0];
      const items = [...new Set(Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(products)))].map((p) => {
        const qty = p.unit === 'KG' ? Math.round((0.2 + rand() * 0.4) * 1000) / 1000 : 1 + Math.floor(rand() * 2);
        return { productId: p.id, qty, unitPrice: Number(p.price), listPrice: Number(p.price) };
      });
      const total = Math.round(items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0) * 100) / 100;
      const method = pick(['CASH', 'CASH', 'DEBIT', 'QR']);
      if (method === 'CASH') cash.set(shift.id, cash.get(shift.id)! + total);
      events.push({
        id: randomUUID(),
        type: 'SALE',
        userId: shift.user.id,
        occurredAt: iso(when),
        items,
        payments: [{ method, amount: total }],
        total,
        cashSessionId: shift.id,
      });
    }
    if (d === 0) {
      // Hoy a la mañana se le pagó a un proveedor con plata de la caja.
      events.push({
        id: randomUUID(),
        type: 'CASH_MOVE',
        userId: sofia.id,
        occurredAt: iso(Math.max(shifts[0].open + 60_000, Math.min(todayStart + 10.5 * H, now - 120_000))),
        cashSessionId: shifts[0].id,
        kind: 'SUPPLIER',
        amount: 18500,
        reason: 'Factura de mercadería',
        supplierId: norte,
      });
      cash.set(shifts[0].id, cash.get(shifts[0].id)! - 18500);
    }
    if (d === 0) {
      // Sofía avisa desde la caja que se están terminando las galletitas.
      events.push({ id: randomUUID(), type: 'SHORTAGE', userId: sofia.id, occurredAt: iso(now - 90_000), productId: byName('Galletitas').id });
    }
    // Pase de turno: lo que dejó anotado el que cerró la caja.
    const handover = (s: (typeof shifts)[number]) =>
      d === 0 && s.user === sofia
        ? 'Se terminó el cambio chico, hay que pedir monedas. Vino el de Coca: vuelve el jueves con el pedido.'
        : d === 1 && s.user === martin
          ? 'Quedan pocas cervezas en la heladera. Limpié la máquina de café.'
          : undefined;
    for (const s of shifts) {
      if (s.close >= now) continue;
      const notes = handover(s);
      events.push({
        id: randomUUID(),
        type: 'CASH_CLOSE',
        userId: s.user.id,
        occurredAt: iso(s.close),
        cashSessionId: s.id,
        countedAmount: Math.round(cash.get(s.id)! * 100) / 100,
        ...(notes ? { notes } : {}),
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

  // 4) Ficha, horario y fichajes de las últimas dos semanas (Martín llegó tarde dos veces y faltó una).
  const tz = store.timezone;
  const week = (start: string, end: string) => [null, ...Array.from({ length: 6 }, () => ({ start, end }))];
  const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
  await prisma.user.update({
    where: { id: sofia.id },
    data: { dni: '38.456.123', phone: '11 5555-1234', hiredAt: dateOnly(inDays(-400)), salary: 850000, schedule: week('08:00', '16:00') },
  });
  await prisma.user.update({
    where: { id: martin.id },
    data: { dni: '41.987.654', phone: '11 5555-5678', hiredAt: dateOnly(inDays(-120)), salary: 780000, schedule: week('13:00', '21:00') },
  });
  const shifts = [
    { user: sofia, start: '08:00', end: '16:00', late: {} as Record<number, number>, absent: [] as number[] },
    { user: martin, start: '13:00', end: '21:00', late: { 3: 17, 8: 25 } as Record<number, number>, absent: [5] },
  ];
  const attendance = [];
  for (const s of shifts) {
    for (let d = 14; d >= 1; d--) {
      if (weekday(inDays(-d)) === 0 || s.absent.includes(d)) continue;
      const delay = s.late[d] ?? Math.round(rand() * 8) - 6;
      const inAt = new Date(localDateTime(tz, inDays(-d), s.start).getTime() + delay * 60_000);
      const outAt = new Date(localDateTime(tz, inDays(-d), s.end).getTime() + Math.round(rand() * 10) * 60_000);
      attendance.push({ id: randomUUID(), storeId, userId: s.user.id, inAt, outAt, inSource: 'pos', outSource: 'pos', deviceId: device.id, lateMin: delay > 0 ? delay : null });
    }
  }
  await prisma.attendance.createMany({ data: attendance });
  if (weekday(today) !== 0) {
    // Hoy: Sofía llegó a horario y Martín 17 minutos tarde (le llega el aviso al dueño).
    const clockAt = async (userId: string, hhmm: string, action: 'in' | 'out', source: 'pos' | 'phone') => {
      const at = localDateTime(tz, today, hhmm);
      if (at.getTime() >= now) return;
      await prisma.$transaction((tx) => clock(tx, { id: randomUUID(), storeId, userId, action, at, source, deviceId: source === 'pos' ? device.id : null }));
    };
    await clockAt(sofia.id, '07:58', 'in', 'pos');
    await clockAt(sofia.id, '16:03', 'out', 'pos');
    await clockAt(martin.id, '13:17', 'in', 'phone');
    await clockAt(martin.id, '21:02', 'out', 'pos');
  }

  // 5) Mensajes del dueño.
  const msg = await prisma.message.create({
    data: { storeId, fromUserId: owner.id, text: 'Mañana a las 8 llega mercadería, por favor ordenen el depósito.', lang: 'es' },
  });
  await prisma.messageRecipient.createMany({ data: [sofia.id, martin.id].map((userId) => ({ messageId: msg.id, userId })) });
  const task = await prisma.message.create({
    data: {
      storeId,
      fromUserId: owner.id,
      kind: 'TASK',
      text: 'Ordená la heladera de lácteos y sacale una foto al terminar.',
      lang: 'es',
      requiresPhoto: true,
      dueAt: addDays(new Date(), 1),
    },
  });
  await prisma.messageRecipient.create({ data: { messageId: task.id, userId: sofia.id } });

  return { storeId, sales: events.filter((e) => e.type === 'SALE').length };
}

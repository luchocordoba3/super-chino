// Casa de celulares: dólar, clientes, equipos con IMEI, garantías y señas.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { effectiveRate, isValidImei, parseSettings } from '@super-chino/shared';
import { num, prisma, type Prisma } from '../db';
import { dateOnly } from '../domain/dates';
import { guard } from '../lib/auth';
import { badRequest, notFound, sentOnly } from '../lib/http';
import { readImage, saveImage } from '../lib/uploads';
import { latestQuotes, refreshRates, storeRate } from '../services/fx';
import { publish } from '../services/notify';
import { checkSerialUnique, findSerial, getSerial, serialDto, serialEvent, setSerialStatus } from '../services/phones';
import { userNames } from '../services/store';

const digits = (v?: string | null) => (v ? v.replace(/\D/g, '') || null : null);
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

const customerBody = z.object({
  name: z.string().trim().min(1).max(80),
  dni: optText(20).transform(digits),
  phone: optText(30).transform(digits),
  email: optText(80),
  address: optText(200),
  notes: optText(500),
});

const serialFields = z.object({
  imei1: optText(20),
  imei2: optText(20),
  serial: optText(40),
  condition: z.enum(['NEW', 'USED', 'REFURB']).default('NEW'),
  grade: z.enum(['A', 'B', 'C']).nullish(),
  battery: z.number().int().min(0).max(100).nullish(),
  color: optText(30),
  carrierLocked: z.boolean().default(false),
  accountFree: z.boolean().nullish(),
  includes: optText(120),
  notes: optText(500),
  price: z.number().min(0).max(1e9).nullish(),
  cost: z.number().min(0).max(1e9).default(0),
  supplierWarrantyUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export async function phoneRoutes(app: FastifyInstance) {
  // ---------- Dólar ----------
  app.get('/fx', guard(), async (req) => {
    const store = await prisma.store.findUniqueOrThrow({ where: { id: req.auth.sid } });
    const quotes = await latestQuotes();
    return { quotes, rate: effectiveRate(parseSettings(store.settings), quotes) };
  });
  app.post('/fx/refresh', guard('owner'), async (req) => {
    const saved = await refreshRates(fetch, req.log);
    publish(req.auth.sid, 'catalog');
    return { saved, ...(await storeRate(req.auth.sid)) };
  });

  // ---------- Clientes ----------
  app.get('/customers', guard(), async (req) => {
    const q = z.object({ q: z.string().trim().max(60).optional() }).parse(req.query);
    const term = q.q ?? '';
    const d = term.replace(/\D/g, '');
    return prisma.customer.findMany({
      where: {
        storeId: req.auth.sid,
        ...(term
          ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, ...(d.length >= 3 ? [{ dni: { contains: d } }, { phone: { contains: d } }] : [])] }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: term ? 30 : 200,
    });
  });

  app.post('/customers', guard(), async (req) => {
    const b = customerBody.parse(req.body);
    if (b.dni) {
      const same = await prisma.customer.findFirst({ where: { storeId: req.auth.sid, dni: b.dni } });
      if (same) return same;
    }
    return prisma.customer.create({ data: { ...b, storeId: req.auth.sid } });
  });

  app.patch('/customers/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const b = sentOnly(customerBody.partial().parse(req.body), req.body);
    const c = await prisma.customer.findFirst({ where: { id, storeId: req.auth.sid } });
    if (!c) throw notFound();
    return prisma.customer.update({ where: { id }, data: b });
  });

  /** Ficha completa: compras, equipos, garantías, tomas, reparaciones, pedidos y señas. */
  app.get('/customers/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const storeId = req.auth.sid;
    const c = await prisma.customer.findFirst({ where: { id, storeId } });
    if (!c) throw notFound();
    const [sales, items, tradeIns, repairs, orders, deposits, names] = await Promise.all([
      prisma.sale.findMany({ where: { storeId, customerId: id }, include: { items: true }, orderBy: { occurredAt: 'desc' }, take: 50 }),
      prisma.serialItem.findMany({ where: { storeId, customerId: id }, include: { product: true }, orderBy: { updatedAt: 'desc' } }),
      prisma.tradeIn.findMany({ where: { storeId, customerId: id }, orderBy: { createdAt: 'desc' } }),
      prisma.repairOrder.findMany({ where: { storeId, customerId: id }, orderBy: { createdAt: 'desc' } }),
      prisma.order.findMany({ where: { storeId, customerId: id }, orderBy: { createdAt: 'desc' } }),
      prisma.deposit.findMany({ where: { storeId, customerId: id }, orderBy: { createdAt: 'desc' } }),
      userNames(prisma, storeId),
    ]);
    const today = new Date();
    return {
      ...c,
      sales: sales.map((s) => ({
        id: s.id,
        occurredAt: s.occurredAt,
        status: s.status,
        total: num(s.total),
        rate: s.rate == null ? null : num(s.rate),
        user: names.get(s.userId) ?? null,
        items: s.items.map((i) => ({ name: i.name, qty: num(i.qty), lineTotal: num(i.lineTotal), serialItemId: i.serialItemId, warrantyUntil: i.warrantyUntil })),
      })),
      items: items.map((s) => ({ ...serialDto(s), underWarranty: !!s.warrantyUntil && s.warrantyUntil >= today })),
      tradeIns: tradeIns.map((t) => ({ id: t.id, number: t.number, model: t.model, imei1: t.imei1, status: t.status, offeredUsd: num(t.offeredUsd), createdAt: t.createdAt })),
      repairs: repairs.map((r) => ({ id: r.id, number: r.number, device: r.device, status: r.status, quoteTotal: num(r.quoteTotal), currency: r.currency, createdAt: r.createdAt })),
      orders: orders.map((o) => ({ id: o.id, number: o.number, status: o.status, total: num(o.total), channel: o.channel, createdAt: o.createdAt })),
      deposits: deposits.map((d) => ({ id: d.id, amount: num(d.amount), currency: d.currency, fx: d.fx == null ? null : num(d.fx), status: d.status, expiresAt: d.expiresAt, createdAt: d.createdAt })),
      totalSpent: sales.filter((s) => s.status === 'COMPLETED').reduce((sum, s) => sum + num(s.total), 0),
    };
  });

  // ---------- Equipos con IMEI ----------
  app.get('/serials', guard(), async (req) => {
    const q = z
      .object({
        status: z.enum(['AVAILABLE', 'RESERVED', 'IN_REPAIR', 'SOLD', 'RMA', 'SCRAPPED', 'STOCK']).optional(),
        productId: z.string().optional(),
        q: z.string().trim().max(40).optional(),
      })
      .parse(req.query);
    const d = q.q?.replace(/\D/g, '') ?? '';
    const rows = await prisma.serialItem.findMany({
      where: {
        storeId: req.auth.sid,
        productId: q.productId,
        ...(q.status === 'STOCK' ? { status: { in: ['AVAILABLE', 'RESERVED', 'IN_REPAIR', 'RMA'] } } : q.status ? { status: q.status } : {}),
        ...(q.q
          ? {
              OR: [
                ...(d.length >= 4 ? [{ imei1: { contains: d } }, { imei2: { contains: d } }] : []),
                { serial: { contains: q.q, mode: 'insensitive' as const } },
                { product: { name: { contains: q.q, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      include: { product: true },
      orderBy: { receivedAt: 'desc' },
      take: 500,
    });
    return rows.map(serialDto);
  });

  app.get('/serials/lookup/:code', guard(), async (req) => {
    const { code } = req.params as { code: string };
    const s = await findSerial(prisma, req.auth.sid, code);
    return { item: s ? serialDto(s) : null };
  });

  app.get('/serials/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const s = await getSerial(prisma, req.auth.sid, id);
    const [events, names, customer, sale] = await Promise.all([
      prisma.serialEvent.findMany({ where: { serialItemId: id }, orderBy: { createdAt: 'desc' } }),
      userNames(prisma, req.auth.sid),
      s.customerId ? prisma.customer.findUnique({ where: { id: s.customerId } }) : null,
      s.saleId ? prisma.sale.findUnique({ where: { id: s.saleId }, select: { id: true, occurredAt: true, total: true, rate: true, userId: true } }) : null,
    ]);
    return {
      ...serialDto(s),
      customer,
      sale: sale ? { ...sale, user: names.get(sale.userId) ?? null } : null,
      events: events.map((e) => ({ ...e, user: e.userId ? (names.get(e.userId) ?? null) : null })),
    };
  });

  /** Ingreso de equipos (uno o muchos, ej. desde Excel): mismo modelo, cada uno con su IMEI. */
  app.post('/serials', guard('stock'), async (req) => {
    const b = z
      .object({
        productId: z.string().min(1),
        supplierId: z.string().nullish(),
        items: z.array(serialFields).min(1).max(500),
        skipImeiCheck: z.boolean().default(false),
      })
      .parse(req.body);
    const storeId = req.auth.sid;
    const product = await prisma.product.findFirst({ where: { id: b.productId, storeId } });
    if (!product) throw notFound('product_not_found');
    if (b.supplierId && !(await prisma.supplier.findFirst({ where: { id: b.supplierId, storeId } }))) throw notFound('supplier_not_found');
    for (const it of b.items) {
      if (!b.skipImeiCheck && it.imei1 && !isValidImei(it.imei1)) throw badRequest('invalid_imei', it.imei1);
    }
    const created = await prisma.$transaction(async (tx) => {
      const out = [];
      if (!product.serialized) await tx.product.update({ where: { id: product.id }, data: { serialized: true } });
      for (const it of b.items) {
        const ids = await checkSerialUnique(tx, storeId, it);
        const s = await tx.serialItem.create({
          data: {
            storeId,
            productId: product.id,
            ...ids,
            condition: it.condition,
            grade: it.grade ?? null,
            battery: it.battery ?? null,
            color: it.color,
            carrierLocked: it.carrierLocked,
            accountFree: it.accountFree ?? null,
            includes: it.includes,
            notes: it.notes,
            price: it.price ?? null,
            cost: it.cost,
            supplierId: b.supplierId ?? null,
            origin: 'SUPPLIER',
            supplierWarrantyUntil: it.supplierWarrantyUntil ? dateOnly(it.supplierWarrantyUntil) : null,
          },
        });
        await serialEvent(tx, { serialItemId: s.id, type: 'IN', status: 'AVAILABLE', userId: req.auth.uid });
        out.push(s.id);
      }
      if (b.items[0].cost > 0) await tx.product.update({ where: { id: product.id }, data: { cost: b.items[b.items.length - 1].cost } });
      return out;
    });
    publish(storeId, 'catalog');
    publish(storeId, 'phones');
    return { created: created.length, ids: created };
  });

  /** Editar un equipo o cambiarle el estado (garantía con proveedor, baja, en reparación, disponible). */
  app.patch('/serials/:id', guard('stock'), async (req) => {
    const { id } = req.params as { id: string };
    const b = sentOnly(
      serialFields
        .partial()
        .extend({
          status: z.enum(['AVAILABLE', 'IN_REPAIR', 'RMA', 'SCRAPPED']).optional(),
          note: z.string().trim().max(300).optional(),
          productId: z.string().optional(),
        })
        .parse(req.body),
      req.body,
    );
    const storeId = req.auth.sid;
    const s = await getSerial(prisma, storeId, id);
    await prisma.$transaction(async (tx) => {
      const { status, note, supplierWarrantyUntil, imei1, imei2, serial, productId, ...rest } = b;
      const data: Prisma.SerialItemUpdateInput = { ...rest };
      if (imei1 !== undefined || imei2 !== undefined || serial !== undefined) {
        Object.assign(data, await checkSerialUnique(tx, storeId, { imei1: imei1 === undefined ? s.imei1 : imei1, imei2: imei2 === undefined ? s.imei2 : imei2, serial: serial === undefined ? s.serial : serial }, id));
      }
      if (supplierWarrantyUntil !== undefined) data.supplierWarrantyUntil = supplierWarrantyUntil ? dateOnly(supplierWarrantyUntil) : null;
      if (productId && productId !== s.productId) {
        if (!(await tx.product.findFirst({ where: { id: productId, storeId } }))) throw notFound('product_not_found');
        data.product = { connect: { id: productId } };
      }
      if (Object.keys(data).length) {
        await tx.serialItem.update({ where: { id }, data });
        await serialEvent(tx, { serialItemId: id, type: 'EDIT', userId: req.auth.uid, note: Object.keys(data).join(', ') });
      }
      if (status && status !== s.status) {
        if (s.status === 'SOLD' && status !== 'IN_REPAIR' && status !== 'RMA') throw badRequest('serial_sold');
        await setSerialStatus(tx, id, status, { type: 'STATUS', userId: req.auth.uid, note: note ?? null });
      }
    });
    publish(storeId, 'phones');
    publish(storeId, 'catalog');
    return serialDto(await getSerial(prisma, storeId, id));
  });

  app.post('/serials/:id/photo', guard('stock'), async (req) => {
    const { id } = req.params as { id: string };
    const s = await getSerial(prisma, req.auth.sid, id);
    const img = await readImage(req);
    if (!img?.data.length) throw badRequest('invalid_image');
    const path = await saveImage(req.auth.sid, img.data, img.mimetype);
    await prisma.serialItem.update({ where: { id }, data: { photos: [...s.photos, path].slice(-8) } });
    return { path };
  });

  /** Garantía por IMEI: qué es, a quién se le vendió, cuándo y hasta cuándo cubre. */
  app.get('/warranty/:code', guard(), async (req) => {
    const { code } = req.params as { code: string };
    const s = await findSerial(prisma, req.auth.sid, code);
    if (!s) return { item: null };
    const [customer, sale, repairs] = await Promise.all([
      s.customerId ? prisma.customer.findUnique({ where: { id: s.customerId } }) : null,
      s.saleId ? prisma.sale.findUnique({ where: { id: s.saleId }, select: { id: true, occurredAt: true, total: true } }) : null,
      prisma.repairOrder.findMany({ where: { storeId: req.auth.sid, OR: [{ serialItemId: s.id }, ...(s.imei1 ? [{ imei: s.imei1 }] : [])] }, orderBy: { createdAt: 'desc' } }),
    ]);
    const today = new Date();
    return {
      item: serialDto(s),
      customer,
      sale,
      underWarranty: !!s.warrantyUntil && s.warrantyUntil >= today,
      supplierWarranty: !!s.supplierWarrantyUntil && s.supplierWarrantyUntil >= today,
      repairs: repairs.map((r) => ({ id: r.id, number: r.number, status: r.status, problem: r.problem, createdAt: r.createdAt })),
    };
  });

  // ---------- Señas ----------
  app.get('/deposits', guard(), async (req) => {
    const q = z.object({ status: z.enum(['ACTIVE', 'USED', 'EXPIRED', 'CANCELLED']).optional() }).parse(req.query);
    const rows = await prisma.deposit.findMany({
      where: { storeId: req.auth.sid, status: q.status },
      include: { customer: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const serials = await prisma.serialItem.findMany({ where: { id: { in: rows.flatMap((r) => (r.serialItemId ? [r.serialItemId] : [])) } }, include: { product: true } });
    const byId = new Map(serials.map((s) => [s.id, s]));
    return rows.map((d) => ({
      ...d,
      amount: num(d.amount),
      fx: d.fx == null ? null : num(d.fx),
      item: d.serialItemId && byId.get(d.serialItemId) ? { name: byId.get(d.serialItemId)!.product.name, imei: byId.get(d.serialItemId)!.imei1 } : null,
    }));
  });

  /** Cancelar una seña (la plata se devuelve desde la caja como retiro). Libera el equipo. */
  app.post('/deposits/:id/cancel', guard('owner'), async (req) => {
    const { id } = req.params as { id: string };
    const d = await prisma.deposit.findFirst({ where: { id, storeId: req.auth.sid, status: 'ACTIVE' } });
    if (!d) throw notFound();
    await prisma.$transaction(async (tx) => {
      await tx.deposit.update({ where: { id }, data: { status: 'CANCELLED' } });
      if (d.serialItemId) {
        const s = await tx.serialItem.findUnique({ where: { id: d.serialItemId } });
        if (s?.status === 'RESERVED') await setSerialStatus(tx, s.id, 'AVAILABLE', { type: 'RELEASED', refId: id, userId: req.auth.uid, data: { customerId: null } });
      }
    });
    publish(req.auth.sid, 'phones');
    return { ok: true };
  });

  // ---------- Grilla de precios para tomar usados (USD) ----------
  app.get('/tradein-prices', guard(), async (req) => {
    const rows = await prisma.tradeInPrice.findMany({ where: { storeId: req.auth.sid }, include: { product: { select: { name: true } } }, orderBy: { product: { name: 'asc' } } });
    return rows.map((r) => ({ id: r.id, productId: r.productId, product: r.product.name, grade: r.grade, price: num(r.price) }));
  });
  app.put('/tradein-prices', guard('prices'), async (req) => {
    const b = z.object({ rows: z.array(z.object({ productId: z.string(), grade: z.enum(['A', 'B', 'C']), price: z.number().min(0).max(1e6).nullable() })).max(1000) }).parse(req.body);
    const storeId = req.auth.sid;
    const ids = [...new Set(b.rows.map((r) => r.productId))];
    const ok = await prisma.product.count({ where: { storeId, id: { in: ids } } });
    if (ok !== ids.length) throw notFound('product_not_found');
    await prisma.$transaction(
      b.rows.map((r) =>
        r.price == null
          ? prisma.tradeInPrice.deleteMany({ where: { storeId, productId: r.productId, grade: r.grade } })
          : prisma.tradeInPrice.upsert({
              where: { productId_grade: { productId: r.productId, grade: r.grade } },
              create: { storeId, productId: r.productId, grade: r.grade, price: r.price },
              update: { price: r.price },
            }),
      ),
    );
    return { ok: true };
  });
}

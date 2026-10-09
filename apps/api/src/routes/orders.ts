// Pedidos por WhatsApp / Instagram y entregas con cadete: asignación, prueba de entrega y rendición de lo cobrado.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ORDER_CHANNELS, ORDER_STATUSES, type Payment, round2, toArs } from '@super-chino/shared';
import { num, prisma, type Prisma, type Tx } from '../db';
import { addDays, dateOnly } from '../domain/dates';
import { can, guard } from '../lib/auth';
import { badRequest, HttpError, notFound, sentOnly } from '../lib/http';
import { fileUrl, readImage, saveImage } from '../lib/uploads';
import { notifyAlerts } from '../services/alerts';
import { storeRate } from '../services/fx';
import { publish, pushTo } from '../services/notify';
import { nextNumber, resolveCustomer, serviceProduct, setSerialStatus } from '../services/phones';
import { applySale, applyVoid, saleCtx } from '../services/sales';
import { userNames } from '../services/store';

const Item = z.object({
  productId: z.string().min(1),
  qty: z.number().int().positive().max(100).default(1),
  /** En la moneda del producto; si no viene, el precio de lista (o el del equipo). */
  unitPrice: z.number().min(0).max(1e9).nullish(),
  serialItemId: z.string().nullish(),
});
type StoredItem = { productId: string; name: string; qty: number; unitPrice: number; currency: string; serialized: boolean; serialItemId: string | null; imei: string | null };

const body = z.object({
  channel: z.enum(ORDER_CHANNELS).default('WHATSAPP'),
  customerId: z.string().nullish(),
  customer: z.object({ name: z.string().trim().min(1).max(80), phone: z.string().trim().max(30).nullish(), dni: z.string().trim().max(20).nullish() }).nullish(),
  items: z.array(Item).min(1).max(30),
  deliveryFee: z.number().min(0).max(1e9).default(0),
  paymentMode: z.enum(['PAID', 'COD']).default('COD'),
  codCurrency: z.enum(['ARS', 'USD']).default('ARS'),
  paidMethod: z.enum(['TRANSFER', 'QR', 'CASH', 'DEBIT', 'CREDIT']).nullish(),
  delivery: z.boolean().default(true),
  address: z.string().trim().max(200).nullish(),
  addressNotes: z.string().trim().max(200).nullish(),
  window: z.string().trim().max(60).nullish(),
  scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  notes: z.string().trim().max(500).nullish(),
});

const itemsOf = (raw: unknown) => (Array.isArray(raw) ? (raw as StoredItem[]) : []);

/** Arma los renglones con nombre y precio; reserva los equipos con IMEI que se eligieron. */
async function buildItems(tx: Tx, storeId: string, items: z.infer<typeof Item>[], rate: number | null, orderId: string | null, prev: StoredItem[], userId: string) {
  const out: StoredItem[] = [];
  const keep = new Set<string>();
  for (const it of items) {
    const p = await tx.product.findFirst({ where: { id: it.productId, storeId } });
    if (!p) throw notFound('product_not_found');
    let imei: string | null = null;
    let price = it.unitPrice ?? num(p.price);
    if (it.serialItemId) {
      const s = await tx.serialItem.findFirst({ where: { id: it.serialItemId, storeId, productId: p.id } });
      if (!s) throw notFound('serial_not_found');
      const mine = prev.some((x) => x.serialItemId === s.id);
      if (!mine && s.status !== 'AVAILABLE') throw new HttpError(409, 'serial_not_available');
      if (!mine) await setSerialStatus(tx, s.id, 'RESERVED', { type: 'RESERVED', refId: orderId, userId, note: 'Pedido' });
      keep.add(s.id);
      imei = s.imei1 ?? s.serial;
      if (it.unitPrice == null && s.price != null) price = num(s.price);
    }
    out.push({ productId: p.id, name: p.name, qty: it.serialItemId ? 1 : it.qty, unitPrice: price, currency: p.currency, serialized: p.serialized, serialItemId: it.serialItemId ?? null, imei });
  }
  // Los equipos que se sacaron del pedido vuelven a estar disponibles.
  for (const old of prev) if (old.serialItemId && !keep.has(old.serialItemId)) await releaseSerial(tx, old.serialItemId, userId);
  const total = round2(out.reduce((s, i) => s + i.qty * toArs(i.unitPrice, i.currency, rate), 0));
  return { items: out, total };
}

async function releaseSerial(tx: Tx, id: string, userId: string) {
  const s = await tx.serialItem.findUnique({ where: { id } });
  if (s?.status === 'RESERVED') await setSerialStatus(tx, id, 'AVAILABLE', { type: 'RELEASED', userId, data: { customerId: null } });
}

type OrderRow = Prisma.OrderGetPayload<{ include: { customer: true; deliveries: true } }>;
function dto(o: OrderRow, names: Map<string, string>) {
  const last = [...o.deliveries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return {
    ...o,
    items: itemsOf(o.items),
    total: num(o.total),
    rate: o.rate == null ? null : num(o.rate),
    deliveryFee: num(o.deliveryFee),
    user: names.get(o.userId) ?? null,
    delivery: o.delivery,
    deliveries: undefined,
    lastDelivery: last ? deliveryDto(last, names) : null,
  };
}
type DeliveryRow = Prisma.DeliveryGetPayload<object>;
const deliveryDto = (d: DeliveryRow, names: Map<string, string>) => ({
  ...d,
  collectAmount: num(d.collectAmount),
  collected: d.collected == null ? null : num(d.collected),
  fee: num(d.fee),
  courier: d.courierId ? (names.get(d.courierId) ?? d.courierName) : d.courierName,
  proofPhoto: fileUrl(d.proofPhoto),
});

async function load(storeId: string, id: string) {
  const o = await prisma.order.findFirst({ where: { id, storeId }, include: { customer: true, deliveries: true } });
  if (!o) throw notFound();
  return o;
}

/** Señas activas de un pedido (se descuentan de lo que hay que cobrar). */
async function orderDeposits(db: Tx | typeof prisma, storeId: string, orderId: string) {
  return db.deposit.findMany({ where: { storeId, orderId, status: 'ACTIVE' } });
}

/** Entregado: se genera la venta (vendedor = quien tomó el pedido) y empieza el plazo para arrepentirse. */
async function completeOrder(tx: Tx, o: OrderRow, collected: number | null) {
  const storeId = o.storeId;
  const ctx = await saleCtx(storeId, null);
  const rate = o.rate != null ? num(o.rate) : ctx.rate;
  const items = itemsOf(o.items);
  if (items.some((i) => i.serialized && !i.serialItemId)) throw badRequest('assign_imei_first');
  const saleItems = items.map((i) => {
    const price = toArs(i.unitPrice, i.currency, rate);
    return { productId: i.productId, qty: i.qty, unitPrice: price, listPrice: price, priceOverride: false, serialItemId: i.serialItemId };
  });
  if (num(o.deliveryFee) > 0) {
    const ship = await serviceProduct(tx, storeId, 'SHIPPING');
    saleItems.push({ productId: ship.id, qty: 1, unitPrice: num(o.deliveryFee), listPrice: num(o.deliveryFee), priceOverride: false, serialItemId: null });
  }
  const total = round2(saleItems.reduce((s, i) => s + i.qty * i.unitPrice, 0));
  const payments: Payment[] = [];
  let rest = total;
  for (const dep of await orderDeposits(tx, storeId, o.id)) {
    const amount = Math.min(rest, num(dep.amount));
    if (amount <= 0) continue;
    payments.push({ method: 'DEPOSIT', amount, ref: dep.id });
    rest = round2(rest - amount);
  }
  if (rest > 0) {
    if (o.paymentMode === 'PAID') payments.push({ method: (o.paidMethod as Payment['method']) ?? 'TRANSFER', amount: rest });
    else if (o.codCurrency === 'USD') payments.push({ method: 'CASH', currency: 'USD', amount: rest, fx: collected ?? (rate ? round2(rest / rate) : 0) });
    else payments.push({ method: 'CASH', amount: rest });
  }
  if (payments.length === 0) payments.push({ method: 'TRANSFER', amount: 0 });
  const saleId = randomUUID();
  const alerts = await applySale(
    tx,
    ctx,
    {
      id: saleId,
      type: 'SALE',
      userId: o.userId,
      occurredAt: new Date().toISOString(),
      cashSessionId: null,
      items: saleItems,
      payments,
      total,
      customerId: o.customerId,
      rate: rate ?? undefined,
      // Lo cobra el cadete: no entra al cajón hasta que rinde.
      cashArs: 0,
      cashUsd: 0,
    },
    { channel: 'ORDER', orderId: o.id },
  );
  await tx.order.update({ where: { id: o.id }, data: { status: 'DELIVERED', saleId, withdrawalUntil: addDays(new Date(), 10) } });
  return alerts;
}

export async function orderRoutes(app: FastifyInstance) {
  app.get('/orders', guard('orders', 'reports', 'deliveries'), async (req) => {
    const q = z.object({ status: z.enum(ORDER_STATUSES).optional(), open: z.coerce.boolean().optional(), q: z.string().trim().max(40).optional() }).parse(req.query);
    const rows = await prisma.order.findMany({
      where: {
        storeId: req.auth.sid,
        status: q.status ?? (q.open ? { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED'] } : undefined),
        ...(q.q ? { OR: [{ customer: { name: { contains: q.q, mode: 'insensitive' } } }, ...(/^\d+$/.test(q.q) ? [{ number: Number(q.q) }] : [])] } : {}),
      },
      include: { customer: true, deliveries: true },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const names = await userNames(prisma, req.auth.sid);
    return rows.map((o) => dto(o, names));
  });

  app.get('/orders/:id', guard('orders', 'reports', 'deliveries'), async (req) => {
    const { id } = req.params as { id: string };
    const o = await load(req.auth.sid, id);
    const names = await userNames(prisma, req.auth.sid);
    const deposits = await prisma.deposit.findMany({ where: { storeId: req.auth.sid, orderId: id } });
    return {
      ...dto(o, names),
      deliveries: o.deliveries.map((d) => deliveryDto(d, names)),
      deposits: deposits.map((d) => ({ id: d.id, amount: num(d.amount), currency: d.currency, fx: d.fx == null ? null : num(d.fx), status: d.status })),
    };
  });

  app.post('/orders', guard('orders'), async (req) => {
    const b = body.parse(req.body);
    const storeId = req.auth.sid;
    const { rate } = await storeRate(storeId);
    const o = await prisma.$transaction(async (tx) => {
      let customerId = b.customerId ? await resolveCustomer(tx, storeId, b.customerId) : null;
      if (!customerId) {
        if (!b.customer) throw badRequest('customer_required');
        customerId = await resolveCustomer(tx, storeId, null, { id: randomUUID(), name: b.customer.name, phone: b.customer.phone ?? undefined, dni: b.customer.dni ?? undefined });
      }
      const number = await nextNumber(tx, 'order', storeId);
      const created = await tx.order.create({
        data: {
          storeId,
          number,
          channel: b.channel,
          customerId: customerId!,
          deliveryFee: b.deliveryFee,
          paymentMode: b.paymentMode,
          codCurrency: b.codCurrency,
          paidMethod: b.paidMethod ?? null,
          delivery: b.delivery,
          address: b.address || null,
          addressNotes: b.addressNotes || null,
          window: b.window || null,
          scheduledFor: b.scheduledFor ? dateOnly(b.scheduledFor) : null,
          notes: b.notes || null,
          rate,
          status: b.paymentMode === 'PAID' ? 'PAID' : 'INQUIRY',
          userId: req.auth.uid,
        },
      });
      const built = await buildItems(tx, storeId, b.items, rate, created.id, [], req.auth.uid);
      const hasSerial = built.items.some((i) => i.serialItemId);
      return tx.order.update({
        where: { id: created.id },
        data: { items: built.items, total: built.total, status: b.paymentMode === 'PAID' ? 'PAID' : hasSerial ? 'RESERVED' : 'INQUIRY' },
        include: { customer: true, deliveries: true },
      });
    });
    publish(storeId, 'orders');
    publish(storeId, 'catalog');
    return dto(o, await userNames(prisma, storeId));
  });

  app.patch('/orders/:id', guard('orders'), async (req) => {
    const { id } = req.params as { id: string };
    const b = sentOnly(
      body
        .omit({ customer: true, customerId: true })
        .partial()
        .extend({ status: z.enum(['INQUIRY', 'RESERVED', 'PAID', 'PREPARING', 'CANCELLED']).optional(), refreshRate: z.boolean().optional() })
        .parse(req.body),
      req.body,
    );
    const storeId = req.auth.sid;
    const o = await load(storeId, id);
    if (['DELIVERED', 'CANCELLED', 'RETURNED'].includes(o.status)) throw badRequest('order_closed');
    const updated = await prisma.$transaction(async (tx) => {
      const { items, status, scheduledFor, refreshRate, ...rest } = b;
      const data: Prisma.OrderUpdateInput = { ...rest };
      if (scheduledFor !== undefined) data.scheduledFor = scheduledFor ? dateOnly(scheduledFor) : null;
      let rate = o.rate == null ? null : num(o.rate);
      if (refreshRate) {
        rate = (await storeRate(storeId, tx)).rate;
        data.rate = rate;
      }
      if (items || refreshRate) {
        const src = items ?? itemsOf(o.items).map((i) => ({ productId: i.productId, qty: i.qty, unitPrice: i.unitPrice, serialItemId: i.serialItemId }));
        const built = await buildItems(tx, storeId, src, rate, id, itemsOf(o.items), req.auth.uid);
        data.items = built.items;
        data.total = built.total;
      }
      if (status) {
        data.status = status;
        if (status === 'CANCELLED') {
          for (const it of itemsOf(o.items)) if (it.serialItemId) await releaseSerial(tx, it.serialItemId, req.auth.uid);
          await tx.delivery.updateMany({ where: { orderId: id, status: { in: ['ASSIGNED', 'ON_THE_WAY'] } }, data: { status: 'FAILED', failReason: 'Pedido cancelado', doneAt: new Date() } });
        }
      }
      return tx.order.update({ where: { id }, data, include: { customer: true, deliveries: true } });
    });
    publish(storeId, 'orders');
    publish(storeId, 'catalog');
    return dto(updated, await userNames(prisma, storeId));
  });

  /** Asignar a un cadete (empleado con permiso de entregas, o alguien de afuera por nombre). */
  app.post('/orders/:id/assign', guard('orders'), async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ courierId: z.string().nullish(), courierName: z.string().trim().max(60).nullish(), fee: z.number().min(0).max(1e9).default(0) }).parse(req.body);
    const storeId = req.auth.sid;
    const o = await load(storeId, id);
    if (['DELIVERED', 'CANCELLED', 'RETURNED'].includes(o.status)) throw badRequest('order_closed');
    if (!o.delivery) throw badRequest('order_is_pickup');
    if (!b.courierId && !b.courierName) throw badRequest('courier_required');
    if (b.courierId && !(await prisma.user.findFirst({ where: { id: b.courierId, storeId, active: true } }))) throw notFound('user_not_found');
    if (itemsOf(o.items).some((i) => i.serialized && !i.serialItemId)) throw badRequest('assign_imei_first');
    const deposits = await orderDeposits(prisma, storeId, id);
    const rate = o.rate == null ? (await storeRate(storeId)).rate : num(o.rate);
    const pendingArs = o.paymentMode === 'PAID' ? 0 : Math.max(0, round2(num(o.total) + num(o.deliveryFee) - deposits.reduce((s, d) => s + num(d.amount), 0)));
    const collectAmount = o.codCurrency === 'USD' && rate ? round2(pendingArs / rate) : pendingArs;
    await prisma.$transaction(async (tx) => {
      await tx.delivery.updateMany({ where: { orderId: id, status: { in: ['ASSIGNED', 'ON_THE_WAY'] } }, data: { status: 'FAILED', failReason: 'Reasignado', doneAt: new Date() } });
      await tx.delivery.create({
        data: { storeId, orderId: id, courierId: b.courierId ?? null, courierName: b.courierName || null, collectAmount, collectCurrency: o.codCurrency, fee: b.fee },
      });
      await tx.order.update({ where: { id }, data: { status: 'ASSIGNED' } });
    });
    publish(storeId, 'orders');
    if (b.courierId) await pushTo([b.courierId], { title: `Entrega pedido #${o.number}`, body: `${o.customer.name} · ${o.address ?? ''}`.slice(0, 140), url: '/deliveries' });
    return dto(await load(storeId, id), await userNames(prisma, storeId));
  });

  /** Retiro en el local: se entrega en el mostrador y se cobra (si falta) en la caja. */
  app.post('/orders/:id/pickup', guard('orders'), async (req) => {
    const { id } = req.params as { id: string };
    const storeId = req.auth.sid;
    const o = await load(storeId, id);
    if (['DELIVERED', 'CANCELLED', 'RETURNED'].includes(o.status)) throw badRequest('order_closed');
    if (o.paymentMode !== 'PAID') throw badRequest('charge_in_pos');
    const alerts = await prisma.$transaction((tx) => completeOrder(tx, o, null), { timeout: 30_000 });
    await notifyAlerts(storeId, alerts.filter((a) => a.isNew).map((a) => a.alert));
    publish(storeId, 'orders');
    publish(storeId, 'sales');
    return { ok: true };
  });

  /** Devolución por arrepentimiento (10 días, art. 34 Ley 24.240): anula la venta y vuelven los equipos. */
  app.post('/orders/:id/return', guard('owner'), async (req) => {
    const { id } = req.params as { id: string };
    const { reason } = z.object({ reason: z.string().trim().max(200).optional() }).parse(req.body ?? {});
    const storeId = req.auth.sid;
    const o = await load(storeId, id);
    if (o.status !== 'DELIVERED' || !o.saleId) throw badRequest('order_not_delivered');
    await prisma.$transaction(async (tx) => {
      const ctx = await saleCtx(storeId, null);
      await applyVoid(tx, ctx, { id: randomUUID(), type: 'SALE_VOIDED', userId: req.auth.uid, occurredAt: new Date().toISOString(), saleId: o.saleId!, reason: reason ?? 'Arrepentimiento' });
      await tx.order.update({ where: { id }, data: { status: 'RETURNED' } });
    });
    publish(storeId, 'orders');
    publish(storeId, 'sales');
    publish(storeId, 'catalog');
    return { ok: true };
  });

  // ---------- Entregas (pantalla del cadete) ----------
  app.get('/couriers', guard(), async (req) => {
    const users = await prisma.user.findMany({ where: { storeId: req.auth.sid, active: true }, select: { id: true, name: true, role: true, perms: true } });
    return users.filter((u) => u.role === 'OWNER' || u.perms.includes('deliveries')).map((u) => ({ id: u.id, name: u.name }));
  });

  app.get('/deliveries', guard('deliveries', 'orders', 'reports'), async (req) => {
    const q = z.object({ mine: z.coerce.boolean().optional(), courierId: z.string().optional(), pending: z.coerce.boolean().optional() }).parse(req.query);
    const storeId = req.auth.sid;
    const mine = q.mine || !(can(req.auth, 'orders') || can(req.auth, 'reports'));
    const since = new Date(Date.now() - 36 * 3_600_000);
    const rows = await prisma.delivery.findMany({
      where: {
        storeId,
        courierId: mine ? req.auth.uid : q.courierId,
        ...(q.pending ? { status: 'DELIVERED', settledAt: null } : { OR: [{ status: { in: ['ASSIGNED', 'ON_THE_WAY'] } }, { doneAt: { gte: since } }, { status: 'DELIVERED', settledAt: null }] }),
      },
      include: { order: { include: { customer: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const names = await userNames(prisma, storeId);
    return rows.map((d) => ({
      ...deliveryDto(d, names),
      order: { id: d.order.id, number: d.order.number, address: d.order.address, addressNotes: d.order.addressNotes, window: d.order.window, items: itemsOf(d.order.items), notes: d.order.notes, customer: d.order.customer },
    }));
  });

  /** Lo que cada cadete tiene para rendir (por moneda). */
  app.get('/deliveries/pending-cash', guard('sell', 'orders', 'reports'), async (req) => {
    const rows = await prisma.delivery.groupBy({
      by: ['courierId', 'courierName', 'collectCurrency'],
      where: { storeId: req.auth.sid, status: 'DELIVERED', settledAt: null },
      _sum: { collected: true },
      _count: { _all: true },
    });
    const names = await userNames(prisma, req.auth.sid);
    return rows.map((r) => ({ courierId: r.courierId, courier: r.courierId ? names.get(r.courierId) : r.courierName, currency: r.collectCurrency, amount: num(r._sum.collected), count: r._count._all }));
  });

  const myDelivery = async (req: { auth: { sid: string; uid: string; role: 'OWNER' | 'EMPLOYEE'; perms: string[] } }, id: string) => {
    const d = await prisma.delivery.findFirst({ where: { id, storeId: req.auth.sid } });
    if (!d) throw notFound();
    if (d.courierId && d.courierId !== req.auth.uid && req.auth.role !== 'OWNER' && !req.auth.perms.includes('orders')) throw new HttpError(403, 'forbidden');
    return d;
  };

  app.post('/deliveries/:id/start', guard('deliveries', 'orders'), async (req) => {
    const { id } = req.params as { id: string };
    const d = await myDelivery(req, id);
    if (d.status !== 'ASSIGNED') throw badRequest('delivery_closed');
    await prisma.$transaction([
      prisma.delivery.update({ where: { id }, data: { status: 'ON_THE_WAY', startedAt: new Date() } }),
      prisma.order.update({ where: { id: d.orderId }, data: { status: 'ON_THE_WAY' } }),
    ]);
    publish(req.auth.sid, 'orders');
    return { ok: true };
  });

  /** Entregado: foto (opcional), quién recibió, IMEI confirmado y cuánto cobró. Se genera la venta. */
  app.post('/deliveries/:id/done', guard('deliveries', 'orders'), async (req) => {
    const { id } = req.params as { id: string };
    const d = await myDelivery(req, id);
    if (d.status !== 'ASSIGNED' && d.status !== 'ON_THE_WAY') throw badRequest('delivery_closed');
    const img = await readImage(req);
    const raw = img ? img.fields : ((req.body ?? {}) as Record<string, unknown>);
    const b = z
      .object({
        receiverName: z.string().trim().max(80).nullish(),
        receiverDni: z.string().trim().max(20).nullish(),
        imeiConfirmed: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).default(false),
        collected: z.union([z.number(), z.string().regex(/^\d+([.,]\d+)?$/).transform((v) => Number(v.replace(',', '.')))]).nullish(),
      })
      .parse(raw);
    const photo = img?.data.length ? await saveImage(req.auth.sid, img.data, img.mimetype) : null;
    const o = await load(req.auth.sid, d.orderId);
    const collected = num(d.collectAmount) > 0 ? (b.collected ?? num(d.collectAmount)) : 0;
    const alerts = await prisma.$transaction(
      async (tx) => {
        await tx.delivery.update({
          where: { id },
          data: { status: 'DELIVERED', doneAt: new Date(), proofPhoto: photo, receiverName: b.receiverName || null, receiverDni: b.receiverDni || null, imeiConfirmed: b.imeiConfirmed, collected },
        });
        return completeOrder(tx, o, d.collectCurrency === 'USD' ? collected : null);
      },
      { timeout: 30_000 },
    );
    await notifyAlerts(req.auth.sid, alerts.filter((a) => a.isNew).map((a) => a.alert));
    publish(req.auth.sid, 'orders');
    publish(req.auth.sid, 'sales');
    publish(req.auth.sid, 'phones');
    return { ok: true };
  });

  app.post('/deliveries/:id/fail', guard('deliveries', 'orders'), async (req) => {
    const { id } = req.params as { id: string };
    const d = await myDelivery(req, id);
    if (d.status !== 'ASSIGNED' && d.status !== 'ON_THE_WAY') throw badRequest('delivery_closed');
    const { reason } = z.object({ reason: z.string().trim().min(1).max(200) }).parse(req.body);
    await prisma.$transaction([
      prisma.delivery.update({ where: { id }, data: { status: 'FAILED', failReason: reason, doneAt: new Date() } }),
      prisma.order.update({ where: { id: d.orderId }, data: { status: 'FAILED' } }),
    ]);
    publish(req.auth.sid, 'orders');
    return { ok: true };
  });

}

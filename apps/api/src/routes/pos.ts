import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseSettings, PERMS } from '@super-chino/shared';
import { num, prisma } from '../db';
import { deviceGuard, guard } from '../lib/auth';
import { randomToken, sha256 } from '../lib/crypto';
import { notFound } from '../lib/http';
import { storeRate } from '../services/fx';
import { serviceProduct } from '../services/phones';
import { chargeOf } from './repairs';
import { processPosEvents } from '../services/sales';

/** Lo extra que necesita la caja de una casa de celulares: dólar, equipos, créditos, señas, reparaciones y cadetes. */
async function phoneBootstrap(storeId: string) {
  const [fx, serials, tradeIns, deposits, repairs, customers, couriers, pendingCash, repairProduct] = await Promise.all([
    storeRate(storeId),
    prisma.serialItem.findMany({ where: { storeId, status: { in: ['AVAILABLE', 'RESERVED'] } }, include: { product: { select: { name: true, price: true, currency: true } } } }),
    prisma.tradeIn.findMany({ where: { storeId, status: 'ACCEPTED', usedSaleId: null, paidAt: null }, include: { customer: { select: { name: true } } } }),
    prisma.deposit.findMany({ where: { storeId, status: 'ACTIVE' }, include: { customer: { select: { name: true } } } }),
    prisma.repairOrder.findMany({ where: { storeId, status: { in: ['READY', 'APPROVED', 'REJECTED', 'IN_REPAIR', 'WAITING_PART', 'DIAGNOSIS', 'QUOTE_SENT', 'RECEIVED'] } }, include: { customer: { select: { name: true } } } }),
    prisma.customer.findMany({ where: { storeId }, orderBy: { updatedAt: 'desc' }, take: 1500, select: { id: true, name: true, phone: true, dni: true } }),
    prisma.user.findMany({ where: { storeId, active: true }, select: { id: true, name: true, role: true, perms: true } }),
    prisma.delivery.groupBy({ by: ['courierId', 'collectCurrency'], where: { storeId, status: 'DELIVERED', settledAt: null, courierId: { not: null } }, _sum: { collected: true } }),
    serviceProduct(prisma, storeId, 'REPAIR'),
  ]);
  return {
    rate: fx.rate,
    quotes: fx.quotes,
    serials: serials.map((s) => ({
      id: s.id,
      productId: s.productId,
      name: s.product.name,
      imei1: s.imei1,
      imei2: s.imei2,
      serial: s.serial,
      condition: s.condition,
      grade: s.grade,
      battery: s.battery,
      color: s.color,
      price: s.price == null ? num(s.product.price) : num(s.price),
      currency: s.product.currency,
      status: s.status,
      customerId: s.customerId,
    })),
    tradeIns: tradeIns.map((t) => ({ id: t.id, number: t.number, customerId: t.customerId, customer: t.customer.name, model: t.model, amountUsd: num(t.offeredUsd), payout: t.payout })),
    deposits: deposits.map((d) => ({ id: d.id, customerId: d.customerId, customer: d.customer?.name ?? null, serialItemId: d.serialItemId, repairOrderId: d.repairOrderId, orderId: d.orderId, amount: num(d.amount), currency: d.currency, fx: d.fx == null ? null : num(d.fx), expiresAt: d.expiresAt })),
    repairs: repairs
      .filter((r) => !r.saleId)
      .map((r) => ({ id: r.id, number: r.number, customerId: r.customerId, customer: r.customer.name, device: r.device, status: r.status, amount: chargeOf(r), currency: r.currency })),
    repairProductId: repairProduct.id,
    customers,
    couriers: couriers
      .filter((u) => u.role === 'OWNER' || u.perms.includes('deliveries'))
      .map((u) => ({
        id: u.id,
        name: u.name,
        pendingArs: num(pendingCash.find((p) => p.courierId === u.id && p.collectCurrency === 'ARS')?._sum.collected),
        pendingUsd: num(pendingCash.find((p) => p.courierId === u.id && p.collectCurrency === 'USD')?._sum.collected),
      })),
  };
}

export async function posRoutes(app: FastifyInstance) {
  // ---------- Vincular PCs como caja (dueño) ----------
  app.post('/pos/devices', guard('owner'), async (req) => {
    const b = z.object({ name: z.string().trim().min(1).max(40) }).parse(req.body);
    const token = randomToken();
    const device = await prisma.device.create({ data: { storeId: req.auth.sid, name: b.name, tokenHash: sha256(token) } });
    return { token, device: { id: device.id, name: device.name } };
  });

  app.get('/pos/devices', guard('owner'), async (req) =>
    prisma.device.findMany({
      where: { storeId: req.auth.sid, revokedAt: null },
      select: { id: true, name: true, lastSeenAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  );

  app.delete('/pos/devices/:id', guard('owner'), async (req) => {
    const { id } = req.params as { id: string };
    const res = await prisma.device.updateMany({ where: { id, storeId: req.auth.sid, revokedAt: null }, data: { revokedAt: new Date() } });
    if (res.count === 0) throw notFound();
    return { ok: true };
  });

  // ---------- Lo que la caja necesita para funcionar offline ----------
  app.get('/pos/bootstrap', deviceGuard, async (req) => {
    const { since } = z.object({ since: z.iso.datetime().optional() }).parse(req.query);
    const storeId = req.device.storeId;
    const serverTime = new Date().toISOString();
    const [store, users, products, offers, suppliers] = await Promise.all([
      prisma.store.findUniqueOrThrow({ where: { id: storeId } }),
      prisma.user.findMany({ where: { storeId, active: true, pinHash: { not: null } }, orderBy: { name: 'asc' } }),
      prisma.product.findMany({
        where: { storeId, ...(since ? { updatedAt: { gt: new Date(since) } } : { active: true }) },
        select: { id: true, barcode: true, name: true, price: true, unit: true, active: true, updatedAt: true, currency: true, serialized: true, isService: true },
      }),
      prisma.offer.findMany({ where: { storeId, status: 'ACTIVE' }, include: { lot: { select: { qtyRemaining: true } } } }),
      prisma.supplier.findMany({ where: { storeId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return {
      serverTime,
      full: !since,
      store: { name: store.name, code: store.code, currency: store.currency, timezone: store.timezone, settings: parseSettings(store.settings) },
      // Todos los que tienen PIN pueden fichar; cobran solo el dueño y los que tienen permiso de vender.
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        lang: u.lang,
        role: u.role,
        perms: u.role === 'OWNER' ? [...PERMS] : u.perms,
        canSell: u.role === 'OWNER' || u.perms.includes('sell'),
        pin: u.pinHash,
      })),
      suppliers,
      products: products.map((p) => ({ ...p, price: num(p.price) })),
      offers: offers.map((o) => ({ id: o.id, productId: o.productId, offerPrice: num(o.offerPrice), discountPct: o.discountPct, maxQty: num(o.lot.qtyRemaining) })),
      businessType: store.businessType,
      ...(store.businessType === 'PHONES' ? await phoneBootstrap(storeId) : {}),
    };
  });

  /** La caja manda sus eventos (ventas, anulaciones, apertura/cierre). Idempotente. */
  app.post('/pos/sync', deviceGuard, async (req) => {
    const b = z.object({ events: z.array(z.unknown()).max(500) }).parse(req.body);
    return { results: await processPosEvents(req.device.storeId, req.device.id, b.events) };
  });
}

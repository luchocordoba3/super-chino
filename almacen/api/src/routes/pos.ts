import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseSettings, PERMS } from '@almacen/shared';
import { num, prisma } from '../db';
import { deviceGuard, guard } from '../lib/auth';
import { randomToken, sha256 } from '../lib/crypto';
import { notFound } from '../lib/http';
import { openTabs, processPosEvents } from '../services/sales';

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
    const [store, users, products, offers, suppliers, handover, categories] = await Promise.all([
      prisma.store.findUniqueOrThrow({ where: { id: storeId } }),
      prisma.user.findMany({ where: { storeId, active: true, pinHash: { not: null } }, orderBy: { name: 'asc' } }),
      prisma.product.findMany({
        where: { storeId, ...(since ? { updatedAt: { gt: new Date(since) } } : { active: true }) },
        select: { id: true, barcode: true, name: true, price: true, unit: true, active: true, updatedAt: true, categoryId: true, quickKey: true },
      }),
      prisma.offer.findMany({ where: { storeId, status: 'ACTIVE' }, include: { lot: { select: { qtyRemaining: true } } } }),
      prisma.supplier.findMany({ where: { storeId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      // Pase de turno: las novedades del último cierre de caja (de cualquier caja) de las últimas 36 horas.
      prisma.cashSession.findFirst({
        where: { storeId, notes: { not: null }, closedAt: { gte: new Date(Date.now() - 36 * 3_600_000) } },
        orderBy: { closedAt: 'desc' },
        select: { notes: true, closedAt: true, userId: true },
      }),
      prisma.category.findMany({ where: { storeId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
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
      categories,
      handover: handover && { notes: handover.notes!, closedAt: handover.closedAt!.toISOString(), user: users.find((u) => u.id === handover.userId)?.name ?? '' },
      products: products.map((p) => ({ ...p, price: num(p.price) })),
      offers: offers.map((o) => ({ id: o.id, productId: o.productId, offerPrice: num(o.offerPrice), discountPct: o.discountPct, maxQty: num(o.lot.qtyRemaining) })),
    };
  });

  /** Cuentas de mesa abiertas (la caja las consulta seguido: ahí caen también los pedidos desde la mesa). */
  app.get('/pos/tabs', deviceGuard, async (req) => openTabs(prisma, req.device.storeId));

  /** La caja manda sus eventos (ventas, anulaciones, apertura/cierre). Idempotente. */
  app.post('/pos/sync', deviceGuard, async (req) => {
    const b = z.object({ events: z.array(z.unknown()).max(500) }).parse(req.body);
    return { results: await processPosEvents(req.device.storeId, req.device.id, b.events) };
  });
}

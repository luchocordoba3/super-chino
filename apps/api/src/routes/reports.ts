import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type Payment, round2, round3 } from '@super-chino/shared';
import { num, prisma } from '../db';
import { addDays, localYMD, startOfLocalDay, startOfLocalMonth } from '../domain/dates';
import { reorderQty, whatsappLink } from '../domain/reorder';
import { can, guard } from '../lib/auth';
import { badRequest, HttpError, notFound } from '../lib/http';
import { type NewAlert, notifyAlerts, raiseAlert } from '../services/alerts';
import { todayBoard } from '../services/attendance';
import { createStockCount } from '../services/counts';
import { publish } from '../services/notify';
import { adjustStock, lotsByProduct, stockOf } from '../services/stock';
import { avgDailySales } from '../services/stats';
import { storeCtx, userNames } from '../services/store';

export async function reportRoutes(app: FastifyInstance) {
  // ---------- Conteo sorpresa a ciegas ----------
  app.post('/counts', guard('owner'), async (req) => {
    const b = z.object({ productIds: z.array(z.string()).max(30).optional(), n: z.number().int().min(1).max(30).optional() }).parse(req.body ?? {});
    if (b.productIds) {
      const found = await prisma.product.count({ where: { storeId: req.auth.sid, id: { in: b.productIds } } });
      if (found !== b.productIds.length) throw notFound('product_not_found');
    }
    const staff = await prisma.user.findMany({ where: { storeId: req.auth.sid, role: 'EMPLOYEE', active: true }, select: { id: true } });
    const id = await createStockCount(req.auth.sid, staff.length ? staff.map((s) => s.id) : [req.auth.uid], b);
    if (!id) throw badRequest('nothing_to_count');
    return { id };
  });

  /** A ciegas: mientras no se envía, no se muestra lo que dice el sistema. */
  app.get('/counts/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const c = await prisma.stockCount.findFirst({ where: { id, storeId: req.auth.sid }, include: { items: { include: { product: { select: { name: true, unit: true, barcode: true } } } } } });
    if (!c) throw notFound();
    const done = !!c.doneAt;
    return {
      id: c.id,
      doneAt: c.doneAt,
      items: c.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        name: i.product.name,
        unit: i.product.unit,
        barcode: i.product.barcode,
        countedQty: done ? num(i.countedQty) : null,
        expectedQty: done ? num(i.expectedQty) : null,
        difference: done ? num(i.difference) : null,
      })),
    };
  });

  app.post('/counts/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ items: z.array(z.object({ id: z.string(), countedQty: z.number().min(0).max(1e7) })).min(1) }).parse(req.body);
    const storeId = req.auth.sid;
    const c = await prisma.stockCount.findFirst({ where: { id, storeId }, include: { items: { include: { product: true } } } });
    if (!c) throw notFound();
    if (c.doneAt) throw badRequest('count_done');
    if (c.messageId) {
      const assigned = await prisma.messageRecipient.findFirst({ where: { messageId: c.messageId, userId: req.auth.uid } });
      if (!assigned && !can(req.auth, 'owner')) throw new HttpError(403, 'forbidden');
    }
    const { settings, today } = await storeCtx(prisma, storeId);
    const alerts: NewAlert[] = [];
    const lots = await lotsByProduct(prisma, storeId, c.items.map((i) => i.productId));
    const names = await userNames(prisma, storeId);
    await prisma.$transaction(async (tx) => {
      for (const item of c.items) {
        const counted = b.items.find((x) => x.id === item.id)?.countedQty;
        if (counted == null) throw badRequest('missing_item');
        const expected = stockOf(item.product, lots).stock;
        const diff = round3(counted - expected);
        await tx.stockCountItem.update({ where: { id: item.id }, data: { expectedQty: expected, countedQty: counted, difference: diff } });
        if (diff !== 0) {
          await adjustStock(tx, { storeId, productId: item.productId, qty: diff, today, type: 'COUNT', userId: req.auth.uid, reason: 'conteo sorpresa' });
        }
        if (Math.abs(diff) >= settings.countDiffThreshold && diff !== 0) {
          const r = await raiseAlert(
            tx,
            storeId,
            'COUNT_DIFF',
            `COUNT_DIFF:${item.id}`,
            { productId: item.productId, name: item.product.name, expected, counted, diff, by: names.get(req.auth.uid) },
            'danger',
          );
          if (r.isNew) alerts.push(r.alert);
        }
      }
      await tx.stockCount.update({ where: { id }, data: { doneAt: new Date(), doneBy: req.auth.uid } });
      if (c.messageId) await tx.message.update({ where: { id: c.messageId }, data: { doneAt: new Date(), doneBy: req.auth.uid } });
    });
    await notifyAlerts(storeId, alerts);
    publish(storeId, 'messages');
    publish(storeId, 'stock');
    return { ok: true };
  });

  // ---------- Qué reponer ----------
  app.get('/reorder', guard('stock', 'reports'), async (req) => {
    const storeId = req.auth.sid;
    const products = await prisma.product.findMany({ where: { storeId, active: true }, include: { supplier: true } });
    const [lots, perDay] = await Promise.all([lotsByProduct(prisma, storeId), avgDailySales(prisma, storeId)]);
    const groups = new Map<string, { supplier: { id: string; name: string; phone: string | null } | null; items: { productId: string; name: string; stock: number; perDay: number; qty: number }[] }>();
    for (const p of products) {
      const stock = stockOf(p, lots).stock;
      const pd = perDay.get(p.id) ?? 0;
      const qty = reorderQty({ stock, minStock: num(p.minStock), perDay: pd, leadTimeDays: p.supplier?.leadTimeDays ?? 3 });
      if (qty <= 0) continue;
      const key = p.supplierId ?? '-';
      const g = groups.get(key) ?? { supplier: p.supplier ? { id: p.supplier.id, name: p.supplier.name, phone: p.supplier.phone } : null, items: [] };
      g.items.push({ productId: p.id, name: p.name, stock, perDay: round2(pd), qty });
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
  });

  app.get('/reorder/whatsapp', guard('stock', 'reports'), async (req) => {
    const q = z.object({ phone: z.string().optional(), text: z.string().max(4000) }).parse(req.query);
    return { url: whatsappLink(q.phone ?? null, q.text) };
  });

  // ---------- Panel del dueño ----------
  app.get('/dashboard', guard('reports'), async (req) => {
    const storeId = req.auth.sid;
    const { store, settings, today } = await storeCtx(prisma, storeId);
    const from = startOfLocalDay(store.timezone);
    const monthStart = startOfLocalMonth(store.timezone);
    const weekFrom = addDays(from, -6);
    const [sales, names, items, openAlerts, expiring, suggested, offerAgg, waste, voids, week] = await Promise.all([
      prisma.sale.findMany({ where: { storeId, status: 'COMPLETED', occurredAt: { gte: from } }, select: { total: true, costTotal: true, payments: true, userId: true } }),
      userNames(prisma, storeId),
      prisma.saleItem.groupBy({ by: ['productId', 'name'], where: { sale: { storeId, status: 'COMPLETED', occurredAt: { gte: from } } }, _sum: { qty: true, lineTotal: true }, orderBy: { _sum: { lineTotal: 'desc' } }, take: 5 }),
      prisma.alert.groupBy({ by: ['severity'], where: { storeId, resolvedAt: null }, _count: { _all: true } }),
      prisma.lot.count({ where: { storeId, qtyRemaining: { gt: 0 }, expiresAt: { not: null, lte: addDays(today, settings.expiryAlertDays) } } }),
      prisma.offer.count({ where: { storeId, status: 'SUGGESTED' } }),
      prisma.offer.aggregate({ where: { storeId, createdAt: { gte: monthStart } }, _sum: { soldAmount: true } }),
      prisma.stockMovement.findMany({ where: { storeId, type: 'WASTE', createdAt: { gte: monthStart } }, select: { qty: true, unitCost: true } }),
      prisma.posEvent.groupBy({ by: ['type'], where: { storeId, type: { in: ['ITEM_REMOVED', 'SALE_VOIDED'] }, occurredAt: { gte: from } }, _count: { _all: true } }),
      prisma.sale.findMany({ where: { storeId, status: 'COMPLETED', occurredAt: { gte: weekFrom } }, select: { total: true, occurredAt: true } }),
    ]);
    const staff = await todayBoard(storeId);
    const total = round2(sales.reduce((s, x) => s + num(x.total), 0));
    const cost = round2(sales.reduce((s, x) => s + num(x.costTotal), 0));
    const byMethod: Record<string, number> = {};
    const byCashier = new Map<string, { name: string; total: number; count: number }>();
    for (const s of sales) {
      for (const p of s.payments as Payment[]) byMethod[p.method] = round2((byMethod[p.method] ?? 0) + p.amount);
      const c = byCashier.get(s.userId) ?? { name: names.get(s.userId) ?? '?', total: 0, count: 0 };
      c.total = round2(c.total + num(s.total));
      c.count += 1;
      byCashier.set(s.userId, c);
    }
    const days = Array.from({ length: 7 }, (_, i) => localYMD(store.timezone, addDays(weekFrom, i)));
    const perDay = new Map(days.map((d) => [d, 0]));
    for (const s of week) {
      const d = localYMD(store.timezone, s.occurredAt);
      if (perDay.has(d)) perDay.set(d, round2(perDay.get(d)! + num(s.total)));
    }
    return {
      today: { total, count: sales.length, avgTicket: sales.length ? round2(total / sales.length) : 0, profit: round2(total - cost), byMethod, byCashier: [...byCashier.values()].sort((a, b) => b.total - a.total) },
      topProducts: items.map((i) => ({ productId: i.productId, name: i.name, qty: num(i._sum.qty), total: num(i._sum.lineTotal) })),
      alerts: Object.fromEntries(openAlerts.map((a) => [a.severity, a._count._all])),
      expiringLots: expiring,
      suggestedOffers: suggested,
      savedThisMonth: num(offerAgg._sum.soldAmount),
      wasteThisMonth: round2(waste.reduce((s, w) => s + Math.abs(num(w.qty)) * num(w.unitCost), 0)),
      voidsToday: Object.fromEntries(voids.map((v) => [v.type, v._count._all])),
      week: days.map((d) => ({ date: d, total: perDay.get(d) ?? 0 })),
      staff: { working: staff.working, late: staff.late, absent: staff.absent },
    };
  });
}

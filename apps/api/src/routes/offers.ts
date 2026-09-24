import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { num, prisma } from '../db';
import { daysBetween } from '../domain/dates';
import { guard } from '../lib/auth';
import { badRequest, notFound } from '../lib/http';
import { resolveAlert } from '../services/alerts';
import { runDailyJobs } from '../services/jobs';
import { publish } from '../services/notify';
import { storeCtx } from '../services/store';

export async function offerRoutes(app: FastifyInstance) {
  app.get('/offers', guard('prices', 'reports'), async (req) => {
    const { status } = z.object({ status: z.enum(['SUGGESTED', 'ACTIVE', 'DISMISSED', 'ENDED']).optional() }).parse(req.query);
    const { today } = await storeCtx(prisma, req.auth.sid);
    const offers = await prisma.offer.findMany({
      where: { storeId: req.auth.sid, status: status ?? { in: ['SUGGESTED', 'ACTIVE'] } },
      include: { product: { select: { name: true, price: true, barcode: true } }, lot: true },
      orderBy: { lot: { expiresAt: 'asc' } },
      take: 200,
    });
    return offers.map((o) => ({
      id: o.id,
      productId: o.productId,
      name: o.product.name,
      barcode: o.product.barcode,
      listPrice: num(o.product.price),
      offerPrice: num(o.offerPrice),
      discountPct: o.discountPct,
      status: o.status,
      reason: o.reason,
      lotCode: o.lot.lotCode,
      expiresAt: o.lot.expiresAt,
      daysLeft: o.lot.expiresAt ? daysBetween(today, o.lot.expiresAt) : null,
      remaining: num(o.lot.qtyRemaining),
      soldQty: num(o.soldQty),
      soldAmount: num(o.soldAmount),
    }));
  });

  /** "Plata salvada del vencimiento": lo vendido en oferta este mes. */
  app.get('/offers/summary', guard('prices', 'reports'), async (req) => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const agg = await prisma.offer.aggregate({ where: { storeId: req.auth.sid, createdAt: { gte: start } }, _sum: { soldAmount: true } });
    const counts = await prisma.offer.groupBy({ by: ['status'], where: { storeId: req.auth.sid }, _count: { _all: true } });
    return { savedThisMonth: num(agg._sum.soldAmount), byStatus: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
  });

  const setStatus = (to: 'ACTIVE' | 'DISMISSED' | 'ENDED') => async (req: { params: unknown; auth: { sid: string } }) => {
    const { id } = req.params as { id: string };
    const o = await prisma.offer.findFirst({ where: { id, storeId: req.auth.sid } });
    if (!o) throw notFound();
    if (o.status === 'ENDED' || (o.status === 'DISMISSED' && to !== 'ACTIVE')) throw badRequest('offer_closed');
    await prisma.offer.update({
      where: { id },
      data: { status: to, ...(to === 'ACTIVE' ? { activatedAt: new Date() } : { endedAt: new Date() }) },
    });
    await resolveAlert(prisma, req.auth.sid, `OFFER_SUGGESTED:${id}`);
    publish(req.auth.sid, 'offers');
    return { ok: true };
  };
  app.post('/offers/:id/approve', guard('prices'), setStatus('ACTIVE'));
  app.post('/offers/:id/dismiss', guard('prices'), setStatus('DISMISSED'));
  app.post('/offers/:id/end', guard('prices'), setStatus('ENDED'));

  app.patch('/offers/:id', guard('prices'), async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ offerPrice: z.number().positive() }).parse(req.body);
    const o = await prisma.offer.findFirst({ where: { id, storeId: req.auth.sid }, include: { product: true } });
    if (!o) throw notFound();
    const list = num(o.product.price);
    if (b.offerPrice >= list) throw badRequest('offer_not_lower');
    await prisma.offer.update({ where: { id }, data: { offerPrice: b.offerPrice, discountPct: Math.round((1 - b.offerPrice / list) * 100) } });
    publish(req.auth.sid, 'offers');
    return { ok: true };
  });

  // ---------- Avisos ----------
  app.get('/alerts', guard('owner'), async (req) => {
    const { all } = z.object({ all: z.coerce.boolean().optional() }).parse(req.query);
    return prisma.alert.findMany({
      where: { storeId: req.auth.sid, ...(all ? {} : { resolvedAt: null }) },
      orderBy: [{ resolvedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: 200,
    });
  });

  app.post('/alerts/:id/resolve', guard('owner'), async (req) => {
    const { id } = req.params as { id: string };
    const r = await prisma.alert.updateMany({ where: { id, storeId: req.auth.sid, resolvedAt: null }, data: { resolvedAt: new Date() } });
    if (!r.count) throw notFound();
    publish(req.auth.sid, 'alerts');
    return { ok: true };
  });

  /** Correr la revisión diaria ahora (el servidor igual la corre cada hora). */
  app.post('/jobs/run', guard('owner'), async (req) => runDailyJobs(req.auth.sid));
}

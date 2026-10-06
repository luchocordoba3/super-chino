import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { QUOTE_STATUSES, quoteBodySchema } from '@vidrieria/shared';
import { prisma } from '../db';
import { guard } from '../lib/auth';
import { badRequest, notFound } from '../lib/http';
import { createQuote, expireIfNeeded, expireOld, updateQuote } from '../services/quotes';

const DAY = 86_400_000;
const listSelect = {
  id: true,
  number: true,
  title: true,
  status: true,
  total: true,
  deposit: true,
  createdAt: true,
  sentAt: true,
  viewedAt: true,
  acceptedAt: true,
  followUpAt: true,
  validUntil: true,
  publicToken: true,
  customer: { select: { id: true, name: true, phone: true } },
} as const;

/** Enviados o vistos hace 2 días o más, sin respuesta y sin seguimiento en los últimos 3 días. */
const followUpWhere = (bid: string) => ({
  businessId: bid,
  status: { in: ['SENT' as const, 'VIEWED' as const] },
  sentAt: { lt: new Date(Date.now() - 2 * DAY) },
  validUntil: { gt: new Date() },
  OR: [{ followUpAt: null }, { followUpAt: { lt: new Date(Date.now() - 3 * DAY) } }],
});

export async function quoteRoutes(app: FastifyInstance) {
  const biz = (bid: string) => prisma.business.findUniqueOrThrow({ where: { id: bid } });

  app.get('/quotes', guard(), async (req) => {
    const { status, q } = req.query as { status?: string; q?: string };
    await expireOld(req.auth.bid);
    const st = z.enum(QUOTE_STATUSES).optional().parse(status || undefined);
    const term = q?.trim();
    const n = term && /^\d+$/.test(term) ? Number(term) : null;
    return prisma.quote.findMany({
      where: {
        businessId: req.auth.bid,
        ...(st ? { status: st } : {}),
        ...(term ? { OR: [{ title: { contains: term, mode: 'insensitive' } }, { customer: { name: { contains: term, mode: 'insensitive' } } }, ...(n ? [{ number: n }] : [])] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: listSelect,
    });
  });

  app.get('/quotes/follow-up', guard(), async (req) =>
    prisma.quote.findMany({ where: followUpWhere(req.auth.bid), orderBy: { sentAt: 'asc' }, select: listSelect }),
  );

  app.get('/quotes/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const q = await prisma.quote.findFirst({ where: { id, businessId: req.auth.bid }, include: { customer: true, lead: true } });
    if (!q) throw notFound();
    return expireIfNeeded(q);
  });

  app.post('/quotes', guard(), async (req) => {
    const body = quoteBodySchema.parse(req.body);
    if (!body.items.length && !body.extras.length) throw badRequest('empty_quote', 'Agregá al menos un trabajo');
    return createQuote(await biz(req.auth.bid), req.auth.uid, body);
  });

  app.put('/quotes/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const { recalcDollar } = req.query as { recalcDollar?: string };
    const body = quoteBodySchema.parse(req.body);
    if (!body.items.length && !body.extras.length) throw badRequest('empty_quote', 'Agregá al menos un trabajo');
    return updateQuote(await biz(req.auth.bid), id, body, recalcDollar === '1');
  });

  app.post('/quotes/:id/duplicate', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const q = await prisma.quote.findFirst({ where: { id, businessId: req.auth.bid } });
    if (!q) throw notFound();
    const body = quoteBodySchema.parse({ ...(q.input as object), customerId: q.customerId, title: q.title, notes: q.notes });
    return createQuote(await biz(req.auth.bid), req.auth.uid, body);
  });

  /** Marca como enviado (al tocar "Enviar por WhatsApp"). */
  app.post('/quotes/:id/sent', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const q = await prisma.quote.findFirst({ where: { id, businessId: req.auth.bid } });
    if (!q) throw notFound();
    if (q.status !== 'DRAFT' && q.status !== 'EXPIRED') return q;
    return prisma.quote.update({ where: { id }, data: { status: 'SENT', sentAt: q.sentAt ?? new Date() } });
  });

  app.post('/quotes/:id/status', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const { status } = z.object({ status: z.enum(['ACCEPTED', 'REJECTED', 'SENT']) }).parse(req.body);
    const q = await prisma.quote.findFirst({ where: { id, businessId: req.auth.bid } });
    if (!q) throw notFound();
    return prisma.quote.update({
      where: { id },
      data: {
        status,
        acceptedAt: status === 'ACCEPTED' ? (q.acceptedAt ?? new Date()) : null,
        rejectedAt: status === 'REJECTED' ? new Date() : null,
        sentAt: q.sentAt ?? (status === 'SENT' ? new Date() : null),
      },
    });
  });

  app.post('/quotes/:id/followed-up', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const r = await prisma.quote.updateMany({ where: { id, businessId: req.auth.bid }, data: { followUpAt: new Date() } });
    if (!r.count) throw notFound();
    return { ok: true };
  });

  app.delete('/quotes/:id', guard('owner'), async (req) => {
    const { id } = req.params as { id: string };
    const q = await prisma.quote.findFirst({ where: { id, businessId: req.auth.bid } });
    if (!q) throw notFound();
    if (q.status !== 'DRAFT') throw badRequest('not_draft', 'Solo se pueden borrar borradores');
    await prisma.quote.delete({ where: { id } });
    return { ok: true };
  });

  app.get('/dashboard', guard(), async (req) => {
    const bid = req.auth.bid;
    await expireOld(bid);
    const weekAgo = new Date(Date.now() - 7 * DAY);
    const [newLeads, followUps, week, accepted, recent] = await Promise.all([
      prisma.lead.count({ where: { businessId: bid, status: 'NEW' } }),
      prisma.quote.count({ where: followUpWhere(bid) }),
      prisma.quote.aggregate({ where: { businessId: bid, createdAt: { gte: weekAgo } }, _count: true, _sum: { total: true } }),
      prisma.quote.aggregate({ where: { businessId: bid, status: 'ACCEPTED', acceptedAt: { gte: weekAgo } }, _count: true, _sum: { total: true, deposit: true } }),
      prisma.quote.findMany({ where: { businessId: bid }, orderBy: { updatedAt: 'desc' }, take: 8, select: listSelect }),
    ]);
    return {
      newLeads,
      followUps,
      week: { count: week._count, total: Number(week._sum.total ?? 0) },
      accepted: { count: accepted._count, total: Number(accepted._sum.total ?? 0), deposit: Number(accepted._sum.deposit ?? 0) },
      recent,
    };
  });
}

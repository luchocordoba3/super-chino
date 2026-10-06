import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PAY_METHODS, QUOTE_STATUSES, quoteBodySchema, type QuoteResult } from '@vidrieria/shared';
import { prisma } from '../db';
import { guard } from '../lib/auth';
import { badRequest, notFound } from '../lib/http';
import { dollarFor } from '../services/dollar';
import { registerPayment } from './cash';
import { ensureJob } from '../services/jobs';
import { acceptData, createQuote, expireIfNeeded, expireOld, isEmptyBody, redollarQuote, storedOptions, totalWithDollar, updateQuote } from '../services/quotes';

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
  viewCount: true,
  depositReportedAt: true,
  depositPaidAt: true,
  options: true,
  customer: { select: { id: true, name: true, phone: true } },
} as const;

/** En las listas alcanza con saber cuántas opciones tiene. */
const slim = <T extends { options: unknown }>({ options, ...q }: T) => ({ ...q, optionCount: Array.isArray(options) ? options.length : 1 });

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
    }).then((r) => r.map(slim));
  });

  app.get('/quotes/follow-up', guard(), async (req) =>
    (await prisma.quote.findMany({ where: followUpWhere(req.auth.bid), orderBy: { sentAt: 'asc' }, select: listSelect })).map(slim),
  );

  app.get('/quotes/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const q = await prisma.quote.findFirst({ where: { id, businessId: req.auth.bid }, include: { customer: true, lead: true, job: { select: { id: true, status: true } } } });
    if (!q) throw notFound();
    return expireIfNeeded(q);
  });

  app.post('/quotes', guard(), async (req) => {
    const body = quoteBodySchema.extend({ photoIds: z.array(z.string()).max(20).default([]) }).parse(req.body);
    if (isEmptyBody(body)) throw badRequest('empty_quote', 'Agregá al menos un trabajo');
    const photoIds = body.photoIds.length
      ? (await prisma.asset.findMany({ where: { id: { in: body.photoIds }, businessId: req.auth.bid }, select: { id: true } })).map((a) => a.id)
      : [];
    return createQuote(await biz(req.auth.bid), req.auth.uid, body, { photoIds });
  });

  app.put('/quotes/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const { recalcDollar } = req.query as { recalcDollar?: string };
    const body = quoteBodySchema.parse(req.body);
    if (isEmptyBody(body)) throw badRequest('empty_quote', 'Agregá al menos un trabajo');
    return updateQuote(await biz(req.auth.bid), id, body, recalcDollar === '1');
  });

  app.post('/quotes/:id/duplicate', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const q = await prisma.quote.findFirst({ where: { id, businessId: req.auth.bid } });
    if (!q) throw notFound();
    const opts = q.chosenOption == null ? storedOptions(q) : null;
    const body = quoteBodySchema.parse({
      ...(q.input as object),
      customerId: q.customerId,
      title: q.title,
      notes: q.notes,
      options: opts?.map((o) => ({ label: o.label, items: o.input.items, extras: o.input.extras, discount: o.input.discount })),
    });
    return createQuote(await biz(req.auth.bid), req.auth.uid, body);
  });

  /** Lo pasa al dólar de hoy (todas las opciones) y renueva la validez. */
  app.post('/quotes/:id/redollar', guard(), async (req) => {
    const { id } = req.params as { id: string };
    return redollarQuote(await biz(req.auth.bid), id);
  });

  /** Confirma (o deshace) el cobro de la seña. */
  app.post('/quotes/:id/deposit-paid', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const { paid, method } = z.object({ paid: z.boolean(), method: z.enum(PAY_METHODS).default('TRANSFERENCIA') }).parse(req.body);
    const q = await prisma.quote.findFirst({ where: { id, businessId: req.auth.bid } });
    if (!q) throw notFound();
    if (q.status !== 'ACCEPTED') throw badRequest('not_accepted', 'El presupuesto todavía no fue aceptado');
    // La seña cobrada entra a la caja (y sale si se deshace).
    if (paid && !(await prisma.payment.findFirst({ where: { quoteId: id, kind: 'SENA' } }))) {
      await registerPayment(req.auth.bid, { quoteId: id, kind: 'SENA', method, amount: Number(q.deposit), note: 'Seña' });
    }
    if (!paid) await prisma.payment.deleteMany({ where: { quoteId: id, kind: 'SENA', mpPaymentId: null } });
    return prisma.quote.update({ where: { id }, data: { depositPaidAt: paid ? (q.depositPaidAt ?? new Date()) : null } });
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
    const { status, option } = z.object({ status: z.enum(['ACCEPTED', 'REJECTED', 'SENT']), option: z.number().int().min(0).max(2).nullish() }).parse(req.body);
    const q = await prisma.quote.findFirst({ where: { id, businessId: req.auth.bid } });
    if (!q) throw notFound();
    if (status === 'ACCEPTED') {
      const accepted = await prisma.quote.update({ where: { id }, data: acceptData(q, option) });
      await ensureJob(id);
      return accepted;
    }
    return prisma.quote.update({
      where: { id },
      data: {
        status,
        acceptedAt: null,
        chosenOption: null,
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
    const monthStart = startOfMonthAr();
    const b = await biz(bid);
    const [newLeads, followUps, week, accepted, recent, monthAccepted, depositsToConfirm, depositsPaid, open, toBuy, dollar] = await Promise.all([
      prisma.lead.count({ where: { businessId: bid, status: 'NEW' } }),
      prisma.quote.count({ where: followUpWhere(bid) }),
      prisma.quote.aggregate({ where: { businessId: bid, createdAt: { gte: weekAgo } }, _count: true, _sum: { total: true } }),
      prisma.quote.aggregate({ where: { businessId: bid, status: 'ACCEPTED', acceptedAt: { gte: weekAgo } }, _count: true, _sum: { total: true, deposit: true } }),
      prisma.quote.findMany({ where: { businessId: bid }, orderBy: { updatedAt: 'desc' }, take: 8, select: listSelect }),
      prisma.quote.findMany({ where: { businessId: bid, status: 'ACCEPTED', acceptedAt: { gte: monthStart } }, select: { total: true, result: true } }),
      prisma.quote.findMany({ where: { businessId: bid, status: 'ACCEPTED', depositReportedAt: { not: null }, depositPaidAt: null }, orderBy: { depositReportedAt: 'asc' }, select: listSelect }),
      prisma.quote.aggregate({ where: { businessId: bid, depositPaidAt: { gte: monthStart } }, _count: true, _sum: { deposit: true } }),
      prisma.quote.findMany({ where: { businessId: bid, status: { in: ['SENT', 'VIEWED'] } }, include: { customer: { select: { id: true, name: true, phone: true } } } }),
      prisma.quote.count({ where: { businessId: bid, status: 'ACCEPTED', purchasedAt: null } }),
      dollarFor(b),
    ]);

    // Ganancia del mes: suma la ganancia estimada de los aceptados (los viejos, sin costo, no suman).
    const results = monthAccepted.map((q) => q.result as unknown as QuoteResult);
    const month = {
      count: monthAccepted.length,
      total: monthAccepted.reduce((a, q) => a + Number(q.total), 0),
      profit: Math.round(results.reduce((a, r) => a + (r.cost > 0 ? r.profit : 0), 0)),
      costedLines: results.reduce((a, r) => a + (r.costedLines ?? 0), 0),
      totalLines: results.reduce((a, r) => a + (r.totalLines ?? 0), 0),
      depositsPaid: Number(depositsPaid._sum.deposit ?? 0),
    };

    // Subió el dólar: presupuestos abiertos que hoy saldrían más caros que el % de alerta.
    const alertPct = Number(b.dollarAlertPct);
    const dollarStale = dollar.fallback
      ? []
      : open
          .filter((q) => dollar.rate > Number(q.dollarRate))
          .map((q) => ({ q, newTotal: totalWithDollar(q, dollar.rate) }))
          .filter(({ q, newTotal }) => Number(q.total) > 0 && ((newTotal - Number(q.total)) / Number(q.total)) * 100 >= alertPct)
          .map(({ q, newTotal }) => ({
            id: q.id,
            number: q.number,
            title: q.title,
            status: q.status,
            publicToken: q.publicToken,
            validUntil: q.validUntil,
            customer: q.customer,
            total: Number(q.total),
            newTotal,
            dollarRate: Number(q.dollarRate),
          }));

    return {
      newLeads,
      followUps,
      week: { count: week._count, total: Number(week._sum.total ?? 0) },
      accepted: { count: accepted._count, total: Number(accepted._sum.total ?? 0), deposit: Number(accepted._sum.deposit ?? 0) },
      month,
      depositsToConfirm: depositsToConfirm.map(slim),
      dollar: { rate: dollar.rate, source: dollar.source, alertPct },
      dollarStale,
      toBuy,
      recent: recent.map(slim),
    };
  });
}

/** Primer día del mes en hora argentina (UTC−3). */
function startOfMonthAr() {
  const ar = new Date(Date.now() - 3 * 3_600_000);
  return new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), 1, 3));
}

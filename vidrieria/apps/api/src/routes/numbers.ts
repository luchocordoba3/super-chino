import type { FastifyInstance } from 'fastify';
import { BANKED_METHODS, MONOTRIBUTO_CAPS, type QuoteResult } from '@vidrieria/shared';
import { num, prisma } from '../db';
import { guard } from '../lib/auth';
import { receivables } from './cash';

const DAY = 86_400_000;
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

/** Lo que el dueño necesita ver de la plata, calculado de lo que ya carga. */
export async function moneyNumbers(bid: string) {
  const now = new Date();
  const year = new Date(now.getTime() - 365 * DAY);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const b = await prisma.business.findUniqueOrThrow({ where: { id: bid } });
  const [invoices, paymentsYear, paymentsMonth, expensesMonth, fixed, wagesMonth, wages4w, cheques, accepted, jobs] = await Promise.all([
    prisma.invoice.findMany({ where: { businessId: bid, date: { gte: year } }, select: { amount: true, date: true } }),
    prisma.payment.findMany({ where: { businessId: bid, date: { gte: year } }, select: { amount: true, method: true } }),
    prisma.payment.findMany({ where: { businessId: bid, date: { gte: monthStart } }, select: { amount: true, net: true } }),
    prisma.expense.findMany({ where: { businessId: bid, recurring: false, date: { gte: monthStart } }, select: { amount: true } }),
    prisma.expense.findMany({ where: { businessId: bid, recurring: true }, select: { amount: true } }),
    prisma.workDay.findMany({ where: { businessId: bid, date: { gte: monthStart }, advance: false }, select: { amount: true } }),
    prisma.workDay.findMany({ where: { businessId: bid, date: { gte: new Date(now.getTime() - 28 * DAY) }, advance: false }, select: { amount: true } }),
    prisma.payment.findMany({ where: { businessId: bid, method: { in: ['CHEQUE', 'ECHEQ'] }, chequeStatus: { in: ['CARTERA', 'DEPOSITADO'] }, chequeDueAt: { lte: new Date(now.getTime() + 30 * DAY) } }, select: { amount: true } }),
    prisma.quote.findMany({ where: { businessId: bid, status: 'ACCEPTED', acceptedAt: { gte: new Date(now.getTime() - 180 * DAY) } }, select: { total: true, result: true } }),
    prisma.job.findMany({
      where: { businessId: bid, status: { in: ['INSTALLED', 'CLOSED'] } },
      orderBy: { installedAt: 'desc' },
      take: 10,
      include: { quote: { select: { number: true, title: true, total: true, result: true, customer: { select: { name: true } }, payments: { select: { amount: true, net: true } } } }, workDays: { select: { amount: true } }, expenses: { select: { amount: true } } },
    }),
  ]);

  // Monotributo: facturado en 12 meses contra el tope, y lo que entró por bancos y billeteras (ARCA lo cruza).
  const cap = b.monotributoCap ? num(b.monotributoCap) : (MONOTRIBUTO_CAPS[b.monotributoCategory] ?? null);
  const invoiced = sum(invoices, (i) => num(i.amount));
  const last90 = sum(invoices.filter((i) => i.date.getTime() > now.getTime() - 90 * DAY), (i) => num(i.amount));
  const banked = sum(paymentsYear.filter((p) => (BANKED_METHODS as string[]).includes(p.method)), (p) => num(p.amount));

  // Margen promedio (solo presupuestos con costo cargado) y por tipo de trabajo.
  const results = accepted.map((q) => ({ total: num(q.total), r: q.result as unknown as QuoteResult }));
  const costed = results.filter((x) => x.r.cost > 0);
  const marginPct = costed.length ? sum(costed, (x) => x.r.profit) / sum(costed, (x) => x.total) : null;
  const kinds = new Map<string, { kind: string; count: number; revenue: number; profit: number; costed: number }>();
  for (const x of results) {
    const kind = x.r.items[0]?.title ?? 'Otros';
    const k = kinds.get(kind) ?? { kind, count: 0, revenue: 0, profit: 0, costed: 0 };
    k.count++;
    k.revenue += x.total;
    if (x.r.cost > 0) {
      k.profit += x.r.profit;
      k.costed += x.total;
    }
    kinds.set(kind, k);
  }

  const fixedMonthly = sum(fixed, (e) => num(e.amount));
  const due = sum(await receivables(bid), (c) => c.due);
  const wagesWeekly = sum(wages4w, (w) => num(w.amount)) / 4;

  return {
    monotributo: {
      category: b.monotributoCategory || null,
      cap,
      invoiced: Math.round(invoiced),
      banked: Math.round(banked),
      pct: cap ? invoiced / cap : null,
      projection: Math.round((last90 / 90) * 365),
    },
    month: {
      income: Math.round(sum(paymentsMonth, (p) => num(p.amount))),
      net: Math.round(sum(paymentsMonth, (p) => num(p.net))),
      expenses: Math.round(sum(expensesMonth, (e) => num(e.amount)) + fixedMonthly),
      wages: Math.round(sum(wagesMonth, (w) => num(w.amount))),
    },
    cashflow30: {
      receivable: Math.round(due),
      cheques: Math.round(sum(cheques, (c) => num(c.amount))),
      fixed: Math.round(fixedMonthly),
      wages: Math.round(wagesWeekly * 4.3),
    },
    breakeven: { fixedMonthly: Math.round(fixedMonthly), marginPct, salesNeeded: marginPct && marginPct > 0 ? Math.round(fixedMonthly / marginPct) : null },
    byKind: [...kinds.values()].map((k) => ({ ...k, marginPct: k.costed ? k.profit / k.costed : null })).sort((a, b) => b.revenue - a.revenue),
    jobs: jobs.map((j) => {
      const r = j.quote.result as unknown as QuoteResult;
      const price = num(j.quote.total);
      const material = r.cost ?? 0;
      const wages = sum(j.workDays, (w) => num(w.amount));
      const expenses = sum(j.expenses, (e) => num(e.amount));
      const fees = sum(j.quote.payments, (p) => num(p.amount) - num(p.net));
      return {
        id: j.id,
        number: j.quote.number,
        title: j.quote.title,
        customer: j.quote.customer?.name ?? null,
        price,
        material: Math.round(material),
        materialKnown: r.costedLines > 0,
        wages: Math.round(wages),
        expenses: Math.round(expenses),
        fees: Math.round(fees),
        profit: Math.round(price - material - wages - expenses - fees),
      };
    }),
  };
}

export async function numberRoutes(app: FastifyInstance) {
  app.get('/numbers', guard('numbers'), async (req) => moneyNumbers(req.auth.bid));
  app.get('/numbers/sales', guard('numbers'), async (req) => salesNumbers(req.auth.bid));
}

/** Ventas: tasa de cierre real, por origen y por tipo, tiempo de respuesta, ticket y prueba de precio (últimos 90 días). */
export async function salesNumbers(bid: string) {
  const since = new Date(Date.now() - 90 * DAY);
  const quotes = await prisma.quote.findMany({
    where: { businessId: bid, createdAt: { gte: since }, status: { not: 'DRAFT' } },
    select: { status: true, total: true, priceVariant: true, result: true, createdAt: true, lead: { select: { source: true, createdAt: true } }, customer: { select: { source: true } } },
  });
  const accepted = quotes.filter((q) => q.status === 'ACCEPTED');
  const rate = (xs: typeof quotes) => (xs.length ? xs.filter((q) => q.status === 'ACCEPTED').length / xs.length : null);
  const group = (key: (q: (typeof quotes)[number]) => string) => {
    const m = new Map<string, typeof quotes>();
    for (const q of quotes) m.set(key(q), [...(m.get(key(q)) ?? []), q]);
    return [...m.entries()].map(([k, xs]) => ({ key: k, sent: xs.length, accepted: xs.filter((q) => q.status === 'ACCEPTED').length, rate: rate(xs) })).sort((a, b) => b.sent - a.sent);
  };
  // Tiempo de respuesta: de la consulta al primer presupuesto.
  const leads = await prisma.lead.findMany({ where: { businessId: bid, createdAt: { gte: since } }, select: { createdAt: true, quotes: { select: { createdAt: true }, orderBy: { createdAt: 'asc' }, take: 1 } } });
  const hours = leads.filter((l) => l.quotes[0]).map((l) => (l.quotes[0].createdAt.getTime() - l.createdAt.getTime()) / 3_600_000).sort((a, b) => a - b);
  const closeRate = rate(quotes);
  return {
    sent: quotes.length,
    accepted: accepted.length,
    closeRate,
    tooCheap: closeRate != null && quotes.length >= 10 && closeRate > 0.85,
    avgTicket: accepted.length ? Math.round(sum(accepted, (q) => num(q.total)) / accepted.length) : null,
    responseHours: hours.length ? Math.round(hours[Math.floor(hours.length / 2)] * 10) / 10 : null,
    unanswered: leads.filter((l) => !l.quotes[0]).length,
    bySource: group((q) => q.lead?.source ?? q.customer?.source ?? 'SIN_DATO'),
    byKind: group((q) => (q.result as unknown as QuoteResult).items[0]?.title ?? 'Otros'),
    priceTest: group((q) => q.priceVariant ?? 'NONE').filter((g) => g.key !== 'NONE'),
  };
}

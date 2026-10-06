import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { EXPENSE_CATEGORIES, PAY_METHODS, netOf } from '@vidrieria/shared';
import { num, prisma } from '../db';
import { guard } from '../lib/auth';
import { badRequest, notFound } from '../lib/http';

const DAY = 86_400_000;
const dateRange = (q: { from?: string; to?: string }) => {
  const now = new Date();
  const from = q.from ? new Date(q.from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = q.to ? new Date(q.to) : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { gte: from, lt: to };
};

const paymentSchema = z.object({
  quoteId: z.string().nullish(),
  customerId: z.string().nullish(),
  kind: z.enum(['SENA', 'SALDO', 'OTRO']).default('OTRO'),
  method: z.enum(PAY_METHODS),
  amount: z.number().finite().positive().max(1e12),
  date: z.string().datetime({ offset: true }).nullish(),
  note: z.string().trim().max(300).default(''),
  chequeBank: z.string().trim().max(80).nullish(),
  chequeNumber: z.string().trim().max(40).nullish(),
  chequeDueAt: z.string().datetime({ offset: true }).nullish(),
});

/** Registra un cobro con la comisión del medio de pago; si es la seña, la marca cobrada en el presupuesto. */
export async function registerPayment(bid: string, body: z.infer<typeof paymentSchema> & { mpPaymentId?: string; feePct?: number; net?: number }) {
  const b = await prisma.business.findUniqueOrThrow({ where: { id: bid } });
  const q = body.quoteId ? await prisma.quote.findFirst({ where: { id: body.quoteId, businessId: bid } }) : null;
  if (body.quoteId && !q) throw badRequest('quote_not_found');
  const fees = b.payFees as Record<string, number>;
  const feePct = body.feePct ?? Number(fees[body.method] ?? 0);
  const isCheque = body.method === 'CHEQUE' || body.method === 'ECHEQ';
  const p = await prisma.payment.create({
    data: {
      businessId: bid,
      quoteId: q?.id ?? null,
      customerId: body.customerId ?? q?.customerId ?? null,
      kind: body.kind,
      method: body.method,
      amount: body.amount,
      feePct,
      net: body.net ?? netOf(body.amount, feePct),
      date: body.date ? new Date(body.date) : new Date(),
      note: body.note,
      chequeBank: isCheque ? (body.chequeBank ?? null) : null,
      chequeNumber: isCheque ? (body.chequeNumber ?? null) : null,
      chequeDueAt: isCheque && body.chequeDueAt ? new Date(body.chequeDueAt) : null,
      chequeStatus: isCheque ? 'CARTERA' : null,
      mpPaymentId: body.mpPaymentId ?? null,
    },
  });
  if (q && body.kind === 'SENA' && !q.depositPaidAt) await prisma.quote.update({ where: { id: q.id }, data: { depositPaidAt: p.date } });
  return p;
}

/** Cuentas por cobrar: lo aceptado menos lo cobrado, por cliente. */
export async function receivables(bid: string) {
  const quotes = await prisma.quote.findMany({
    where: { businessId: bid, status: 'ACCEPTED' },
    select: { id: true, number: true, title: true, total: true, acceptedAt: true, customer: { select: { id: true, name: true, phone: true, type: true } }, payments: { select: { amount: true } } },
    orderBy: { acceptedAt: 'asc' },
  });
  const open = quotes
    .map((q) => ({ ...q, paid: q.payments.reduce((a, p) => a + num(p.amount), 0), total: num(q.total) }))
    .map(({ payments: _p, ...q }) => ({ ...q, due: Math.max(0, Math.round(q.total - q.paid)) }))
    .filter((q) => q.due > 0);
  const byCustomer = new Map<string, { customer: (typeof open)[number]['customer']; due: number; oldest: Date | null; quotes: typeof open }>();
  for (const q of open) {
    const k = q.customer?.id ?? 'none';
    const c = byCustomer.get(k) ?? { customer: q.customer, due: 0, oldest: null, quotes: [] };
    c.due += q.due;
    c.quotes.push(q);
    if (q.acceptedAt && (!c.oldest || q.acceptedAt < c.oldest)) c.oldest = q.acceptedAt;
    byCustomer.set(k, c);
  }
  return [...byCustomer.values()].sort((a, b) => b.due - a.due);
}

export async function cashRoutes(app: FastifyInstance) {
  app.get('/payments', guard('cash'), async (req) =>
    prisma.payment.findMany({
      where: { businessId: req.auth.bid, date: dateRange(req.query as { from?: string; to?: string }) },
      orderBy: { date: 'desc' },
      include: { quote: { select: { id: true, number: true, title: true, customer: { select: { name: true } } } } },
    }),
  );

  app.post('/payments', guard('cash'), async (req) => registerPayment(req.auth.bid, paymentSchema.parse(req.body)));

  app.patch('/payments/:id', guard('cash'), async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ chequeStatus: z.enum(['CARTERA', 'DEPOSITADO', 'COBRADO', 'ENDOSADO', 'RECHAZADO']), note: z.string().trim().max(300) }).partial().parse(req.body);
    const r = await prisma.payment.updateMany({ where: { id, businessId: req.auth.bid }, data: body });
    if (!r.count) throw notFound();
    return prisma.payment.findUniqueOrThrow({ where: { id } });
  });

  app.delete('/payments/:id', guard('cash'), async (req) => {
    const { id } = req.params as { id: string };
    await prisma.payment.deleteMany({ where: { id, businessId: req.auth.bid } });
    return { ok: true };
  });

  app.get('/cheques', guard('cash'), async (req) =>
    prisma.payment.findMany({
      where: { businessId: req.auth.bid, method: { in: ['CHEQUE', 'ECHEQ'] } },
      orderBy: [{ chequeDueAt: 'asc' }],
      include: { quote: { select: { number: true, customer: { select: { name: true } } } } },
    }),
  );

  app.get('/receivables', guard('cash'), async (req) => receivables(req.auth.bid));

  // Gastos
  const expenseSchema = z.object({
    category: z.enum(EXPENSE_CATEGORIES),
    description: z.string().trim().max(200).default(''),
    amount: z.number().finite().positive().max(1e12),
    date: z.string().datetime({ offset: true }),
    recurring: z.boolean().default(false),
    jobId: z.string().nullish(),
  });
  app.get('/expenses', guard('cash'), async (req) => {
    const range = dateRange(req.query as { from?: string; to?: string });
    const [inRange, fixed] = await Promise.all([
      prisma.expense.findMany({ where: { businessId: req.auth.bid, date: range, recurring: false }, orderBy: { date: 'desc' } }),
      prisma.expense.findMany({ where: { businessId: req.auth.bid, recurring: true, date: { lt: range.lt } }, orderBy: { category: 'asc' } }),
    ]);
    return { expenses: inRange, fixed };
  });
  app.post('/expenses', guard('cash'), async (req) => {
    const body = expenseSchema.parse(req.body);
    if (body.jobId && !(await prisma.job.findFirst({ where: { id: body.jobId, businessId: req.auth.bid } }))) throw badRequest('job_not_found');
    return prisma.expense.create({ data: { ...body, date: new Date(body.date), jobId: body.jobId ?? null, businessId: req.auth.bid } });
  });
  app.delete('/expenses/:id', guard('cash'), async (req) => {
    const { id } = req.params as { id: string };
    await prisma.expense.deleteMany({ where: { id, businessId: req.auth.bid } });
    return { ok: true };
  });

  // Jornales
  app.get('/workdays', guard('cash'), async (req) => {
    const { from, to } = req.query as { from?: string; to?: string };
    const range = from && to ? { gte: new Date(from), lt: new Date(to) } : { gte: new Date(Date.now() - 7 * DAY) };
    return prisma.workDay.findMany({
      where: { businessId: req.auth.bid, date: range },
      orderBy: [{ date: 'desc' }, { worker: 'asc' }],
      include: { crew: { select: { name: true, color: true } }, job: { select: { quote: { select: { number: true, title: true } } } } },
    });
  });
  app.post('/workdays', guard('cash'), async (req) => {
    const body = z
      .object({
        crewId: z.string().nullish(),
        worker: z.string().trim().min(1).max(80),
        date: z.string().datetime({ offset: true }),
        jobId: z.string().nullish(),
        amount: z.number().finite().positive().max(1e10),
        advance: z.boolean().default(false),
      })
      .parse(req.body);
    return prisma.workDay.create({ data: { ...body, date: new Date(body.date), crewId: body.crewId ?? null, jobId: body.jobId ?? null, businessId: req.auth.bid } });
  });
  /** Carga el día de todo un equipo (un jornal por integrante, con el jornal del equipo). */
  app.post('/workdays/crew', guard('cash'), async (req) => {
    const body = z.object({ crewId: z.string(), date: z.string().datetime({ offset: true }), jobId: z.string().nullish() }).parse(req.body);
    const crew = await prisma.crew.findFirst({ where: { id: body.crewId, businessId: req.auth.bid } });
    if (!crew) throw notFound();
    const people = crew.members.split(/,|\n|\s+y\s+/).map((s) => s.trim()).filter(Boolean);
    if (!people.length) throw badRequest('no_members', 'Cargá los integrantes del equipo en Trabajos → Equipos');
    await prisma.workDay.createMany({
      data: people.map((worker) => ({ businessId: req.auth.bid, crewId: crew.id, worker, date: new Date(body.date), jobId: body.jobId ?? null, amount: crew.dayRate })),
    });
    return { ok: true, count: people.length };
  });
  app.post('/workdays/pay', guard('cash'), async (req) => {
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(500) }).parse(req.body);
    const r = await prisma.workDay.updateMany({ where: { id: { in: ids }, businessId: req.auth.bid, paidAt: null }, data: { paidAt: new Date() } });
    return { ok: true, count: r.count };
  });
  app.delete('/workdays/:id', guard('cash'), async (req) => {
    const { id } = req.params as { id: string };
    await prisma.workDay.deleteMany({ where: { id, businessId: req.auth.bid } });
    return { ok: true };
  });
}

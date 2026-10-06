import type { FastifyInstance } from 'fastify';
import { customerSchema } from '@vidrieria/shared';
import { prisma } from '../db';
import { guard } from '../lib/auth';
import { notFound } from '../lib/http';

export async function customerRoutes(app: FastifyInstance) {
  app.get('/customers', guard(), async (req) => {
    const { q } = req.query as { q?: string };
    const term = q?.trim();
    return prisma.customer.findMany({
      where: {
        businessId: req.auth.bid,
        ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { phone: { contains: term.replace(/\D/g, '') || term } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  app.get('/customers/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const c = await prisma.customer.findFirst({
      where: { id, businessId: req.auth.bid },
      include: {
        quotes: { orderBy: { createdAt: 'desc' }, select: { id: true, number: true, title: true, status: true, total: true, createdAt: true, payments: { select: { amount: true } } } },
      },
    });
    if (!c) throw notFound();
    return c;
  });

  app.post('/customers', guard(), async (req) => {
    const body = customerSchema.parse(req.body);
    return prisma.customer.create({ data: { ...body, businessId: req.auth.bid } });
  });

  app.patch('/customers/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const body = customerSchema.partial().parse(req.body);
    const r = await prisma.customer.updateMany({ where: { id, businessId: req.auth.bid }, data: body });
    if (!r.count) throw notFound();
    return prisma.customer.findUniqueOrThrow({ where: { id } });
  });

  /** Link de recomendación del cliente: el que llega por ahí queda anotado como recomendado por él. */
  app.post('/customers/:id/referral', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const c = await prisma.customer.findFirst({ where: { id, businessId: req.auth.bid } });
    if (!c) throw notFound();
    if (c.referralCode) return { code: c.referralCode };
    for (;;) {
      const code = Math.random().toString(36).slice(2, 8);
      try {
        await prisma.customer.update({ where: { id }, data: { referralCode: code } });
        return { code };
      } catch {
        // código repetido: probar otro
      }
    }
  });
}

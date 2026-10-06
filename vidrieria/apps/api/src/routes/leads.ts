import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LEAD_STATUSES } from '@vidrieria/shared';
import { prisma } from '../db';
import { guard } from '../lib/auth';
import { notFound } from '../lib/http';

export async function leadRoutes(app: FastifyInstance) {
  app.get('/leads', guard(), async (req) => {
    const { status } = req.query as { status?: string };
    const st = z.enum(LEAD_STATUSES).optional().parse(status || undefined);
    return prisma.lead.findMany({
      where: { businessId: req.auth.bid, ...(st ? { status: st } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { quotes: { select: { id: true, number: true, status: true } } },
    });
  });

  app.get('/leads/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const l = await prisma.lead.findFirst({ where: { id, businessId: req.auth.bid }, include: { quotes: { select: { id: true, number: true, status: true } } } });
    if (!l) throw notFound();
    return l;
  });

  app.patch('/leads/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ status: z.enum(LEAD_STATUSES).optional(), customerId: z.string().nullish() }).parse(req.body);
    if (body.customerId && !(await prisma.customer.findFirst({ where: { id: body.customerId, businessId: req.auth.bid } }))) throw notFound('customer_not_found');
    const r = await prisma.lead.updateMany({ where: { id, businessId: req.auth.bid }, data: body });
    if (!r.count) throw notFound();
    return prisma.lead.findUniqueOrThrow({ where: { id } });
  });
}

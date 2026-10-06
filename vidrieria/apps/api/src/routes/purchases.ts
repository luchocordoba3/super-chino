import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { guard } from '../lib/auth';

export async function purchaseRoutes(app: FastifyInstance) {
  /** Aceptados con material sin pedir: de acá sale la lista de compras. */
  app.get('/purchases', guard(), async (req) =>
    prisma.quote.findMany({
      where: { businessId: req.auth.bid, status: 'ACCEPTED', purchasedAt: null },
      orderBy: { acceptedAt: 'asc' },
      select: { id: true, number: true, title: true, acceptedAt: true, result: true, customer: { select: { id: true, name: true } } },
    }),
  );

  app.post('/purchases/mark', guard(), async (req) => {
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(200) }).parse(req.body);
    const r = await prisma.quote.updateMany({ where: { id: { in: ids }, businessId: req.auth.bid, status: 'ACCEPTED' }, data: { purchasedAt: new Date() } });
    return { ok: true, count: r.count };
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { setJobStatus } from '../services/jobs';
import { guard } from '../lib/auth';

export async function purchaseRoutes(app: FastifyInstance) {
  /** Aceptados con material sin pedir: de acá sale la lista de compras. */
  app.get('/purchases', guard('materials'), async (req) =>
    prisma.quote.findMany({
      where: { businessId: req.auth.bid, status: 'ACCEPTED', purchasedAt: null },
      orderBy: { acceptedAt: 'asc' },
      select: { id: true, number: true, title: true, acceptedAt: true, result: true, customer: { select: { id: true, name: true } } },
    }),
  );

  app.post('/purchases/mark', guard('materials'), async (req) => {
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(200) }).parse(req.body);
    const r = await prisma.quote.updateMany({ where: { id: { in: ids }, businessId: req.auth.bid, status: 'ACCEPTED' }, data: { purchasedAt: new Date() } });
    // Los trabajos de esos presupuestos pasan a "Pedido", con su fecha prometida.
    const jobs = await prisma.job.findMany({ where: { quoteId: { in: ids }, businessId: req.auth.bid, status: 'PENDING' }, select: { id: true } });
    for (const j of jobs) await setJobStatus(j.id, 'ORDERED');
    return { ok: true, count: r.count };
  });
}

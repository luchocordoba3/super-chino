import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PLANS } from '@vidrieria/shared';
import { prisma } from '../db';
import { authenticate, isAdmin } from '../lib/auth';
import { HttpError, notFound } from '../lib/http';

/** Panel de Lumina: todas las vidrierías y su plan. */
const adminOnly = {
  preHandler: async (req: FastifyRequest) => {
    await authenticate(req);
    if (!isAdmin(req.auth.email)) throw new HttpError(403, 'forbidden');
  },
};

export async function adminRoutes(app: FastifyInstance) {
  app.get('/admin/businesses', adminOnly, async () => {
    const monthStart = new Date(Date.now() - 30 * 86_400_000);
    const list = await prisma.business.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        name: true,
        plan: true,
        createdAt: true,
        customDomain: true,
        users: { where: { role: 'OWNER' }, select: { email: true, name: true }, take: 1 },
        _count: { select: { quotes: true, leads: true, jobs: true } },
      },
    });
    const [renders, last] = await Promise.all([
      prisma.render.groupBy({ by: ['businessId'], where: { createdAt: { gte: monthStart } }, _count: true }),
      prisma.quote.groupBy({ by: ['businessId'], _max: { updatedAt: true } }),
    ]);
    const r = new Map(renders.map((x) => [x.businessId, x._count]));
    const l = new Map(last.map((x) => [x.businessId, x._max.updatedAt]));
    return list.map(({ users, _count, ...b }) => ({ ...b, owner: users[0] ?? null, counts: _count, rendersMonth: r.get(b.id) ?? 0, lastActivity: l.get(b.id) ?? null }));
  });

  app.patch('/admin/businesses/:id', adminOnly, async (req) => {
    const { id } = req.params as { id: string };
    const { plan } = z.object({ plan: z.enum(PLANS) }).parse(req.body);
    const b = await prisma.business.update({ where: { id }, data: { plan }, select: { id: true, plan: true } }).catch(() => null);
    if (!b) throw notFound();
    return b;
  });
}

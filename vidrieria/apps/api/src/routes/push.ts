import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { guard } from '../lib/auth';
import { vapidPublicKey } from '../services/push';

const subSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

export async function pushRoutes(app: FastifyInstance) {
  app.get('/push/key', guard(), async () => ({ publicKey: vapidPublicKey }));

  app.post('/push/subscribe', guard(), async (req) => {
    const s = subSchema.parse(req.body);
    const data = { businessId: req.auth.bid, userId: req.auth.uid, p256dh: s.keys.p256dh, auth: s.keys.auth };
    await prisma.pushSubscription.upsert({ where: { endpoint: s.endpoint }, create: { endpoint: s.endpoint, ...data }, update: data });
    return { ok: true };
  });

  app.post('/push/unsubscribe', guard(), async (req) => {
    const { endpoint } = z.object({ endpoint: z.string().max(2000) }).parse(req.body);
    await prisma.pushSubscription.deleteMany({ where: { endpoint, businessId: req.auth.bid } });
    return { ok: true };
  });
}

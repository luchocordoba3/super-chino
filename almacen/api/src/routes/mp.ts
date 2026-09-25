import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../env';
import { deviceGuard, guard } from '../lib/auth';
import { hmacSha256, safeEqual } from '../lib/crypto';
import { badRequest, HttpError } from '../lib/http';
import * as mp from '../services/mp';
import { publish } from '../services/notify';

/** Dirección pública de la app (para volver de Mercado Pago y para sus avisos). */
const publicUrl = (req: FastifyRequest) =>
  env.PUBLIC_URL || `${String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0]}://${String(req.headers['x-forwarded-host'] ?? req.headers.host)}`;
const redirectUri = (req: FastifyRequest) => `${publicUrl(req)}/api/mp/callback`;

// "state" de la autorización: de qué local es, firmado y con vencimiento (vuelve sin sesión).
const stateKey = () => `mp-state:${env.SECRETS_KEY || env.JWT_SECRET}`;
export function signState(sid: string) {
  const body = Buffer.from(JSON.stringify({ sid, exp: Date.now() + 15 * 60_000 })).toString('base64url');
  return `${body}.${hmacSha256(stateKey(), body)}`;
}
export function readState(state: string): string | null {
  const [body, sig] = state.split('.');
  if (!body || !sig || !safeEqual(hmacSha256(stateKey(), body), sig)) return null;
  const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { sid: string; exp: number };
  return d.exp > Date.now() ? d.sid : null;
}

export async function mpRoutes(app: FastifyInstance) {
  // ---------- Dueño: conectar la cuenta y armar los QR de mesas y mostrador ----------
  app.get('/mp', guard('owner'), async (req) => {
    const acc = await prisma.mpAccount.findUnique({ where: { storeId: req.auth.sid } });
    return {
      connected: !!acc,
      userId: acc?.userId ?? null,
      oauth: mp.oauthEnabled(),
      hasStore: !!acc?.mpStoreId,
      qrs: acc ? await mp.listQrs(req.auth.sid) : [],
      webhookUrl: `${publicUrl(req)}/api/mp/webhook`,
    };
  });

  app.get('/mp/connect', guard('owner'), async (req) => {
    if (!mp.oauthEnabled()) throw new HttpError(409, 'mp_oauth_disabled');
    return { url: mp.authorizeUrl(redirectUri(req), signState(req.auth.sid)) };
  });

  // Vuelve de Mercado Pago sin sesión: el "state" firmado dice de qué local es.
  app.get('/mp/callback', async (req, reply) => {
    const q = z.object({ code: z.string().optional(), state: z.string().optional() }).parse(req.query);
    const sid = readState(q.state ?? '');
    if (!sid) return reply.redirect('/settings?mp=error');
    if (!q.code) return reply.redirect('/settings?mp=cancelled');
    try {
      await mp.connectWithCode(sid, q.code, redirectUri(req));
    } catch {
      return reply.redirect('/settings?mp=error');
    }
    return reply.redirect('/settings?mp=ok');
  });

  app.post('/mp/token', guard('owner'), async (req) => {
    const b = z.object({ accessToken: z.string().trim().min(20).max(300) }).parse(req.body);
    try {
      await mp.connectWithToken(req.auth.sid, b.accessToken);
    } catch (e) {
      if (e instanceof mp.MpError) throw badRequest('mp_bad_token');
      throw e;
    }
    return { ok: true };
  });

  app.delete('/mp', guard('owner'), async (req) => {
    await prisma.$transaction([prisma.mpPos.deleteMany({ where: { storeId: req.auth.sid } }), prisma.mpAccount.deleteMany({ where: { storeId: req.auth.sid } })]);
    publish(req.auth.sid, 'catalog');
    return { ok: true };
  });

  app.post('/mp/setup', guard('owner'), async (req) => {
    const text = z.string().trim().min(1).max(80);
    const b = z
      .object({
        address: z
          .object({ streetName: text, streetNumber: z.string().trim().min(1).max(10), city: text, state: text, latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
          .nullish(),
      })
      .parse(req.body ?? {});
    const qrs = await mp.setupQrs(req.auth.sid, b.address ?? null);
    // Para que las cajas se enteren de que ya pueden cobrar con QR.
    await prisma.store.update({ where: { id: req.auth.sid }, data: {} });
    publish(req.auth.sid, 'catalog');
    return qrs;
  });

  // ---------- Caja: cobrar con el QR de la mesa o del mostrador ----------
  app.post('/pos/mp/charges', deviceGuard, async (req) => {
    const b = z
      .object({ chargeId: z.uuid(), amount: z.number().positive().max(1e9), table: z.number().int().min(1).max(99).nullish(), description: z.string().trim().max(150).optional() })
      .parse(req.body);
    return mp.createCharge(req.device.storeId, { chargeId: b.chargeId, amount: b.amount, table: b.table ?? null, description: b.description || 'Consumo' });
  });
  app.get('/pos/mp/charges/:id', deviceGuard, async (req) => mp.chargeStatus(req.device.storeId, (req.params as { id: string }).id));
  app.post('/pos/mp/charges/:id/cancel', deviceGuard, async (req) => mp.cancelCharge(req.device.storeId, (req.params as { id: string }).id));

  // ---------- Avisos de Mercado Pago (webhook, tópico "order") ----------
  app.post('/mp/webhook', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const body = (req.body ?? {}) as { type?: string; data?: { id?: string } };
    const id = q['data.id'] ?? body.data?.id;
    if (!id) return { ok: true };
    if (!mp.validSignature(req.headers['x-signature'] as string | undefined, req.headers['x-request-id'] as string | undefined, id)) {
      return reply.status(401).send({ error: 'bad_signature' });
    }
    if ((q.type ?? body.type) !== 'order') return { ok: true };
    const r = await mp.onOrderNotification(id).catch(() => null);
    if (r) publish(r.storeId, 'mp', { status: r.status });
    return { ok: true };
  });
}

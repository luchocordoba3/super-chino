import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LANGS, PERMS, parseSettings, StoreSettingsSchema } from '@super-chino/shared';
import { prisma } from '../db';
import { env } from '../env';
import { guard, publicUser, SESSION_COOKIE, setSession } from '../lib/auth';
import { hashPassword, hashPin, randomCode, verifyPassword, verifyPin } from '../lib/crypto';
import { HttpError, notFound } from '../lib/http';
import { aiService } from '../ai';

const limited = { config: { rateLimit: { max: env.isTest ? 10_000 : 10, timeWindow: '1 minute' } } };
const pinSchema = z.string().regex(/^\d{4,8}$/, 'El PIN debe tener de 4 a 8 números');

async function uniqueStoreCode() {
  for (;;) {
    const code = randomCode(6);
    if (!(await prisma.store.findUnique({ where: { code } }))) return code;
  }
}

function publicStore(s: { id: string; name: string; code: string; currency: string; timezone: string; settings: unknown }) {
  return { id: s.id, name: s.name, code: s.code, currency: s.currency, timezone: s.timezone, settings: parseSettings(s.settings) };
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', limited, async (req, reply) => {
    const b = z
      .object({
        storeName: z.string().trim().min(2).max(80),
        name: z.string().trim().min(2).max(80),
        email: z.email(),
        password: z.string().min(8).max(100),
        lang: z.enum(LANGS).default('es'),
      })
      .parse(req.body);
    const email = b.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, 'email_taken');
    const store = await prisma.store.create({
      data: {
        name: b.storeName,
        code: await uniqueStoreCode(),
        users: {
          create: { role: 'OWNER', name: b.name, username: 'dueno', email, passwordHash: await hashPassword(b.password), lang: b.lang },
        },
      },
      include: { users: true },
    });
    await setSession(reply, store.users[0]);
    return { ok: true };
  });

  app.post('/auth/owner-login', limited, async (req, reply) => {
    const b = z.object({ email: z.string().trim().toLowerCase(), password: z.string().min(1) }).parse(req.body);
    const u = await prisma.user.findUnique({ where: { email: b.email } });
    if (!u || !u.active || !u.passwordHash || !(await verifyPassword(b.password, u.passwordHash))) {
      throw new HttpError(401, 'invalid_credentials');
    }
    await setSession(reply, u);
    return { ok: true };
  });

  app.post('/auth/login', limited, async (req, reply) => {
    const b = z
      .object({ storeCode: z.string().trim().toUpperCase(), username: z.string().trim().toLowerCase(), pin: pinSchema })
      .parse(req.body);
    const store = await prisma.store.findUnique({ where: { code: b.storeCode } });
    const u = store
      ? await prisma.user.findUnique({ where: { storeId_username: { storeId: store.id, username: b.username } } })
      : null;
    if (!u || !u.active || !u.pinHash || !verifyPin(b.pin, u.pinHash)) throw new HttpError(401, 'invalid_credentials');
    await setSession(reply, u);
    return { ok: true };
  });

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', guard(), async (req) => {
    const [user, store] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: req.auth.uid } }),
      prisma.store.findUniqueOrThrow({ where: { id: req.auth.sid } }),
    ]);
    return {
      user: publicUser(user),
      store: publicStore(store),
      vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
      aiEnabled: aiService.enabled(),
    };
  });

  /** Cada usuario elige su idioma. */
  app.patch('/auth/me', guard(), async (req) => {
    const b = z.object({ lang: z.enum(LANGS).optional(), name: z.string().trim().min(1).max(80).optional() }).parse(req.body);
    const u = await prisma.user.update({ where: { id: req.auth.uid }, data: b });
    return publicUser(u);
  });

  // ---------- Empleados (solo el dueño) ----------

  app.get('/users', guard('owner'), async (req) => {
    const users = await prisma.user.findMany({ where: { storeId: req.auth.sid }, orderBy: { createdAt: 'asc' } });
    return users.map(publicUser);
  });

  /** Lista corta para elegir destinatarios y mostrar nombres. */
  app.get('/users/directory', guard(), async (req) => {
    return prisma.user.findMany({
      where: { storeId: req.auth.sid },
      select: { id: true, name: true, role: true, lang: true, active: true },
      orderBy: { name: 'asc' },
    });
  });

  app.post('/users', guard('owner'), async (req) => {
    const b = z
      .object({
        name: z.string().trim().min(1).max(80),
        username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,30}$/),
        pin: pinSchema,
        perms: z.array(z.enum(PERMS)).default(['sell']),
        lang: z.enum(LANGS).default('es'),
      })
      .parse(req.body);
    const exists = await prisma.user.findUnique({ where: { storeId_username: { storeId: req.auth.sid, username: b.username } } });
    if (exists) throw new HttpError(409, 'username_taken');
    const u = await prisma.user.create({
      data: { storeId: req.auth.sid, role: 'EMPLOYEE', name: b.name, username: b.username, pinHash: hashPin(b.pin), perms: b.perms, lang: b.lang },
    });
    return publicUser(u);
  });

  app.patch('/users/:id', guard('owner'), async (req) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        pin: pinSchema.optional(),
        perms: z.array(z.enum(PERMS)).optional(),
        lang: z.enum(LANGS).optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body);
    const u = await prisma.user.findFirst({ where: { id, storeId: req.auth.sid } });
    if (!u) throw notFound();
    if (u.role === 'OWNER' && (b.active === false || b.perms)) throw new HttpError(400, 'cannot_change_owner');
    const updated = await prisma.user.update({
      where: { id },
      data: {
        name: b.name,
        perms: b.perms,
        lang: b.lang,
        active: b.active,
        pinHash: b.pin ? hashPin(b.pin) : undefined,
      },
    });
    return publicUser(updated);
  });

  // ---------- Local ----------

  app.get('/store', guard(), async (req) => {
    return publicStore(await prisma.store.findUniqueOrThrow({ where: { id: req.auth.sid } }));
  });

  app.patch('/store', guard('owner'), async (req) => {
    const b = z
      .object({ name: z.string().trim().min(2).max(80).optional(), settings: z.record(z.string(), z.unknown()).optional() })
      .parse(req.body);
    const store = await prisma.store.findUniqueOrThrow({ where: { id: req.auth.sid } });
    const settings = StoreSettingsSchema.parse({ ...parseSettings(store.settings), ...(b.settings ?? {}) });
    const updated = await prisma.store.update({ where: { id: store.id }, data: { name: b.name, settings } });
    return publicStore(updated);
  });
}

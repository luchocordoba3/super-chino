import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../env';
import { SESSION_COOKIE, guard, isAdmin, publicUser, setSession } from '../lib/auth';
import { HttpError, badRequest } from '../lib/http';
import { RESERVED_SLUGS, slugify } from '../services/site';
import { defaultSite, loadStarterKit } from '../services/starter';

export async function authRoutes(app: FastifyInstance) {
  const limit = { config: { rateLimit: { max: env.AUTH_RATE_LIMIT, timeWindow: '1 minute' } } };

  app.post('/auth/login', limit, async (req, reply) => {
    const body = z.object({ email: z.string().trim().toLowerCase(), password: z.string() }).parse(req.body);
    const u = await prisma.user.findUnique({ where: { email: body.email } });
    if (!u || !u.active || !(await bcrypt.compare(body.password, u.passwordHash))) throw new HttpError(401, 'bad_credentials');
    await setSession(reply, u);
    return { user: publicUser(u) };
  });

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** Alta de una vidriería nueva con su dueño y el catálogo de ejemplo. */
  app.post('/auth/signup', limit, async (req, reply) => {
    const body = z
      .object({
        businessName: z.string().trim().min(2, 'Escribí el nombre de la vidriería').max(80),
        name: z.string().trim().min(1, 'Escribí tu nombre').max(80),
        email: z.string().trim().toLowerCase().email('El email no es válido'),
        password: z.string().min(8, 'La contraseña tiene que tener al menos 8 caracteres').max(100),
        whatsapp: z.string().trim().max(40).default(''),
        zones: z.string().trim().max(200).default(''),
      })
      .parse(req.body);
    if (await prisma.user.findUnique({ where: { email: body.email } })) throw badRequest('email_taken', 'Ya hay una cuenta con ese email');
    let slug = slugify(body.businessName);
    if (RESERVED_SLUGS.has(slug)) slug = `${slug}-vidrieria`;
    for (let i = 2; await prisma.business.findUnique({ where: { slug } }); i++) slug = `${slugify(body.businessName)}-${i}`;
    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.$transaction(async (tx) => {
      const b = await tx.business.create({
        data: { slug, name: body.businessName, whatsapp: body.whatsapp, zones: body.zones, site: defaultSite(body.businessName, body.zones) },
      });
      await loadStarterKit(tx, b.id);
      return tx.user.create({ data: { businessId: b.id, name: body.name, email: body.email, passwordHash, role: 'OWNER' } });
    });
    await setSession(reply, user);
    return { user: publicUser(user) };
  });

  app.get('/auth/me', guard(), async (req) => {
    const [u, b] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: req.auth.uid } }),
      prisma.business.findUniqueOrThrow({ where: { id: req.auth.bid }, select: { id: true, slug: true, name: true, customDomain: true, plan: true } }),
    ]);
    return { user: publicUser(u), business: b, isAdmin: isAdmin(u.email) };
  });

  // Usuarios de la vidriería (dueño y socio)
  app.get('/users', guard('owner'), async (req) => {
    const users = await prisma.user.findMany({ where: { businessId: req.auth.bid }, orderBy: { createdAt: 'asc' } });
    return users.map(publicUser);
  });

  app.post('/users', guard('owner'), async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        email: z.string().trim().toLowerCase().email('El email no es válido'),
        password: z.string().min(8, 'La contraseña tiene que tener al menos 8 caracteres').max(100),
      })
      .parse(req.body);
    if (await prisma.user.findUnique({ where: { email: body.email } })) throw badRequest('email_taken', 'Ya hay una cuenta con ese email');
    const u = await prisma.user.create({
      data: { businessId: req.auth.bid, name: body.name, email: body.email, passwordHash: await bcrypt.hash(body.password, 10), role: 'PARTNER' },
    });
    return publicUser(u);
  });

  app.patch('/users/:id', guard('owner'), async (req) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({ name: z.string().trim().min(1).max(80).optional(), active: z.boolean().optional(), password: z.string().min(8).max(100).optional() })
      .parse(req.body);
    const u = await prisma.user.findFirst({ where: { id, businessId: req.auth.bid } });
    if (!u) throw new HttpError(404, 'not_found');
    if (u.id === req.auth.uid && body.active === false) throw badRequest('cannot_disable_self', 'No podés darte de baja a vos mismo');
    const updated = await prisma.user.update({
      where: { id },
      data: { name: body.name, active: body.active, passwordHash: body.password ? await bcrypt.hash(body.password, 10) : undefined },
    });
    return publicUser(updated);
  });
}

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { PLAN_INFO, hasFeature, minPlanFor, type Feature, type PlanId } from '@vidrieria/shared';
import { prisma } from '../db';
import { env } from '../env';
import { HttpError } from './http';

export interface AuthCtx {
  uid: string;
  bid: string;
  role: 'OWNER' | 'PARTNER';
  name: string;
  email: string;
  plan: PlanId;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthCtx;
  }
}
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { uid: string; bid: string };
    user: { uid: string; bid: string };
  }
}

export const SESSION_COOKIE = 'vd_session';

export async function setSession(reply: FastifyReply, user: Pick<User, 'id' | 'businessId'>) {
  const token = await reply.jwtSign({ uid: user.id, bid: user.businessId }, { expiresIn: '30d' });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** Verifica la sesión y recarga el usuario (un usuario dado de baja queda afuera al instante). */
export async function authenticate(req: FastifyRequest) {
  try {
    await req.jwtVerify();
  } catch {
    throw new HttpError(401, 'unauthorized');
  }
  const u = await prisma.user.findUnique({ where: { id: req.user.uid }, include: { business: { select: { plan: true } } } });
  if (!u || !u.active || u.businessId !== req.user.bid) throw new HttpError(401, 'unauthorized');
  req.auth = { uid: u.id, bid: u.businessId, role: u.role, name: u.name, email: u.email, plan: u.business.plan };
}

/** Corta si el plan de la vidriería no incluye esa parte del sistema. */
export function requireFeature(req: FastifyRequest, f: Feature) {
  if (!hasFeature(req.auth.plan, f)) throw new HttpError(403, 'plan_required', `Disponible en el plan ${PLAN_INFO[minPlanFor(f)].name}`);
}

/** guard() = cualquier usuario; 'owner' = solo el dueño; una parte del sistema ('jobs', 'cash'...) = que el plan la incluya. */
export function guard(...needs: ('owner' | Feature)[]) {
  return {
    preHandler: async (req: FastifyRequest) => {
      await authenticate(req);
      for (const n of needs) {
        if (n === 'owner') {
          if (req.auth.role !== 'OWNER') throw new HttpError(403, 'forbidden');
        } else requireFeature(req, n);
      }
    },
  };
}

/** Lumina: los que administran todas las vidrierías (LUMINA_ADMINS, separados por coma). */
export const isAdmin = (email: string) =>
  (process.env.LUMINA_ADMINS ?? 'lucianocordoba3@gmail.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .includes(email.toLowerCase());

export function publicUser(u: User) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active };
}

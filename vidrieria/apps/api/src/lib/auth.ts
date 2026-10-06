import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { HttpError } from './http';

export interface AuthCtx {
  uid: string;
  bid: string;
  role: 'OWNER' | 'PARTNER';
  name: string;
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
  const u = await prisma.user.findUnique({ where: { id: req.user.uid } });
  if (!u || !u.active || u.businessId !== req.user.bid) throw new HttpError(401, 'unauthorized');
  req.auth = { uid: u.id, bid: u.businessId, role: u.role, name: u.name };
}

/** guard() = cualquier usuario de la vidriería; guard('owner') = solo el dueño. */
export function guard(need?: 'owner') {
  return {
    preHandler: async (req: FastifyRequest) => {
      await authenticate(req);
      if (need === 'owner' && req.auth.role !== 'OWNER') throw new HttpError(403, 'forbidden');
    },
  };
}

export function publicUser(u: User) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active };
}

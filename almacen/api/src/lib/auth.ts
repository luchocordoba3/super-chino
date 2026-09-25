import type { FastifyReply, FastifyRequest } from 'fastify';
import { PERMS, type Lang, type Perm } from '@almacen/shared';
import type { User } from '../generated/prisma/index.js';
import { prisma } from '../db';
import { env } from '../env';
import { sha256 } from './crypto';
import { HttpError } from './http';

export interface AuthCtx {
  uid: string;
  sid: string;
  role: 'OWNER' | 'EMPLOYEE';
  perms: Perm[];
  lang: Lang;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthCtx;
    device: { id: string; storeId: string };
  }
}
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { uid: string; sid: string };
    user: { uid: string; sid: string };
  }
}

export const SESSION_COOKIE = 'sc_session';

export async function setSession(reply: FastifyReply, user: Pick<User, 'id' | 'storeId'>) {
  const token = await reply.jwtSign({ uid: user.id, sid: user.storeId }, { expiresIn: '30d' });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** Verifica la sesión y recarga el usuario (así un empleado dado de baja queda afuera al instante). */
export async function authenticate(req: FastifyRequest) {
  try {
    await req.jwtVerify();
  } catch {
    throw new HttpError(401, 'unauthorized');
  }
  const u = await prisma.user.findUnique({ where: { id: req.user.uid } });
  if (!u || !u.active || u.storeId !== req.user.sid) throw new HttpError(401, 'unauthorized');
  req.auth = {
    uid: u.id,
    sid: u.storeId,
    role: u.role,
    perms: u.role === 'OWNER' ? [...PERMS] : (u.perms.filter((p) => (PERMS as readonly string[]).includes(p)) as Perm[]),
    lang: u.lang,
    name: u.name,
  };
}

export const can = (a: AuthCtx, p: Perm | 'owner') => a.role === 'OWNER' || (p !== 'owner' && a.perms.includes(p));

/** guard() = cualquier usuario logueado; guard('stock','prices') = alcanza con uno de esos permisos. */
export function guard(...need: (Perm | 'owner')[]) {
  return {
    preHandler: async (req: FastifyRequest) => {
      await authenticate(req);
      if (need.length && !need.some((p) => can(req.auth, p))) throw new HttpError(403, 'forbidden');
    },
  };
}

/** Autenticación de la PC-caja con su token de dispositivo. */
export const deviceGuard = {
  preHandler: async (req: FastifyRequest) => {
    const token = req.headers['x-device-token'];
    if (typeof token !== 'string' || !token) throw new HttpError(401, 'device_unauthorized');
    const d = await prisma.device.findUnique({ where: { tokenHash: sha256(token) } });
    if (!d || d.revokedAt) throw new HttpError(401, 'device_unauthorized');
    req.device = { id: d.id, storeId: d.storeId };
    if (!d.lastSeenAt || Date.now() - d.lastSeenAt.getTime() > 60_000) {
      await prisma.device.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } });
    }
  },
};

export function publicUser(u: User) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    role: u.role,
    perms: u.role === 'OWNER' ? [...PERMS] : u.perms,
    lang: u.lang,
    active: u.active,
    hasPin: !!u.pinHash,
  };
}

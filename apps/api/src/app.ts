import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { env } from './env';
import { SESSION_COOKIE } from './lib/auth';
import { HttpError } from './lib/http';
import { aiRoutes } from './routes/ai';
import { authRoutes } from './routes/auth';
import { messageRoutes } from './routes/messages';
import { offerRoutes } from './routes/offers';
import { posRoutes } from './routes/pos';
import { productRoutes } from './routes/products';
import { reportRoutes } from './routes/reports';
import { salesRoutes } from './routes/sales';
import { stockRoutes } from './routes/stock';

export async function buildApp(opts: FastifyServerOptions = {}) {
  // Detrás del proxy de Render (u otro hosting) la IP real viene en X-Forwarded-For: el límite de logins es por cliente.
  const app = Fastify({ logger: !env.isTest, bodyLimit: 5 * 1024 * 1024, trustProxy: env.NODE_ENV === 'production', ...opts });

  await app.register(cookie);
  await app.register(jwt, { secret: env.JWT_SECRET, cookie: { cookieName: SESSION_COOKIE, signed: false } });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, { global: false });
  app.decorateRequest('auth', null as never);
  app.decorateRequest('device', null as never);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'validation', message: err.issues[0]?.message, issues: err.issues });
    }
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message });
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.code ?? 'error', message: e.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'internal' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(
    async (api) => {
      await authRoutes(api);
      await productRoutes(api);
      await stockRoutes(api);
      await posRoutes(api);
      await salesRoutes(api);
      await messageRoutes(api);
      await offerRoutes(api);
      await reportRoutes(api);
      await aiRoutes(api);
    },
    { prefix: '/api' },
  );

  // En producción la API también sirve la web compilada (un solo servicio).
  if (existsSync(join(env.WEB_DIST, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: env.WEB_DIST,
      wildcard: false,
      setHeaders: (res, path) => {
        if (path.endsWith('sw.js') || path.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: 'not_found' });
    });
  }

  return app;
}

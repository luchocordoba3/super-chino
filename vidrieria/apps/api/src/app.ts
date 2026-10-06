import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyRequest, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { prisma } from './db';
import { env } from './env';
import { SESSION_COOKIE } from './lib/auth';
import { HttpError } from './lib/http';
import { adminRoutes } from './routes/admin';
import { assetRoutes } from './routes/assets';
import { cashRoutes } from './routes/cash';
import { authRoutes } from './routes/auth';
import { businessRoutes } from './routes/business';
import { catalogRoutes } from './routes/catalog';
import { customerRoutes } from './routes/customers';
import { invoiceRoutes } from './routes/invoices';
import { jobRoutes } from './routes/jobs';
import { leadRoutes } from './routes/leads';
import { marketingRoutes } from './routes/marketing';
import { numberRoutes } from './routes/numbers';
import { businessByHost, publicRoutes } from './routes/public';
import { publicJobRoutes } from './routes/publicJobs';
import { publicPayRoutes } from './routes/publicPay';
import { purchaseRoutes } from './routes/purchases';
import { pushRoutes } from './routes/push';
import { quoteRoutes } from './routes/quotes';
import { salesRoutes } from './routes/sales';
import { RESERVED_SLUGS, serviceSlug, siteContent } from './services/site';

export async function buildApp(opts: FastifyServerOptions = {}) {
  // Las fotos llegan como texto (base64): hasta 3 por consulta.
  const app = Fastify({ logger: !env.isTest, bodyLimit: 16 * 1024 * 1024, trustProxy: env.NODE_ENV === 'production', ...opts });

  await app.register(cookie);
  await app.register(jwt, { secret: env.JWT_SECRET, cookie: { cookieName: SESSION_COOKIE, signed: false } });
  await app.register(rateLimit, { global: false });
  app.decorateRequest('auth', null as never);

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

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(
    async (api) => {
      await authRoutes(api);
      await businessRoutes(api);
      await catalogRoutes(api);
      await customerRoutes(api);
      await leadRoutes(api);
      await quoteRoutes(api);
      await assetRoutes(api);
      await publicRoutes(api);
      await pushRoutes(api);
      await purchaseRoutes(api);
      await adminRoutes(api);
      await jobRoutes(api);
      await publicJobRoutes(api);
      await publicPayRoutes(api);
      await cashRoutes(api);
      await invoiceRoutes(api);
      await numberRoutes(api);
      await salesRoutes(api);
      await marketingRoutes(api);
    },
    { prefix: '/api' },
  );

  // En producción la API también sirve la web compilada (un solo servicio).
  const indexPath = join(env.WEB_DIST, 'index.html');
  if (existsSync(indexPath)) {
    const indexHtml = readFileSync(indexPath, 'utf8');
    await app.register(fastifyStatic, {
      root: env.WEB_DIST,
      wildcard: false,
      index: false,
      setHeaders: (res, path) => {
        if (path.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        else if (path.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/')) return reply.status(404).send({ error: 'not_found' });
      const html = await withMeta(indexHtml, req);
      return reply.type('text/html').header('Cache-Control', 'no-cache').send(html);
    });
  }

  return app;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Título, descripción y vista previa (WhatsApp, Google) de cada página pública. */
async function withMeta(html: string, req: FastifyRequest) {
  const path = req.url.split('?')[0];
  let title = 'Lumina · Presupuestos para vidrierías';
  let desc = 'Web y presupuestos rápidos para vidrierías.';
  let image: string | null = null;
  let extra = '';
  let noindex = true;
  try {
    const seg = path.split('/').filter(Boolean).map((x) => decodeURIComponent(x));
    // Página de un servicio: /:slug/servicios/:servicio (o /servicios/:servicio con dominio propio).
    const svc = seg.length === 3 && seg[1] === 'servicios' ? { slug: seg[0], service: seg[2] } : seg.length === 2 && seg[0] === 'servicios' ? { slug: null, service: seg[1] } : null;
    const byHost = seg.length === 0 || (svc && !svc.slug) ? await businessByHost(req.hostname) : null;
    if (svc) {
      const b = byHost ?? (svc.slug ? await prisma.business.findUnique({ where: { slug: svc.slug } }) : null);
      const site = b ? siteContent(b) : null;
      const sv = site?.services.find((x) => serviceSlug(x.title) === svc.service);
      if (b && site && sv) {
        title = `${sv.title}${b.zones ? ` en ${b.zones}` : ''} · ${b.name}`;
        desc = sv.text || `${sv.title}. Pedí tu presupuesto a ${b.name}.`;
        image = sv.image ?? site.heroImage ?? null;
        noindex = false;
        if (byHost) extra = `<script>window.__SLUG__=${JSON.stringify(b.slug)}</script>`;
      }
    } else if (byHost || (seg.length === 1 && !RESERVED_SLUGS.has(seg[0]))) {
      const b = byHost ?? (await prisma.business.findUnique({ where: { slug: seg[0] } }));
      if (b) {
        const site = siteContent(b);
        title = `${b.name} · ${site.headline || 'Vidriería'}`;
        desc = site.subheadline || `${b.name}. Pedí tu presupuesto.`;
        image = site.heroImage ?? null;
        noindex = false;
        if (byHost) extra = `<script>window.__SLUG__=${JSON.stringify(b.slug)}</script>`;
      }
    } else if (seg[0] === 'p' && seg[1]) {
      const q = await prisma.quote.findUnique({ where: { publicToken: seg[1] }, include: { business: { select: { name: true } } } });
      if (q) {
        title = `Presupuesto N° ${q.number} · ${q.business.name}`;
        desc = 'Tocá para ver el detalle y aceptarlo.';
      }
    }
  } catch {
    // si falla la base, se sirve la página igual
  }
  const origin = `${req.protocol}://${req.host}`;
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:type" content="website">`,
    image ? `<meta property="og:image" content="${esc(image.startsWith('http') ? image : origin + image)}">` : '',
    noindex ? '<meta name="robots" content="noindex">' : '',
    extra,
  ].join('\n');
  return html.replace(/<title>[^<]*<\/title>/, '').replace('<!--meta-->', tags);
}

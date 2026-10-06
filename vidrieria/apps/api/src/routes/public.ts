import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { JOB_KINDS, leadPublicSchema } from '@vidrieria/shared';
import { prisma } from '../db';
import { env } from '../env';
import { HttpError, badRequest, notFound } from '../lib/http';
import { expireIfNeeded, publicQuote } from '../services/quotes';
import { publicBusiness, siteContent } from '../services/site';
import { decodeDataUrl } from './assets';

/** Vidriería por dominio propio (con o sin www). */
export async function businessByHost(host: string | undefined) {
  if (!host) return null;
  const h = host.toLowerCase().split(':')[0].replace(/^www\./, '');
  return prisma.business.findFirst({ where: { OR: [{ customDomain: h }, { customDomain: `www.${h}` }] } });
}

export async function publicRoutes(app: FastifyInstance) {
  app.get('/public/site/:slug', async (req) => {
    const { slug } = req.params as { slug: string };
    const b = await prisma.business.findUnique({ where: { slug } });
    if (!b) throw notFound();
    return { business: publicBusiness(b), jobKinds: JOB_KINDS };
  });

  app.get('/public/host', async (req) => {
    const b = await businessByHost(req.hostname);
    if (!b) throw notFound();
    return { slug: b.slug };
  });

  app.post(
    '/public/site/:slug/leads',
    { config: { rateLimit: { max: env.LEAD_RATE_LIMIT, timeWindow: '1 hour' } } },
    async (req) => {
      const { slug } = req.params as { slug: string };
      const b = await prisma.business.findUnique({ where: { slug } });
      if (!b) throw notFound();
      const body = leadPublicSchema.extend({ photos: z.array(z.string().max(5 * 1024 * 1024)).max(3).default([]) }).parse(req.body);
      if (body.website) throw badRequest('spam');
      const photos = body.photos.map(decodeDataUrl);
      const lead = await prisma.$transaction(async (tx) => {
        const ids: string[] = [];
        for (const p of photos) {
          const a = await tx.asset.create({ data: { businessId: b.id, mime: p.mime, data: p.data, size: p.data.length, kind: 'lead', public: false } });
          ids.push(a.id);
        }
        return tx.lead.create({
          data: {
            businessId: b.id,
            kind: body.kind,
            widthCm: body.widthCm ?? null,
            heightCm: body.heightCm ?? null,
            quantity: body.quantity ?? null,
            details: body.details,
            zone: body.zone,
            name: body.name,
            phone: body.phone,
            when: body.when,
            photoIds: ids,
          },
        });
      });
      return { ok: true, id: lead.id };
    },
  );

  app.get('/public/quotes/:token', async (req) => {
    const { token } = req.params as { token: string };
    const { preview } = req.query as { preview?: string };
    let q = await prisma.quote.findUnique({ where: { publicToken: token }, include: { customer: { select: { name: true } }, business: true } });
    if (!q) throw notFound();
    q = await expireIfNeeded(q);
    if (q.status === 'SENT' && preview !== '1') {
      q = { ...q, ...(await prisma.quote.update({ where: { id: q.id }, data: { status: 'VIEWED', viewedAt: new Date() } })) };
    }
    const b = q.business;
    const site = siteContent(b);
    return {
      quote: publicQuote(q, b),
      business: {
        name: b.name,
        slug: b.slug,
        whatsapp: b.whatsapp,
        address: b.address,
        email: b.email,
        logo: b.logoAssetId ? `/api/assets/${b.logoAssetId}` : null,
        primaryColor: site.primaryColor,
        accentColor: site.accentColor,
      },
    };
  });

  app.post('/public/quotes/:token/accept', async (req) => {
    const { token } = req.params as { token: string };
    let q = await prisma.quote.findUnique({ where: { publicToken: token } });
    if (!q) throw notFound();
    q = await expireIfNeeded(q);
    if (q.status === 'ACCEPTED') return { ok: true };
    if (q.status === 'EXPIRED') throw new HttpError(409, 'quote_expired', 'El presupuesto venció. Pedí uno actualizado.');
    if (q.status === 'REJECTED') throw new HttpError(409, 'quote_rejected', 'Este presupuesto ya no está disponible.');
    await prisma.quote.update({ where: { id: q.id }, data: { status: 'ACCEPTED', acceptedAt: new Date(), sentAt: q.sentAt ?? new Date() } });
    return { ok: true };
  });
}

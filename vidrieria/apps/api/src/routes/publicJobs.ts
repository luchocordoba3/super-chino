import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pieceWeightKg, type QuoteResult } from '@vidrieria/shared';
import { prisma } from '../db';
import { notFound } from '../lib/http';
import { notifyLater } from '../services/push';
import { setJobStatus } from '../services/jobs';
import { siteContent } from '../services/site';
import { decodeDataUrl } from './assets';

/** Piezas del trabajo con su vidrio y su peso (para la ficha del colocador y la garantía). */
function pieces(r: QuoteResult) {
  return r.items.map((i) => {
    const glass = i.lines.find((l) => l.applyWaste)?.name ?? null;
    return {
      title: i.title,
      widthMm: i.widthMm,
      heightMm: i.heightMm,
      quantity: i.quantity,
      glass,
      weightKg: glass ? pieceWeightKg(glass, i.widthMm, i.heightMm) : null,
      includes: i.lines.filter((l) => !l.applyWaste).map((l) => l.name),
    };
  });
}

const byCrewToken = (token: string) =>
  prisma.job.findUnique({ where: { crewToken: token }, include: { business: true, crew: true, quote: { include: { customer: true } } } });

export async function publicJobRoutes(app: FastifyInstance) {
  /** Ficha del colocador: se abre sin usuario, con el link que le manda el dueño. */
  app.get('/public/jobs/:token', async (req) => {
    const { token } = req.params as { token: string };
    const j = await byCrewToken(token);
    if (!j) throw notFound();
    const r = j.quote.result as unknown as QuoteResult;
    return {
      business: { name: j.business.name, whatsapp: j.business.whatsapp, primaryColor: siteContent(j.business).primaryColor },
      status: j.status,
      number: j.quote.number,
      title: j.quote.title,
      notes: j.quote.notes,
      installNotes: j.installNotes,
      address: j.address || j.quote.customer?.address || '',
      scheduledAt: j.scheduledAt,
      crew: j.crew?.name ?? null,
      customer: j.quote.customer ? { name: j.quote.customer.name, phone: j.quote.customer.phone } : null,
      pieces: pieces(r),
      extras: r.extras.map((l) => l.name),
      checklist: j.checklist,
      arrivedAt: j.arrivedAt,
      installedAt: j.installedAt,
      photos: { before: j.beforeIds.length, after: j.afterIds.length },
      warrantyToken: j.warrantyToken,
    };
  });

  app.post('/public/jobs/:token/arrived', async (req) => {
    const { token } = req.params as { token: string };
    const j = await byCrewToken(token);
    if (!j) throw notFound();
    if (!j.arrivedAt) await prisma.job.update({ where: { id: j.id }, data: { arrivedAt: new Date() } });
    return { ok: true };
  });

  app.post(
    '/public/jobs/:token/photos',
    { config: { rateLimit: { max: 40, timeWindow: '1 hour' } } },
    async (req) => {
      const { token } = req.params as { token: string };
      const body = z.object({ kind: z.enum(['before', 'after']), photos: z.array(z.string().max(5 * 1024 * 1024)).min(1).max(4) }).parse(req.body);
      const j = await byCrewToken(token);
      if (!j) throw notFound();
      const ids: string[] = [];
      for (const p of body.photos) {
        const { mime, data } = decodeDataUrl(p);
        ids.push((await prisma.asset.create({ data: { businessId: j.businessId, mime, data, size: data.length, kind: 'job', public: false } })).id);
      }
      await prisma.job.update({ where: { id: j.id }, data: body.kind === 'before' ? { beforeIds: { push: ids } } : { afterIds: { push: ids } } });
      return { ok: true, count: ids.length };
    },
  );

  app.post('/public/jobs/:token/done', async (req) => {
    const { token } = req.params as { token: string };
    const { checklist } = z.object({ checklist: z.record(z.string(), z.boolean()).default({}) }).parse(req.body ?? {});
    const j = await byCrewToken(token);
    if (!j) throw notFound();
    await prisma.job.update({ where: { id: j.id }, data: { checklist } });
    if (j.status !== 'INSTALLED' && j.status !== 'CLOSED') {
      await setJobStatus(j.id, 'INSTALLED');
      notifyLater(j.businessId, {
        title: `${j.crew?.name ?? 'El equipo'} terminó el N° ${j.quote.number}`,
        body: `${j.quote.customer?.name ?? 'Cliente'}${j.quote.title ? ` · ${j.quote.title}` : ''}. Pedile la reseña hoy.`,
        url: `/panel/trabajos?ver=${j.id}`,
      });
    }
    return { ok: true };
  });

  /** Garantía: la abre el cliente con el QR pegado en el trabajo. */
  app.get('/public/warranty/:token', async (req) => {
    const { token } = req.params as { token: string };
    const j = await prisma.job.findUnique({ where: { warrantyToken: token }, include: { business: true, crew: true, quote: { include: { customer: true } } } });
    if (!j) throw notFound();
    const site = siteContent(j.business);
    const until = j.installedAt ? new Date(j.installedAt.getTime()) : null;
    if (until) until.setMonth(until.getMonth() + j.warrantyMonths);
    return {
      business: {
        name: j.business.name,
        slug: j.business.slug,
        whatsapp: j.business.whatsapp,
        logo: j.business.logoAssetId ? `/api/assets/${j.business.logoAssetId}` : null,
        primaryColor: site.primaryColor,
        accentColor: site.accentColor,
        reviewUrl: j.business.reviewUrl,
      },
      number: j.quote.number,
      title: j.quote.title,
      customer: j.quote.customer?.name.split(' ')[0] ?? null,
      installedAt: j.installedAt,
      warrantyMonths: j.warrantyMonths,
      until,
      crew: j.crew?.name ?? null,
      pieces: pieces(j.quote.result as unknown as QuoteResult).map(({ weightKg: _w, ...p }) => p),
    };
  });
}

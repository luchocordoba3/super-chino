import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PLAN_INFO, type QuoteResult } from '@vidrieria/shared';
import { prisma } from '../db';
import { guard } from '../lib/auth';
import { HttpError, badRequest, notFound } from '../lib/http';
import { generateRender, renderPrompt, renderQuota } from '../services/render';
import { decodeDataUrl } from './assets';

const glassSchema = z.object({
  place: z.string().trim().max(120).default(''),
  widthMm: z.number().int().min(10).max(10_000),
  heightMm: z.number().int().min(10).max(10_000),
  glass: z.string().trim().max(120).default(''),
  notes: z.string().trim().max(300).default(''),
});

export async function salesRoutes(app: FastifyInstance) {
  // Formato para la aseguradora: datos del siniestro.
  app.put('/quotes/:id/insurance', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        company: z.string().trim().max(120).default(''),
        policy: z.string().trim().max(60).default(''),
        claim: z.string().trim().max(60).default(''),
        incidentDate: z.string().trim().max(20).default(''),
        description: z.string().trim().max(1000).default(''),
      })
      .nullable()
      .parse(req.body);
    const r = await prisma.quote.updateMany({ where: { id, businessId: req.auth.bid }, data: { insurance: body ?? Prisma.DbNull } });
    if (!r.count) throw notFound();
    return { ok: true };
  });

  // Foto "así quedaría"
  app.get('/render/status', guard(), async (req) => renderQuota(req.auth.bid, req.auth.plan));

  app.post('/quotes/:id/render', guard('render'), async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ photo: z.string().max(8 * 1024 * 1024), item: z.number().int().min(0).default(0), extra: z.string().trim().max(300).default('') }).parse(req.body);
    const q = await prisma.quote.findFirst({ where: { id, businessId: req.auth.bid } });
    if (!q) throw notFound();
    const status = await renderQuota(req.auth.bid, req.auth.plan);
    if (status.used >= status.quota) throw new HttpError(429, 'render_quota', `Ya usaste las ${status.quota} fotos de este mes del plan ${PLAN_INFO[req.auth.plan].name}`);
    const r = q.result as unknown as QuoteResult;
    const item = r.items[body.item];
    if (!item) throw badRequest('bad_item', 'Ese trabajo no existe en el presupuesto');
    const photo = decodeDataUrl(body.photo);
    const prompt = renderPrompt(item, body.extra);
    const source = await prisma.asset.create({ data: { businessId: req.auth.bid, mime: photo.mime, data: photo.data, size: photo.data.length, kind: 'render-source', public: false } });
    const out = await generateRender(photo, prompt);
    const asset = await prisma.asset.create({ data: { businessId: req.auth.bid, mime: out.mime, data: out.data, size: out.data.length, kind: 'render', public: true } });
    const url = `/api/assets/${asset.id}`;
    await prisma.$transaction([
      prisma.render.create({ data: { businessId: req.auth.bid, quoteId: q.id, sourceUrl: `/api/assets/${source.id}`, resultUrl: url, prompt } }),
      prisma.quote.update({ where: { id: q.id }, data: { renderUrls: { push: url } } }),
    ]);
    return { url };
  });

  app.delete('/quotes/:id/render', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const { url } = z.object({ url: z.string() }).parse(req.body);
    const q = await prisma.quote.findFirst({ where: { id, businessId: req.auth.bid } });
    if (!q) throw notFound();
    await prisma.quote.update({ where: { id }, data: { renderUrls: q.renderUrls.filter((u) => u !== url) } });
    return { ok: true };
  });

  // Edificios de consorcios (y obras de constructoras) con sus vidrios cargados
  app.get('/buildings', guard(), async (req) => {
    const { customerId } = req.query as { customerId?: string };
    return prisma.building.findMany({ where: { businessId: req.auth.bid, ...(customerId ? { customerId } : {}) }, orderBy: { name: 'asc' } });
  });
  const buildingSchema = z.object({
    customerId: z.string().nullish(),
    name: z.string().trim().min(1).max(120),
    address: z.string().trim().max(200).default(''),
    glasses: z.array(glassSchema).max(500).default([]),
    notes: z.string().trim().max(1000).default(''),
  });
  app.post('/buildings', guard(), async (req) => {
    const body = buildingSchema.parse(req.body);
    if (body.customerId && !(await prisma.customer.findFirst({ where: { id: body.customerId, businessId: req.auth.bid } }))) throw badRequest('customer_not_found');
    return prisma.building.create({ data: { ...body, customerId: body.customerId ?? null, businessId: req.auth.bid } });
  });
  app.patch('/buildings/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const body = buildingSchema.partial().parse(req.body);
    const r = await prisma.building.updateMany({ where: { id, businessId: req.auth.bid }, data: body });
    if (!r.count) throw notFound();
    return prisma.building.findUniqueOrThrow({ where: { id } });
  });
  app.delete('/buildings/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    await prisma.building.deleteMany({ where: { id, businessId: req.auth.bid } });
    return { ok: true };
  });
}

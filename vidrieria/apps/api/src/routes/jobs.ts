import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { guard } from '../lib/auth';
import { badRequest, notFound } from '../lib/http';
import { JOB_ORDER, setJobStatus } from '../services/jobs';
import { decodeDataUrl } from './assets';

const jobInclude = {
  crew: { select: { id: true, name: true, color: true } },
  quote: {
    select: {
      id: true,
      number: true,
      title: true,
      total: true,
      deposit: true,
      depositPaidAt: true,
      publicToken: true,
      acceptedAt: true,
      customer: { select: { id: true, name: true, phone: true, address: true } },
    },
  },
} as const;

const breakSchema = z.object({
  jobId: z.string().nullish(),
  where: z.enum(['TALLER', 'TRASLADO', 'OBRA', 'POSTVENTA']),
  description: z.string().trim().max(500).default(''),
  cost: z.number().finite().min(0).max(1e10).default(0),
  responsible: z.string().trim().max(120).default(''),
  reordered: z.boolean().default(false),
});

export async function jobRoutes(app: FastifyInstance) {
  const own = async (bid: string, id: string) => {
    const j = await prisma.job.findFirst({ where: { id, businessId: bid } });
    if (!j) throw notFound();
    return j;
  };

  app.get('/jobs', guard('jobs'), async (req) => {
    const { from, to, open } = req.query as { from?: string; to?: string; open?: string };
    return prisma.job.findMany({
      where: {
        businessId: req.auth.bid,
        ...(open === '1' ? { status: { not: 'CLOSED' } } : {}),
        ...(from && to ? { scheduledAt: { gte: new Date(from), lt: new Date(to) } } : {}),
      },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
      include: jobInclude,
      take: 300,
    });
  });

  app.get('/jobs/:id', guard('jobs'), async (req) => {
    const { id } = req.params as { id: string };
    const j = await prisma.job.findFirst({
      where: { id, businessId: req.auth.bid },
      include: { ...jobInclude, quote: { include: { customer: true } }, breakages: { orderBy: { createdAt: 'desc' } }, workDays: true },
    });
    if (!j) throw notFound();
    return j;
  });

  app.patch('/jobs/:id', guard('jobs'), async (req) => {
    const { id } = req.params as { id: string };
    const j = await own(req.auth.bid, id);
    const body = z
      .object({
        scheduledAt: z.string().datetime({ offset: true }).nullable(),
        crewId: z.string().nullable(),
        address: z.string().trim().max(300),
        installNotes: z.string().trim().max(2000),
        warrantyMonths: z.number().int().min(0).max(240),
        promisedAt: z.string().datetime({ offset: true }).nullable(),
        checklist: z.record(z.string(), z.boolean()),
      })
      .partial()
      .parse(req.body);
    if (body.crewId && !(await prisma.crew.findFirst({ where: { id: body.crewId, businessId: req.auth.bid } }))) throw badRequest('crew_not_found');
    const scheduled = body.scheduledAt ? new Date(body.scheduledAt) : body.scheduledAt;
    // Agendar lo pasa a "agendado" si todavía no estaba más adelante.
    const promote = scheduled && JOB_ORDER.indexOf(j.status) < JOB_ORDER.indexOf('SCHEDULED');
    return prisma.job.update({
      where: { id },
      data: {
        ...body,
        scheduledAt: scheduled,
        promisedAt: body.promisedAt ? new Date(body.promisedAt) : body.promisedAt,
        ...(promote ? { status: 'SCHEDULED' as const } : {}),
      },
      include: jobInclude,
    });
  });

  app.post('/jobs/:id/status', guard('jobs'), async (req) => {
    const { id } = req.params as { id: string };
    await own(req.auth.bid, id);
    const { status } = z.object({ status: z.enum(['PENDING', 'ORDERED', 'MAKING', 'RECEIVED', 'SCHEDULED', 'INSTALLED', 'CLOSED']) }).parse(req.body);
    await setJobStatus(id, status);
    return prisma.job.findUniqueOrThrow({ where: { id }, include: jobInclude });
  });

  /** Marca un mensaje de WhatsApp como mandado (turno, reseña, controles). */
  app.post('/jobs/:id/sent', guard('jobs'), async (req) => {
    const { id } = req.params as { id: string };
    await own(req.auth.bid, id);
    const { kind } = z.object({ kind: z.enum(['confirm', 'review', 'check30', 'maint6', 'maint12']) }).parse(req.body);
    const field = { confirm: 'confirmSentAt', review: 'reviewSentAt', check30: 'check30SentAt', maint6: 'maint6SentAt', maint12: 'maint12SentAt' }[kind];
    await prisma.job.update({ where: { id }, data: { [field]: new Date() } });
    return { ok: true };
  });

  // Equipos de colocación
  app.get('/crews', guard(), async (req) => prisma.crew.findMany({ where: { businessId: req.auth.bid }, orderBy: { createdAt: 'asc' } }));

  const crewSchema = z.object({
    name: z.string().trim().min(1).max(80),
    members: z.string().trim().max(300).default(''),
    dayRate: z.number().finite().min(0).max(1e9).default(0),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#1d4ed8'),
    active: z.boolean().default(true),
  });
  app.post('/crews', guard('owner', 'jobs'), async (req) => prisma.crew.create({ data: { ...crewSchema.parse(req.body), businessId: req.auth.bid } }));
  app.patch('/crews/:id', guard('owner', 'jobs'), async (req) => {
    const { id } = req.params as { id: string };
    const r = await prisma.crew.updateMany({ where: { id, businessId: req.auth.bid }, data: crewSchema.partial().parse(req.body) });
    if (!r.count) throw notFound();
    return prisma.crew.findUniqueOrThrow({ where: { id } });
  });

  // Roturas
  app.get('/breakages', guard('jobs'), async (req) =>
    prisma.breakage.findMany({
      where: { businessId: req.auth.bid },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { job: { select: { id: true, quote: { select: { number: true, title: true } } } } },
    }),
  );
  app.post('/breakages', guard('jobs'), async (req) => {
    const body = breakSchema.parse(req.body);
    if (body.jobId) await own(req.auth.bid, body.jobId);
    return prisma.breakage.create({ data: { ...body, jobId: body.jobId ?? null, businessId: req.auth.bid } });
  });
  app.delete('/breakages/:id', guard('jobs'), async (req) => {
    const { id } = req.params as { id: string };
    await prisma.breakage.deleteMany({ where: { id, businessId: req.auth.bid } });
    return { ok: true };
  });

  // Retazos
  app.get('/remnants', guard(), async (req) => {
    const { all } = req.query as { all?: string };
    return prisma.remnant.findMany({ where: { businessId: req.auth.bid, ...(all === '1' ? {} : { usedAt: null }) }, orderBy: { createdAt: 'desc' } });
  });
  app.post('/remnants', guard('materials'), async (req) => {
    const body = z
      .object({
        catalogItemId: z.string().nullish(),
        glassName: z.string().trim().min(1).max(120),
        thicknessMm: z.number().finite().min(0).max(100).nullish(),
        widthMm: z.number().int().min(10).max(10_000),
        heightMm: z.number().int().min(10).max(10_000),
        notes: z.string().trim().max(300).default(''),
        photo: z.string().max(5 * 1024 * 1024).nullish(),
      })
      .parse(req.body);
    let photoId: string | null = null;
    if (body.photo) {
      const { mime, data } = decodeDataUrl(body.photo);
      photoId = (await prisma.asset.create({ data: { businessId: req.auth.bid, mime, data, size: data.length, kind: 'remnant', public: false } })).id;
    }
    const { photo: _p, ...rest } = body;
    return prisma.remnant.create({ data: { ...rest, catalogItemId: rest.catalogItemId ?? null, thicknessMm: rest.thicknessMm ?? null, photoId, businessId: req.auth.bid } });
  });
  app.post('/remnants/:id/use', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const { quoteId, undo } = z.object({ quoteId: z.string().nullish(), undo: z.boolean().default(false) }).parse(req.body ?? {});
    const r = await prisma.remnant.updateMany({
      where: { id, businessId: req.auth.bid },
      data: undo ? { usedAt: null, usedQuoteId: null } : { usedAt: new Date(), usedQuoteId: quoteId ?? null },
    });
    if (!r.count) throw notFound();
    return { ok: true };
  });
  app.delete('/remnants/:id', guard('materials'), async (req) => {
    const { id } = req.params as { id: string };
    await prisma.remnant.deleteMany({ where: { id, businessId: req.auth.bid } });
    return { ok: true };
  });

  // Stock
  app.get('/stock', guard('materials'), async (req) =>
    prisma.catalogItem.findMany({
      where: { businessId: req.auth.bid, active: true, category: { in: ['HERRAJE', 'PERFIL', 'OTRO'] } },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
  );
  app.patch('/stock/:id', guard('materials'), async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ stockQty: z.number().finite().min(-1e6).max(1e9).nullable(), stockMin: z.number().finite().min(0).max(1e9).nullable() }).partial().parse(req.body);
    const r = await prisma.catalogItem.updateMany({ where: { id, businessId: req.auth.bid }, data: body });
    if (!r.count) throw notFound();
    return prisma.catalogItem.findUniqueOrThrow({ where: { id } });
  });
}

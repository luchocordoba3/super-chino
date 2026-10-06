import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { QuoteResult } from '@vidrieria/shared';
import { prisma } from '../db';
import { guard } from '../lib/auth';
import { notFound } from '../lib/http';
import { siteContent, stormOn } from '../services/site';

const DAY = 86_400_000;
const code = () => Math.random().toString(36).slice(2, 8);

/** Barrio del cliente a partir de la dirección ("Mitre 123, Villa Ballester" -> "Villa Ballester"). */
const zoneOf = (address: string) => {
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
};

export async function marketingRoutes(app: FastifyInstance) {
  /** Todo lo de marketing en una sola llamada. */
  app.get('/marketing', guard('marketing'), async (req) => {
    const bid = req.auth.bid;
    const since = new Date(Date.now() - 90 * DAY);
    const [b, signs, signLeads, referrers, refLeads, leadSources, customers, jobs] = await Promise.all([
      prisma.business.findUniqueOrThrow({ where: { id: bid } }),
      prisma.sign.findMany({ where: { businessId: bid }, orderBy: { createdAt: 'desc' } }),
      prisma.lead.groupBy({ by: ['signId'], where: { businessId: bid, signId: { not: null } }, _count: true }),
      prisma.customer.findMany({ where: { businessId: bid, referralCode: { not: null } }, select: { id: true, name: true, phone: true, referralCode: true } }),
      prisma.lead.groupBy({ by: ['refCode'], where: { businessId: bid, refCode: { not: null } }, _count: true }),
      prisma.lead.groupBy({ by: ['source'], where: { businessId: bid, createdAt: { gte: since } }, _count: true }),
      prisma.customer.findMany({ where: { businessId: bid, phone: { not: '' } }, select: { id: true, name: true, phone: true, address: true } }),
      prisma.job.findMany({
        where: { businessId: bid, status: { in: ['INSTALLED', 'CLOSED'] }, afterIds: { isEmpty: false } },
        orderBy: { installedAt: 'desc' },
        take: 8,
        include: { quote: { select: { number: true, title: true, result: true, customer: { select: { name: true, address: true } } } } },
      }),
    ]);
    const signCount = new Map(signLeads.map((s) => [s.signId, s._count]));
    const refCount = new Map(refLeads.map((r) => [r.refCode, r._count]));
    const published = new Set(siteContent(b).gallery.map((g) => g.image));
    // Clientes agrupados por barrio, para avisarles después de una tormenta.
    const zones = new Map<string, typeof customers>();
    for (const c of customers) {
      const z = zoneOf(c.address) || 'Sin barrio';
      zones.set(z, [...(zones.get(z) ?? []), c]);
    }
    return {
      reviewUrl: b.reviewUrl,
      referralBenefit: b.referralBenefit,
      storm: { on: stormOn(b), until: b.stormUntil },
      sources: leadSources.map((s) => ({ source: s.source, count: s._count })).sort((a, z) => z.count - a.count),
      signs: signs.map((s) => ({ ...s, leads: signCount.get(s.id) ?? 0 })),
      referrals: referrers.map((r) => ({ ...r, leads: refCount.get(r.referralCode) ?? 0 })).sort((a, z) => z.leads - a.leads),
      zones: [...zones.entries()].map(([zone, list]) => ({ zone, customers: list })).sort((a, z) => z.customers.length - a.customers.length),
      beforeAfter: jobs.map((j) => {
        const r = j.quote.result as unknown as QuoteResult;
        const it = r.items[0];
        return {
          id: j.id,
          number: j.quote.number,
          title: j.quote.title || it?.title || 'Trabajo',
          kind: it?.title ?? '',
          glass: it?.lines.find((l) => l.applyWaste)?.name ?? '',
          size: it ? `${Math.round(it.widthMm / 10)} × ${Math.round(it.heightMm / 10)} cm` : '',
          zone: zoneOf(j.address || j.quote.customer?.address || ''),
          photos: [...j.beforeIds, ...j.afterIds].map((id) => ({ id, after: j.afterIds.includes(id), published: published.has(`/api/assets/${id}`) })),
        };
      }),
    };
  });

  app.post('/signs', guard('marketing'), async (req) => {
    const body = z.object({ name: z.string().trim().min(1).max(120), address: z.string().trim().max(200).default('') }).parse(req.body);
    for (;;) {
      try {
        return await prisma.sign.create({ data: { ...body, code: code(), businessId: req.auth.bid } });
      } catch {
        // código repetido: probar otro
      }
    }
  });
  app.delete('/signs/:id', guard('marketing'), async (req) => {
    const { id } = req.params as { id: string };
    await prisma.sign.deleteMany({ where: { id, businessId: req.auth.bid } });
    return { ok: true };
  });

  /** Modo tormenta: cartel de urgencias en la web por 48 horas. */
  app.post('/storm', guard('marketing'), async (req) => {
    const { on } = z.object({ on: z.boolean() }).parse(req.body);
    const b = await prisma.business.update({
      where: { id: req.auth.bid },
      data: { stormMode: on, stormUntil: on ? new Date(Date.now() + 2 * DAY) : null },
    });
    return { on: stormOn(b), until: b.stormUntil };
  });

  /** Suma una foto de la obra a "Trabajos hechos" de la web (con su tipo y barrio). */
  app.post('/jobs/:id/publish', guard('marketing'), async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ photoId: z.string(), caption: z.string().trim().max(140).default(''), kind: z.string().trim().max(80).default(''), zone: z.string().trim().max(80).default('') }).parse(req.body);
    const j = await prisma.job.findFirst({ where: { id, businessId: req.auth.bid } });
    if (!j || ![...j.beforeIds, ...j.afterIds].includes(body.photoId)) throw notFound();
    await prisma.asset.update({ where: { id: body.photoId }, data: { public: true, kind: 'site' } });
    const b = await prisma.business.findUniqueOrThrow({ where: { id: req.auth.bid } });
    const site = siteContent(b);
    const image = `/api/assets/${body.photoId}`;
    if (!site.gallery.some((g) => g.image === image)) site.gallery = [{ image, caption: body.caption, kind: body.kind, zone: body.zone }, ...site.gallery].slice(0, 60);
    await prisma.business.update({ where: { id: b.id }, data: { site } });
    return { ok: true };
  });

  /**
   * "Para mandar hoy": reseñas, controles de garantía, mantenimiento, turnos de mañana,
   * material por pedir, atrasos y stock bajo. Cada cosa con su mensaje listo en el panel.
   */
  app.get('/today', guard(), async (req) => {
    const bid = req.auth.bid;
    const now = Date.now();
    const daysAgo = (d: number) => new Date(now - d * DAY);
    const tomorrow0 = new Date();
    tomorrow0.setHours(0, 0, 0, 0);
    tomorrow0.setDate(tomorrow0.getDate() + 1);
    const tomorrow1 = new Date(tomorrow0.getTime() + DAY);
    const sel = { id: true, address: true, installedAt: true, scheduledAt: true, promisedAt: true, warrantyToken: true, crewToken: true, quote: { select: { id: true, number: true, title: true, customer: { select: { name: true, phone: true } } } } } as const;
    const [b, reviews, check30, maint6, maint12, tomorrow, late, toOrder, stock] = await Promise.all([
      prisma.business.findUniqueOrThrow({ where: { id: bid }, select: { reviewUrl: true, plan: true } }),
      prisma.job.findMany({ where: { businessId: bid, installedAt: { gte: daysAgo(10) }, reviewSentAt: null }, select: sel }),
      prisma.job.findMany({ where: { businessId: bid, installedAt: { lte: daysAgo(30), gte: daysAgo(45) }, check30SentAt: null }, select: sel }),
      prisma.job.findMany({ where: { businessId: bid, installedAt: { lte: daysAgo(180), gte: daysAgo(200) }, maint6SentAt: null }, select: sel }),
      prisma.job.findMany({ where: { businessId: bid, installedAt: { lte: daysAgo(365), gte: daysAgo(385) }, maint12SentAt: null }, select: sel }),
      prisma.job.findMany({ where: { businessId: bid, scheduledAt: { gte: tomorrow0, lt: tomorrow1 } }, select: { ...sel, confirmSentAt: true, crew: { select: { name: true } } } }),
      prisma.job.findMany({ where: { businessId: bid, status: { in: ['ORDERED', 'MAKING'] }, promisedAt: { lt: new Date() } }, select: sel }),
      prisma.job.findMany({ where: { businessId: bid, status: 'PENDING', quote: { depositPaidAt: { not: null } } }, select: sel }),
      prisma.catalogItem.findMany({ where: { businessId: bid, active: true, stockQty: { not: null }, stockMin: { not: null } }, select: { id: true, name: true, stockQty: true, stockMin: true } }),
    ]);
    return {
      reviewUrl: b.reviewUrl,
      reviews,
      check30,
      maint: [...maint6.map((j) => ({ ...j, kind: 'maint6' as const })), ...maint12.map((j) => ({ ...j, kind: 'maint12' as const }))],
      tomorrow,
      late,
      toOrder,
      lowStock: stock.filter((c) => Number(c.stockQty) <= Number(c.stockMin)),
    };
  });
}

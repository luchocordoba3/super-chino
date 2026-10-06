import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { JOB_KINDS, hasFeature, leadPublicSchema, safetyIssues, type QuoteInput } from '@vidrieria/shared';
import { prisma } from '../db';
import { env } from '../env';
import type { FastifyRequest } from 'fastify';
import { authenticate } from '../lib/auth';
import { HttpError, badRequest, notFound } from '../lib/http';
import { money } from '../lib/text';
import { ensureJob } from '../services/jobs';
import { notifyLater } from '../services/push';
import { acceptData, expireIfNeeded, insuranceDetail, publicQuote, storedOptions } from '../services/quotes';
import { publicBusiness, siteContent, similarWork } from '../services/site';
import { RECEIPT_MIMES, decodeDataUrl } from './assets';

/** Una vista cuenta si pasaron 30 minutos de la anterior (recargar o volver a la pestaña no suma). */
const VIEW_GAP = 30 * 60_000;

/** ¿Lo está mirando alguien de la vidriería con la sesión abierta? Entonces no cuenta como vista del cliente. */
async function isStaff(req: FastifyRequest, businessId: string) {
  try {
    await authenticate(req);
    return req.auth.bid === businessId;
  } catch {
    return false;
  }
}

const who = (q: { customer: { name: string } | null }) => q.customer?.name ?? 'El cliente';

/** Vidriería por dominio propio (con o sin www). */
export async function businessByHost(host: string | undefined) {
  if (!host) return null;
  const h = host.toLowerCase().split(':')[0].replace(/^www\./, '');
  return prisma.business.findFirst({ where: { OR: [{ customDomain: h }, { customDomain: `www.${h}` }] } });
}

export async function publicRoutes(app: FastifyInstance) {
  app.get('/public/site/:slug', async (req) => {
    const { slug } = req.params as { slug: string };
    const { ref } = req.query as { ref?: string };
    const b = await prisma.business.findUnique({ where: { slug } });
    if (!b) throw notFound();
    // Llegó con el link de recomendación de un cliente: se muestra quién lo recomendó y el beneficio.
    const referrer = ref ? await prisma.customer.findFirst({ where: { businessId: b.id, referralCode: ref }, select: { name: true } }) : null;
    return {
      business: publicBusiness(b),
      jobKinds: JOB_KINDS,
      referral: referrer ? { by: referrer.name.split(' ')[0], benefit: b.referralBenefit } : null,
    };
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
      const photos = body.photos.map((p) => decodeDataUrl(p));
      // De dónde vino: cartel con QR, link de recomendación o el sitio que lo trajo.
      const sign = body.sign ? await prisma.sign.findFirst({ where: { code: body.sign, businessId: b.id } }) : null;
      const referrer = body.ref ? await prisma.customer.findFirst({ where: { referralCode: body.ref, businessId: b.id } }) : null;
      const ref = (body.referrer ?? '').toLowerCase();
      const source = sign ? 'CARTEL' : referrer ? 'RECOMENDACION' : /google\./.test(ref) ? 'GOOGLE' : /instagram|facebook|fb\.|l\.instagram/.test(ref) ? 'INSTAGRAM' : 'WEB';
      const urgent = /urgent|hoy|ya mismo/i.test(body.when) || /roto|rotura|urgenc/i.test(`${body.kind} ${body.details}`);
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
            source,
            urgent,
            refCode: referrer?.referralCode ?? null,
            signId: sign?.id ?? null,
          },
        });
      });
      notifyLater(b.id, {
        title: urgent ? 'Consulta URGENTE desde tu web' : referrer ? `Consulta recomendada por ${referrer.name}` : 'Consulta nueva desde tu web',
        body: `${body.kind} · ${body.name}${body.zone ? ` · ${body.zone}` : ''}`,
        url: '/panel/consultas',
      });
      return { ok: true, id: lead.id };
    },
  );

  /** Alguien escaneó el QR de un cartel de obra. */
  app.post('/public/site/:slug/signs/:code/visit', { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req) => {
    const { slug, code } = req.params as { slug: string; code: string };
    const b = await prisma.business.findUnique({ where: { slug } });
    if (b) await prisma.sign.updateMany({ where: { code, businessId: b.id }, data: { visits: { increment: 1 } } });
    return { ok: true };
  });

  app.get('/public/quotes/:token', async (req) => {
    const { token } = req.params as { token: string };
    const { preview } = req.query as { preview?: string };
    let q = await prisma.quote.findUnique({ where: { publicToken: token }, include: { customer: { select: { name: true } }, business: true } });
    if (!q) throw notFound();
    q = await expireIfNeeded(q);
    const now = new Date();
    const counts = preview !== '1' && (!q.lastViewedAt || now.getTime() - q.lastViewedAt.getTime() > VIEW_GAP) && !(await isStaff(req, q.businessId));
    if (counts) {
      const updated = await prisma.quote.update({
        where: { id: q.id },
        data: { viewCount: { increment: 1 }, lastViewedAt: now, ...(q.status === 'SENT' ? { status: 'VIEWED', viewedAt: now } : {}) },
      });
      q = { ...q, ...updated };
      if (q.status === 'VIEWED' || q.status === 'SENT' || q.status === 'DRAFT') {
        const again = updated.viewCount > 1 ? ` (${updated.viewCount}ª vez)` : '';
        notifyLater(q.businessId, {
          title: `${who(q)} está mirando tu presupuesto`,
          body: `N° ${q.number}${q.title ? ` · ${q.title}` : ''}${again}. Buen momento para escribirle.`,
          url: `/panel/presupuestos/${q.id}`,
        });
      }
    }
    const b = q.business;
    const site = siteContent(b);
    const firstTitle = (q.result as unknown as { items: { title: string }[] }).items[0]?.title ?? q.title;
    return {
      quote: publicQuote(q, b),
      similar: similarWork(site, firstTitle).map((g) => ({ image: g.image, caption: g.caption })),
      insurance: req.query && (req.query as { seguro?: string }).seguro === '1' ? insuranceDetail(q) : null,
      business: {
        name: b.name,
        slug: b.slug,
        whatsapp: b.whatsapp,
        address: b.address,
        email: b.email,
        logo: b.logoAssetId ? `/api/assets/${b.logoAssetId}` : null,
        primaryColor: site.primaryColor,
        accentColor: site.accentColor,
        /** Seña online (con datos y comprobante): según el plan. */
        deposit: hasFeature(b.plan, 'deposit'),
        /** Pago con Mercado Pago (si la vidriería lo conectó). */
        mp: hasFeature(b.plan, 'mercadopago') && !!b.mpAccessToken,
        installments: hasFeature(b.plan, 'installments') ? (b.installmentRates as Record<string, number>) : {},
        pay: { alias: b.payAlias, cbu: b.payCbu, holder: b.payHolder, note: b.payNote },
      },
    };
  });

  app.post('/public/quotes/:token/accept', async (req) => {
    const { token } = req.params as { token: string };
    const { option, safetyAck } = z.object({ option: z.number().int().min(0).max(2).nullish(), safetyAck: z.boolean().default(false) }).parse(req.body ?? {});
    let q = await prisma.quote.findUnique({ where: { publicToken: token }, include: { customer: { select: { name: true } } } });
    if (!q) throw notFound();
    q = await expireIfNeeded(q);
    if (q.status === 'ACCEPTED') return { ok: true };
    if (q.status === 'EXPIRED') throw new HttpError(409, 'quote_expired', 'El presupuesto venció. Pedí uno actualizado.');
    if (q.status === 'REJECTED') throw new HttpError(409, 'quote_rejected', 'Este presupuesto ya no está disponible.');
    const data = acceptData(q, option);
    // Vidrio común donde va de seguridad: el cliente tiene que confirmar que lo quiere igual.
    const chosen = ('input' in data ? data.input : q.input) as unknown as QuoteInput;
    if (safetyIssues(chosen.items).length && !safetyAck && !q.safetyAckAt)
      throw new HttpError(409, 'safety_ack_required', 'Confirmá que entendés que no es vidrio de seguridad.');
    await prisma.quote.update({ where: { id: q.id }, data: { ...data, ...(safetyAck && !q.safetyAckAt ? { safetyAckAt: new Date() } : {}) } });
    await ensureJob(q.id);
    const label = storedOptions(q)?.[option ?? 0]?.label;
    const total = 'total' in data ? data.total : Number(q.total);
    notifyLater(q.businessId, {
      title: `¡${who(q)} aceptó el presupuesto!`,
      body: `N° ${q.number}${label ? ` · ${label}` : ''} · ${money(total)}`,
      url: `/panel/presupuestos/${q.id}`,
    });
    return { ok: true };
  });

  /** El cliente sube el comprobante de la seña (foto o PDF). */
  app.post(
    '/public/quotes/:token/deposit',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req) => {
      const { token } = req.params as { token: string };
      const { file } = z.object({ file: z.string().max(5 * 1024 * 1024) }).parse(req.body);
      const q = await prisma.quote.findUnique({ where: { publicToken: token }, include: { customer: { select: { name: true } }, business: { select: { plan: true } } } });
      if (!q || !hasFeature(q.business.plan, 'deposit')) throw notFound();
      if (q.status !== 'ACCEPTED') throw new HttpError(409, 'not_accepted', 'Primero aceptá el presupuesto.');
      if (q.depositPaidAt) return { ok: true };
      const { mime, data } = decodeDataUrl(file, RECEIPT_MIMES);
      await prisma.$transaction(async (tx) => {
        const a = await tx.asset.create({ data: { businessId: q.businessId, mime, data, size: data.length, kind: 'receipt', public: false } });
        await tx.quote.update({ where: { id: q.id }, data: { depositProofId: a.id, depositReportedAt: new Date() } });
      });
      notifyLater(q.businessId, {
        title: `${who(q)} mandó el comprobante de la seña`,
        body: `N° ${q.number} · seña ${money(Number(q.deposit))}. Revisalo y confirmá el cobro.`,
        url: `/panel/presupuestos/${q.id}`,
      });
      return { ok: true };
    },
  );
}

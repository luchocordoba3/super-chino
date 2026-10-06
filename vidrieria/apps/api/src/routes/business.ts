import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CUSTOMER_TYPES } from '@vidrieria/shared';
import { prisma } from '../db';
import { guard } from '../lib/auth';
import { badRequest } from '../lib/http';
import { dollarFor } from '../services/dollar';
import { quoteSettings } from '../services/settings';
import { RESERVED_SLUGS, siteContent, siteSchema } from '../services/site';

const pct = z.number().finite().min(-100).max(1000);

export async function businessRoutes(app: FastifyInstance) {
  app.get('/business', guard(), async (req) => {
    const b = await prisma.business.findUniqueOrThrow({ where: { id: req.auth.bid } });
    return { ...b, site: siteContent(b), dollar: await dollarFor(b) };
  });

  app.patch('/business', guard('owner'), async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(2).max(80),
        slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Solo letras, números y guiones').min(3).max(40),
        customDomain: z.string().trim().toLowerCase().max(120).nullable(),
        whatsapp: z.string().trim().max(40),
        email: z.string().trim().max(120),
        address: z.string().trim().max(200),
        zones: z.string().trim().max(200),
        hours: z.string().trim().max(200),
        instagram: z.string().trim().max(120),
        logoAssetId: z.string().nullable(),
        site: siteSchema,
        dollarSource: z.enum(['MANUAL', 'OFICIAL', 'BLUE']),
        dollarManual: z.number().finite().min(1).max(1e7),
        wastePct: pct,
        depositPct: pct,
        urgencyPct: pct,
        freightPerKm: z.number().finite().min(0).max(1e9),
        pricesIncludeVat: z.boolean(),
        vatPct: pct,
        roundToCm: z.number().int().min(0).max(100),
        minAreaM2: z.number().finite().min(0).max(100),
        validDays: z.number().int().min(1).max(365),
        customerAdjust: z.record(z.enum(CUSTOMER_TYPES), pct),
        quoteFooter: z.string().trim().max(1000),
        dollarAlertPct: z.number().finite().min(0).max(100),
        payAlias: z.string().trim().max(60),
        payCbu: z.string().trim().max(40),
        payHolder: z.string().trim().max(120),
        payNote: z.string().trim().max(300),
        supplierName: z.string().trim().max(120),
        supplierWhatsapp: z.string().trim().max(40),
      })
      .partial()
      .parse(req.body);
    if (body.slug) {
      if (RESERVED_SLUGS.has(body.slug)) throw badRequest('slug_taken', 'Esa dirección no está disponible');
      const other = await prisma.business.findUnique({ where: { slug: body.slug } });
      if (other && other.id !== req.auth.bid) throw badRequest('slug_taken', 'Esa dirección ya la usa otra vidriería');
    }
    if (body.customDomain) {
      const other = await prisma.business.findUnique({ where: { customDomain: body.customDomain } });
      if (other && other.id !== req.auth.bid) throw badRequest('domain_taken', 'Ese dominio ya está en uso');
    }
    if (body.logoAssetId && !(await prisma.asset.findFirst({ where: { id: body.logoAssetId, businessId: req.auth.bid } }))) throw badRequest('asset_not_found');
    const b = await prisma.business.update({ where: { id: req.auth.bid }, data: { ...body, ...(body.customDomain !== undefined ? { customDomain: body.customDomain || null } : {}) } });
    return { ...b, site: siteContent(b), dollar: await dollarFor(b) };
  });

  /** Todo lo que necesita el presupuestador para calcular en el navegador. */
  app.get('/quote-settings', guard(), async (req) => {
    const b = await prisma.business.findUniqueOrThrow({ where: { id: req.auth.bid } });
    const dollar = await dollarFor(b);
    return { settings: quoteSettings(b, dollar.rate), dollar, customerAdjust: b.customerAdjust, validDays: b.validDays };
  });
}

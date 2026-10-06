import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import forge from 'node-forge';
import type { Business } from '@prisma/client';
import { CUSTOMER_TYPES, MONOTRIBUTO_CAPS, PAY_METHODS } from '@vidrieria/shared';
import { prisma } from '../db';
import { guard, requireFeature } from '../lib/auth';
import { badRequest } from '../lib/http';
import { seal } from '../lib/secret';
import { arcaConfig } from '../services/arca';
import { dollarFor } from '../services/dollar';
import { quoteSettings } from '../services/settings';
import { RESERVED_SLUGS, siteContent, siteSchema } from '../services/site';

const pct = z.number().finite().min(-100).max(1000);

/** Lo que ve el panel: nunca los secretos, solo si están cargados. */
async function view(b: Business) {
  const { mpAccessToken, arcaCert, arcaKey, ...rest } = b;
  return { ...rest, site: siteContent(b), dollar: await dollarFor(b), mpConnected: !!mpAccessToken, arcaReady: !!arcaConfig(b), arcaCertLoaded: !!arcaCert && !!arcaKey };
}

const pem = (kind: 'cert' | 'key') =>
  z
    .string()
    .trim()
    .max(20_000)
    .refine((v) => {
      if (!v) return true;
      try {
        if (kind === 'cert') forge.pki.certificateFromPem(v);
        else forge.pki.privateKeyFromPem(v);
        return true;
      } catch {
        return false;
      }
    }, kind === 'cert' ? 'El certificado no es válido (tiene que ser el .crt o .pem que da ARCA)' : 'La clave privada no es válida (el archivo .key)');

export async function businessRoutes(app: FastifyInstance) {
  app.get('/business', guard(), async (req) => {
    const b = await prisma.business.findUniqueOrThrow({ where: { id: req.auth.bid } });
    return view(b);
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
        customerAdjust: z.partialRecord(z.enum(CUSTOMER_TYPES), pct),
        quoteFooter: z.string().trim().max(1000),
        dollarAlertPct: z.number().finite().min(0).max(100),
        payAlias: z.string().trim().max(60),
        payCbu: z.string().trim().max(40),
        payHolder: z.string().trim().max(120),
        payNote: z.string().trim().max(300),
        supplierName: z.string().trim().max(120),
        supplierWhatsapp: z.string().trim().max(40),
        temperDays: z.number().int().min(0).max(120),
        glassDays: z.number().int().min(0).max(60),
        warrantyMonths: z.number().int().min(0).max(240),
        payFees: z.partialRecord(z.enum(PAY_METHODS), z.number().finite().min(0).max(50)),
        mpAccessToken: z.string().trim().max(300).nullable(),
        monotributoCategory: z.enum(['', ...Object.keys(MONOTRIBUTO_CAPS)] as [string, ...string[]]),
        monotributoCap: z.number().finite().min(0).max(1e13).nullable(),
        arcaCuit: z.string().trim().max(20),
        arcaPtoVta: z.number().int().min(1).max(99999),
        arcaProduction: z.boolean(),
        arcaCert: pem('cert'),
        arcaKey: pem('key'),
        installmentRates: z.record(z.string().regex(/^\d{1,2}$/), z.number().finite().min(0).max(300)),
        priceTestPct: z.number().finite().min(0).max(50),
        reviewUrl: z.string().trim().max(500),
        referralBenefit: z.string().trim().max(200),
        stormMode: z.boolean(),
      })
      .partial()
      .parse(req.body);
    if (body.slug) {
      if (RESERVED_SLUGS.has(body.slug)) throw badRequest('slug_taken', 'Esa dirección no está disponible');
      const other = await prisma.business.findUnique({ where: { slug: body.slug } });
      if (other && other.id !== req.auth.bid) throw badRequest('slug_taken', 'Esa dirección ya la usa otra vidriería');
    }
    if (body.customDomain) requireFeature(req, 'domain');
    if (body.mpAccessToken) requireFeature(req, 'mercadopago');
    if (body.arcaCert || body.arcaKey) requireFeature(req, 'arca');
    if (body.installmentRates && Object.keys(body.installmentRates).length) requireFeature(req, 'installments');
    if (body.customDomain) {
      const other = await prisma.business.findUnique({ where: { customDomain: body.customDomain } });
      if (other && other.id !== req.auth.bid) throw badRequest('domain_taken', 'Ese dominio ya está en uso');
    }
    if (body.logoAssetId && !(await prisma.asset.findFirst({ where: { id: body.logoAssetId, businessId: req.auth.bid } }))) throw badRequest('asset_not_found');
    const { mpAccessToken, arcaCert, arcaKey, ...rest } = body;
    const b = await prisma.business.update({
      where: { id: req.auth.bid },
      data: {
        ...rest,
        ...(body.customDomain !== undefined ? { customDomain: body.customDomain || null } : {}),
        // Secretos: vacío o null los borra; un valor nuevo se guarda cifrado; si no viene, no se toca.
        ...(mpAccessToken !== undefined ? { mpAccessToken: mpAccessToken ? seal(mpAccessToken) : null } : {}),
        ...(arcaCert !== undefined ? { arcaCert: arcaCert ? seal(arcaCert) : null } : {}),
        ...(arcaKey !== undefined ? { arcaKey: arcaKey ? seal(arcaKey) : null } : {}),
      },
    });
    return view(b);
  });

  /** Todo lo que necesita el presupuestador para calcular en el navegador. */
  app.get('/quote-settings', guard(), async (req) => {
    const b = await prisma.business.findUniqueOrThrow({ where: { id: req.auth.bid } });
    const dollar = await dollarFor(b);
    return { settings: quoteSettings(b, dollar.rate), dollar, customerAdjust: b.customerAdjust, validDays: b.validDays };
  });
}

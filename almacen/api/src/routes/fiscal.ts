import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { num, prisma } from '../db';
import { localYMD } from '../domain/dates';
import { env } from '../env';
import { deviceGuard, guard } from '../lib/auth';
import { decrypt, encrypt } from '../lib/crypto';
import { HttpError, notFound } from '../lib/http';
import { arcaQrUrl, authorizeInvoice, checkCertificate, INVOICE_LETTER, requestInvoice, testConnection } from '../services/arca';

type InvoiceRow = Awaited<ReturnType<typeof prisma.invoice.findFirstOrThrow>>;
const pad = (n: number, len: number) => String(n).padStart(len, '0');
const invoiceView = (i: InvoiceRow) => ({
  id: i.id,
  saleId: i.saleId,
  status: i.status,
  letter: INVOICE_LETTER[i.type] ?? '?',
  number: i.number,
  code: i.number ? `${pad(i.pointOfSale, 4)}-${pad(i.number, 8)}` : null,
  customerName: i.customerName,
  docType: i.docType,
  docNumber: i.docNumber,
  total: num(i.total),
  cae: i.cae,
  caeDue: i.caeDue,
  error: i.error,
  createdAt: i.createdAt,
  path: `/f/${i.publicToken}`,
});

const invoiceBody = z.object({
  saleId: z.string().min(1),
  docType: z.union([z.literal(80), z.literal(96), z.literal(99)]),
  docNumber: z.string().trim().max(15).default('0'),
  customerName: z.string().trim().max(80).optional(),
  customerVat: z.union([z.literal(1), z.literal(5), z.literal(6)]).default(5),
});

export async function fiscalRoutes(app: FastifyInstance) {
  // ---------- Dueño: datos fiscales y certificado de ARCA ----------
  app.get('/fiscal', guard('owner'), async (req) => {
    const c = await prisma.fiscalConfig.findUnique({ where: { storeId: req.auth.sid } });
    if (!c) return null;
    let certificate: { notAfter: Date; subject: string } | null = null;
    try {
      certificate = checkCertificate(decrypt(c.certPem), decrypt(c.keyPem));
    } catch {
      certificate = null;
    }
    return {
      cuit: c.cuit,
      businessName: c.businessName,
      address: c.address,
      taxStatus: c.taxStatus,
      pointOfSale: c.pointOfSale,
      vatRate: num(c.vatRate),
      production: c.production,
      enabled: c.enabled,
      certificate,
    };
  });

  app.put('/fiscal', guard('owner'), async (req) => {
    const b = z
      .object({
        cuit: z.string().regex(/^\d{11}$/),
        businessName: z.string().trim().min(2).max(120),
        address: z.string().trim().max(160).nullish(),
        taxStatus: z.enum(['MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO']),
        pointOfSale: z.number().int().min(1).max(99999),
        vatRate: z.union([z.literal(21), z.literal(10.5), z.literal(27), z.literal(5), z.literal(2.5), z.literal(0)]).default(21),
        production: z.boolean().default(false),
        enabled: z.boolean().default(true),
        certPem: z.string().max(20_000).optional(),
        keyPem: z.string().max(20_000).optional(),
      })
      .parse(req.body);
    const storeId = req.auth.sid;
    const prev = await prisma.fiscalConfig.findUnique({ where: { storeId } });
    if (!prev && (!b.certPem || !b.keyPem)) throw new HttpError(400, 'certificate_required');
    const newCert = b.certPem && b.keyPem ? (checkCertificate(b.certPem, b.keyPem), { certPem: encrypt(b.certPem), keyPem: encrypt(b.keyPem) }) : {};
    // Con otro certificado, otro CUIT u otro ambiente, el acceso guardado ya no sirve.
    const resetAccess = !prev || !!b.certPem || prev.cuit !== b.cuit || prev.production !== b.production ? { wsaaToken: null, wsaaSign: null, wsaaExpires: null } : {};
    const data = {
      cuit: b.cuit,
      businessName: b.businessName,
      address: b.address ?? null,
      taxStatus: b.taxStatus,
      pointOfSale: b.pointOfSale,
      vatRate: b.vatRate,
      production: b.production,
      enabled: b.enabled,
      ...newCert,
      ...resetAccess,
    };
    await prisma.fiscalConfig.upsert({
      where: { storeId },
      create: { storeId, ...data, certPem: newCert.certPem!, keyPem: newCert.keyPem! },
      update: data,
    });
    await prisma.store.update({ where: { id: storeId }, data: {} }); // las cajas se enteran en la próxima sincronización
    return { ok: true };
  });

  app.post('/fiscal/test', guard('owner'), async (req) => testConnection(req.auth.sid));

  // ---------- Facturas ----------
  app.get('/invoices', guard('reports'), async (req) => {
    const rows = await prisma.invoice.findMany({ where: { storeId: req.auth.sid }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map(invoiceView);
  });
  app.get('/invoices/by-sale/:saleId', guard('sell'), async (req) => {
    const i = await prisma.invoice.findFirst({ where: { storeId: req.auth.sid, saleId: (req.params as { saleId: string }).saleId } });
    return i ? invoiceView(i) : null;
  });
  /** Facturar una venta ya hecha (desde Ventas). */
  app.post('/invoices', guard('sell'), async (req) => {
    const b = invoiceBody.parse(req.body);
    const inv = await requestInvoice(prisma, { storeId: req.auth.sid, ...b });
    return invoiceView((await authorizeInvoice(req.auth.sid, inv.id)) ?? inv);
  });
  app.post('/invoices/:id/retry', guard('sell'), async (req) => {
    const r = await authorizeInvoice(req.auth.sid, (req.params as { id: string }).id);
    if (!r) throw notFound();
    return invoiceView(r);
  });

  // La caja pide la factura como evento (anda sin internet) y después consulta cómo quedó.
  app.get('/pos/invoices/by-sale/:saleId', deviceGuard, async (req) => {
    const i = await prisma.invoice.findFirst({ where: { storeId: req.device.storeId, saleId: (req.params as { saleId: string }).saleId } });
    return i ? invoiceView(i) : null;
  });

  app.post('/pos/invoices/:id/retry', deviceGuard, async (req) => {
    const r = await authorizeInvoice(req.device.storeId, (req.params as { id: string }).id);
    if (!r) throw notFound();
    return invoiceView(r);
  });

  // ---------- Factura para el cliente (link por WhatsApp) ----------
  app.get('/public/invoices/:token', { config: { rateLimit: { max: env.isTest ? 10_000 : 60, timeWindow: '1 minute' } } }, async (req) => {
    const i = await prisma.invoice.findUnique({ where: { publicToken: (req.params as { token: string }).token } });
    if (!i || i.status !== 'AUTHORIZED' || !i.number || !i.cae) throw notFound();
    const [cfg, sale, store] = await Promise.all([
      prisma.fiscalConfig.findUniqueOrThrow({ where: { storeId: i.storeId } }),
      prisma.sale.findUniqueOrThrow({ where: { id: i.saleId }, include: { items: true } }),
      prisma.store.findUniqueOrThrow({ where: { id: i.storeId } }),
    ]);
    const date = localYMD(store.timezone, i.issuedAt ?? i.createdAt);
    return {
      ...invoiceView(i),
      date,
      net: num(i.net),
      vat: num(i.vat),
      vatRate: num(cfg.vatRate),
      issuer: { businessName: cfg.businessName, cuit: cfg.cuit, address: cfg.address, taxStatus: cfg.taxStatus, storeName: store.name },
      items: sale.items.map((it) => ({ name: it.name, qty: num(it.qty), unitPrice: num(it.unitPrice), total: num(it.lineTotal) })),
      qr: arcaQrUrl({ date, cuit: cfg.cuit, pointOfSale: i.pointOfSale, type: i.type, number: i.number, total: num(i.total), docType: i.docType, docNumber: i.docNumber, cae: i.cae }),
    };
  });
}

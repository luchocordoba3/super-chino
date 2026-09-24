import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { aiService, type ImageMediaType, type InvoiceData, type LabelData } from '../ai';
import { prisma } from '../db';
import { startOfLocalDay } from '../domain/dates';
import { bestMatches } from '../domain/text';
import { guard } from '../lib/auth';
import { badRequest, HttpError } from '../lib/http';
import { saveImage } from '../lib/uploads';
import { recordAiUsage } from '../services/messages';
import { storeCtx } from '../services/store';

const MEDIA: ImageMediaType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const validDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null);

/** Relaciona los renglones leídos con el catálogo: primero por código, después por nombre parecido. */
async function matchInvoice(storeId: string, data: InvoiceData) {
  const [products, suppliers] = await Promise.all([
    prisma.product.findMany({ where: { storeId, active: true }, select: { id: true, name: true, barcode: true, unit: true } }),
    prisma.supplier.findMany({ where: { storeId }, select: { id: true, name: true } }),
  ]);
  const byBarcode = new Map(products.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
  const supplier = data.supplierName ? bestMatches(data.supplierName, suppliers, 1, 0.5)[0]?.item ?? null : null;
  return {
    supplierName: data.supplierName,
    supplierId: supplier?.id ?? null,
    invoiceNumber: data.invoiceNumber,
    date: validDate(data.date),
    items: data.items
      .filter((i) => i.quantity > 0)
      .map((i) => {
        const barcode = i.barcode?.replace(/\D/g, '') || null;
        const exact = barcode ? byBarcode.get(barcode) : undefined;
        const candidates = exact ? [{ item: exact, score: 1 }] : bestMatches(i.description, products);
        const best = candidates[0];
        return {
          description: i.description,
          barcode,
          quantity: i.quantity,
          unitCost: i.unitCost != null && i.unitCost >= 0 ? i.unitCost : null,
          lotCode: i.lotCode,
          expiresAt: validDate(i.expiresAt),
          match: best && best.score >= 0.55 ? { productId: best.item.id, name: best.item.name, score: Math.round(best.score * 100) / 100 } : null,
          candidates: candidates.map((c) => ({ id: c.item.id, name: c.item.name })),
        };
      }),
  };
}

export async function aiRoutes(app: FastifyInstance) {
  /** Foto de factura/remito (kind=invoice) o de etiqueta (kind=label). */
  app.post('/ai/scan', guard('stock'), async (req) => {
    const { kind } = z.object({ kind: z.enum(['invoice', 'label']) }).parse(req.query);
    const storeId = req.auth.sid;
    if (!aiService.enabled()) throw badRequest('ai_disabled');
    const { store, settings } = await storeCtx(prisma, storeId);
    const today = await prisma.invoiceScan.count({ where: { storeId, createdAt: { gte: startOfLocalDay(store.timezone) } } });
    if (today >= settings.aiDailyScanLimit) throw new HttpError(429, 'limit_reached');

    const file = await req.file();
    if (!file) throw badRequest('no_file');
    const mediaType = file.mimetype as ImageMediaType;
    if (!MEDIA.includes(mediaType)) throw badRequest('invalid_image');
    const buf = await file.toBuffer();
    const imagePath = await saveImage(storeId, buf, mediaType);

    try {
      if (kind === 'invoice') {
        const r = await aiService.readImage('invoice', buf, mediaType);
        await recordAiUsage(storeId, 'invoice', r.usage);
        const result = await matchInvoice(storeId, r.data as InvoiceData);
        const scan = await prisma.invoiceScan.create({ data: { storeId, userId: req.auth.uid, kind: 'INVOICE', imagePath, result: result as unknown as Prisma.InputJsonValue } });
        return { id: scan.id, result };
      }
      const r = await aiService.readImage('label', buf, mediaType);
      await recordAiUsage(storeId, 'label', r.usage);
      const d = r.data as LabelData;
      const result = { ...d, expiresAt: validDate(d.expiresAt), barcode: d.barcode?.replace(/\D/g, '') || null };
      const scan = await prisma.invoiceScan.create({ data: { storeId, userId: req.auth.uid, kind: 'LABEL', imagePath, result } });
      return { id: scan.id, result };
    } catch (e) {
      await prisma.invoiceScan.create({ data: { storeId, userId: req.auth.uid, kind: kind.toUpperCase(), imagePath, status: 'failed', error: String(e).slice(0, 500) } });
      req.log.warn({ err: e }, 'ai scan');
      throw new HttpError(422, 'ai_failed');
    }
  });

  /** Consumo de IA del local (para saber cuánto cuesta cada cliente). */
  app.get('/ai/usage', guard('owner'), async (req) => {
    const since = new Date();
    since.setDate(1);
    since.setHours(0, 0, 0, 0);
    const rows = await prisma.aiUsage.groupBy({
      by: ['feature'],
      where: { storeId: req.auth.sid, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true },
    });
    return rows.map((r) => ({ feature: r.feature, calls: r._count._all, inputTokens: r._sum.inputTokens ?? 0, outputTokens: r._sum.outputTokens ?? 0 }));
  });
}

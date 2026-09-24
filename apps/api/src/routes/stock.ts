import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { num, prisma } from '../db';
import { addDays, daysBetween } from '../domain/dates';
import { can, guard } from '../lib/auth';
import { badRequest, HttpError, notFound } from '../lib/http';
import { publish } from '../services/notify';
import { checkLowStock } from '../services/sales';
import { adjustStock, createStockEntry, lotsByProduct } from '../services/stock';
import { storeCtx, userNames } from '../services/store';
import { createProduct, productBody, productDto } from './products';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const entryItem = z.object({
  productId: z.string().min(1).nullish(),
  /** Producto nuevo en el mismo ingreso (si el código ya existe, se usa el existente). */
  newProduct: productBody.pick({ name: true, price: true, barcode: true, unit: true, categoryId: true }).nullish(),
  qty: z.number().positive().max(1e7),
  unitCost: z.number().min(0).max(1e10).nullish(),
  lotCode: z.string().trim().max(40).nullish(),
  expiresAt: ymd.nullish(),
});

export async function stockRoutes(app: FastifyInstance) {
  /** Ingreso con varios renglones (factura / remito). */
  app.post('/stock/entries', guard('stock'), async (req) => {
    const b = z
      .object({
        supplierId: z.string().nullish(),
        invoiceNumber: z.string().trim().max(40).nullish(),
        invoiceScanId: z.string().nullish(),
        items: z.array(entryItem).min(1).max(300),
      })
      .parse(req.body);
    const storeId = req.auth.sid;
    if (b.items.some((i) => !i.productId && !i.newProduct)) throw badRequest('item_without_product');
    if (b.items.some((i) => i.newProduct) && !can(req.auth, 'stock')) throw new HttpError(403, 'forbidden');
    if (b.invoiceScanId && !(await prisma.invoiceScan.findFirst({ where: { id: b.invoiceScanId, storeId, status: 'done' } }))) {
      throw badRequest('scan_not_available');
    }
    const { settings } = await storeCtx(prisma, storeId);
    const res = await prisma.$transaction(async (tx) => {
      const items = [];
      for (const it of b.items) {
        let productId = it.productId ?? null;
        if (!productId && it.newProduct) {
          const existing = it.newProduct.barcode
            ? await tx.product.findUnique({ where: { storeId_barcode: { storeId, barcode: it.newProduct.barcode } } })
            : null;
          productId = existing?.id ?? (await createProduct(storeId, productBody.parse({ ...it.newProduct, cost: it.unitCost ?? undefined, supplierId: b.supplierId }), tx)).id;
        }
        items.push({ ...it, productId: productId! });
      }
      const entry = await createStockEntry(tx, { storeId, userId: req.auth.uid, settings, supplierId: b.supplierId, invoiceNumber: b.invoiceNumber, invoiceScanId: b.invoiceScanId, items });
      if (b.invoiceScanId) await tx.invoiceScan.update({ where: { id: b.invoiceScanId }, data: { status: 'confirmed' } });
      await checkLowStock(tx, storeId, items.map((i) => i.productId));
      return entry;
    });
    publish(storeId, b.items.some((i) => i.newProduct) ? 'catalog' : 'stock');
    return res;
  });

  /**
   * Carga rápida: escaneo el código -> si es nuevo pongo nombre y precio -> cantidad (y vencimiento) -> listo.
   * El producto queda con su código de barras para la caja.
   */
  app.post('/stock/quick', guard('stock'), async (req) => {
    const b = z
      .object({
        productId: z.string().nullish(),
        barcode: z.string().trim().max(32).nullish(),
        product: productBody.omit({ barcode: true }).partial().nullish(),
        qty: z.number().min(0).max(1e7),
        unitCost: z.number().min(0).max(1e10).nullish(),
        lotCode: z.string().trim().max(40).nullish(),
        expiresAt: ymd.nullish(),
      })
      .parse(req.body);
    const storeId = req.auth.sid;
    let product = b.productId
      ? await prisma.product.findFirst({ where: { id: b.productId, storeId } })
      : b.barcode
        ? await prisma.product.findUnique({ where: { storeId_barcode: { storeId, barcode: b.barcode } } })
        : null;
    if (b.productId && !product) throw notFound();
    let created = false;
    if (!product) {
      if (!b.product?.name || b.product.price == null) throw badRequest('new_product_needs_name_and_price');
      product = await createProduct(storeId, productBody.parse({ ...b.product, barcode: b.barcode, cost: b.product.cost ?? b.unitCost ?? undefined }));
      created = true;
    } else if (!product.active) {
      product = await prisma.product.update({ where: { id: product.id }, data: { active: true } });
    }
    if (b.product?.price != null && !created && b.product.price !== num(product.price)) {
      throw new HttpError(400, 'use_product_edit_to_change_price');
    }
    const { settings } = await storeCtx(prisma, storeId);
    const productId = product.id;
    const entry =
      b.qty > 0
        ? await prisma.$transaction(async (tx) => {
            const res = await createStockEntry(tx, {
              storeId,
              userId: req.auth.uid,
              settings,
              items: [{ productId, qty: b.qty, unitCost: b.unitCost, lotCode: b.lotCode, expiresAt: b.expiresAt }],
            });
            await checkLowStock(tx, storeId, [productId]);
            return res;
          })
        : null;
    publish(storeId, created ? 'catalog' : 'stock');
    const fresh = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: { category: { select: { name: true } }, supplier: { select: { name: true } } },
    });
    return {
      product: productDto(fresh, await lotsByProduct(prisma, storeId, [productId])),
      created,
      suggestion: entry?.suggestions[0] ?? null,
    };
  });

  /** Lotes con stock, por vencer primero. within = días hacia adelante (incluye vencidos). */
  app.get('/stock/lots', guard(), async (req) => {
    const q = z.object({ within: z.coerce.number().int().min(0).max(3650).optional(), productId: z.string().optional() }).parse(req.query);
    const { today } = await storeCtx(prisma, req.auth.sid);
    const lots = await prisma.lot.findMany({
      where: {
        storeId: req.auth.sid,
        qtyRemaining: { gt: 0 },
        productId: q.productId,
        ...(q.within != null ? { expiresAt: { not: null, lte: addDays(today, q.within) } } : {}),
      },
      include: { product: { select: { name: true, unit: true, barcode: true, price: true } }, offer: { select: { status: true, offerPrice: true } } },
      orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
      take: 500,
    });
    return lots.map((l) => ({
      id: l.id,
      productId: l.productId,
      product: l.product.name,
      unit: l.product.unit,
      price: num(l.product.price),
      lotCode: l.lotCode,
      expiresAt: l.expiresAt,
      daysLeft: l.expiresAt ? daysBetween(today, l.expiresAt) : null,
      qtyRemaining: num(l.qtyRemaining),
      unitCost: num(l.unitCost),
      offer: l.offer ? { status: l.offer.status, offerPrice: num(l.offer.offerPrice) } : null,
    }));
  });

  /** Ajuste (rotura, robo, sobrante) o merma. */
  app.post('/stock/adjust', guard('adjust'), async (req) => {
    const b = z
      .object({
        productId: z.string(),
        qty: z.number().min(-1e7).max(1e7),
        type: z.enum(['ADJUSTMENT', 'WASTE']).default('ADJUSTMENT'),
        reason: z.string().trim().max(200).nullish(),
        lotId: z.string().nullish(),
      })
      .parse(req.body);
    const storeId = req.auth.sid;
    if (!(await prisma.product.findFirst({ where: { id: b.productId, storeId } }))) throw notFound();
    if (b.lotId && !(await prisma.lot.findFirst({ where: { id: b.lotId, productId: b.productId } }))) throw notFound('lot_not_found');
    const { today } = await storeCtx(prisma, storeId);
    await prisma.$transaction(async (tx) => {
      await adjustStock(tx, { storeId, productId: b.productId, qty: b.qty, today, type: b.type, userId: req.auth.uid, reason: b.reason, lotId: b.lotId ?? undefined });
      await checkLowStock(tx, storeId, [b.productId]);
    });
    publish(storeId, 'stock');
    return { ok: true };
  });

  app.get('/stock/movements', guard(), async (req) => {
    if (!can(req.auth, 'stock') && !can(req.auth, 'adjust') && !can(req.auth, 'reports')) throw new HttpError(403, 'forbidden');
    const q = z.object({ productId: z.string().optional(), type: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const [moves, names] = await Promise.all([
      prisma.stockMovement.findMany({
        where: { storeId: req.auth.sid, productId: q.productId, type: q.type as never },
        include: { product: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
      }),
      userNames(prisma, req.auth.sid),
    ]);
    return moves.map((m) => ({
      id: m.id,
      productId: m.productId,
      product: m.product.name,
      type: m.type,
      qty: num(m.qty),
      unitCost: num(m.unitCost),
      reason: m.reason,
      user: m.userId ? names.get(m.userId) ?? null : null,
      createdAt: m.createdAt,
    }));
  });
}

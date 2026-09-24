import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { round3 } from '@super-chino/shared';
import { num, prisma, type Prisma } from '../db';
import { bulkPrice } from '../domain/pricing';
import { fefoCompare } from '../domain/fefo';
import { can, guard } from '../lib/auth';
import { HttpError, notFound } from '../lib/http';
import { publish } from '../services/notify';
import { lookupBarcode } from '../services/off';
import { lotsByProduct, stockOf } from '../services/stock';
import { storeCtx, userNames } from '../services/store';

const money = z.number().min(0).max(1e10);
const optId = z.string().min(1).nullish();

export const productBody = z.object({
  barcode: z.string().trim().max(32).nullish().transform((v) => v || null),
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(60).nullish().transform((v) => v || null),
  categoryId: optId,
  supplierId: optId,
  unit: z.enum(['UNIT', 'KG']).default('UNIT'),
  price: money,
  cost: money.optional(),
  minStock: z.number().min(0).max(1e7).optional(),
  targetMargin: z.number().min(0).max(500).nullish(),
});

/** Verifica que categoría y proveedor sean del mismo local. */
export async function checkRefs(
  storeId: string,
  b: { categoryId?: string | null; supplierId?: string | null },
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  if (b.categoryId && !(await db.category.findFirst({ where: { id: b.categoryId, storeId } }))) throw notFound('category_not_found');
  if (b.supplierId && !(await db.supplier.findFirst({ where: { id: b.supplierId, storeId } }))) throw notFound('supplier_not_found');
}

function isUniqueError(e: unknown) {
  return (e as { code?: string }).code === 'P2002';
}

export async function createProduct(storeId: string, b: z.infer<typeof productBody>, db: Prisma.TransactionClient | typeof prisma = prisma) {
  await checkRefs(storeId, b, db);
  try {
    return await db.product.create({
      data: {
        storeId,
        barcode: b.barcode,
        name: b.name,
        brand: b.brand,
        categoryId: b.categoryId ?? null,
        supplierId: b.supplierId ?? null,
        unit: b.unit,
        price: b.price,
        cost: b.cost ?? 0,
        minStock: b.minStock ?? 0,
        targetMargin: b.targetMargin ?? null,
      },
    });
  } catch (e) {
    if (isUniqueError(e)) throw new HttpError(409, 'barcode_taken');
    throw e;
  }
}

type ProductRow = Prisma.ProductGetPayload<{ include: { category: { select: { name: true } }; supplier: { select: { name: true } } } }>;
export function productDto(p: ProductRow | Prisma.ProductGetPayload<object>, lots: Awaited<ReturnType<typeof lotsByProduct>>) {
  const extra = p as Partial<ProductRow>;
  return {
    id: p.id,
    barcode: p.barcode,
    name: p.name,
    brand: p.brand,
    categoryId: p.categoryId,
    category: extra.category?.name ?? null,
    supplierId: p.supplierId,
    supplier: extra.supplier?.name ?? null,
    unit: p.unit,
    price: num(p.price),
    cost: num(p.cost),
    minStock: num(p.minStock),
    targetMargin: p.targetMargin == null ? null : num(p.targetMargin),
    unallocatedSold: num(p.unallocatedSold),
    active: p.active,
    updatedAt: p.updatedAt,
    ...stockOf(p, lots),
  };
}

export async function productRoutes(app: FastifyInstance) {
  // ---------- Categorías y proveedores ----------
  app.get('/categories', guard(), async (req) =>
    prisma.category.findMany({ where: { storeId: req.auth.sid }, orderBy: { name: 'asc' } }),
  );
  app.post('/categories', guard('stock', 'prices'), async (req) => {
    const b = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
    return prisma.category.upsert({
      where: { storeId_name: { storeId: req.auth.sid, name: b.name } },
      create: { storeId: req.auth.sid, name: b.name },
      update: {},
    });
  });

  const supplierBody = z.object({
    name: z.string().trim().min(1).max(80),
    phone: z.string().trim().max(20).nullish().transform((v) => (v ? v.replace(/\D/g, '') : null)),
    leadTimeDays: z.number().int().min(0).max(60).optional(),
  });
  app.get('/suppliers', guard(), async (req) =>
    prisma.supplier.findMany({ where: { storeId: req.auth.sid }, orderBy: { name: 'asc' } }),
  );
  app.post('/suppliers', guard('stock', 'prices'), async (req) => {
    const b = supplierBody.parse(req.body);
    try {
      return await prisma.supplier.create({ data: { storeId: req.auth.sid, ...b } });
    } catch (e) {
      if (isUniqueError(e)) throw new HttpError(409, 'supplier_exists');
      throw e;
    }
  });
  app.patch('/suppliers/:id', guard('stock', 'prices'), async (req) => {
    const { id } = req.params as { id: string };
    const b = supplierBody.partial().parse(req.body);
    if (!(await prisma.supplier.findFirst({ where: { id, storeId: req.auth.sid } }))) throw notFound();
    return prisma.supplier.update({ where: { id }, data: b });
  });

  // ---------- Productos ----------
  app.get('/products', guard(), async (req) => {
    const q = z
      .object({
        q: z.string().trim().optional(),
        categoryId: z.string().optional(),
        supplierId: z.string().optional(),
        lowStock: z.coerce.boolean().optional(),
        inactive: z.coerce.boolean().optional(),
      })
      .parse(req.query);
    const products = await prisma.product.findMany({
      where: {
        storeId: req.auth.sid,
        active: q.inactive ? undefined : true,
        categoryId: q.categoryId,
        supplierId: q.supplierId,
        ...(q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: 'insensitive' } },
                { brand: { contains: q.q, mode: 'insensitive' } },
                { barcode: { startsWith: q.q } },
              ],
            }
          : {}),
      },
      include: { category: { select: { name: true } }, supplier: { select: { name: true } } },
      orderBy: { name: 'asc' },
      take: 1000,
    });
    const lots = await lotsByProduct(prisma, req.auth.sid, products.map((p) => p.id));
    const list = products.map((p) => productDto(p, lots));
    return q.lowStock ? list.filter((p) => p.stock <= p.minStock) : list;
  });

  /** Buscar por código de barras; si no existe y se pide, sugiere nombre desde Open Food Facts. */
  app.get('/products/barcode/:code', guard(), async (req) => {
    const { code } = req.params as { code: string };
    const { lookup } = req.query as { lookup?: string };
    const p = await prisma.product.findUnique({
      where: { storeId_barcode: { storeId: req.auth.sid, barcode: code } },
      include: { category: { select: { name: true } }, supplier: { select: { name: true } } },
    });
    if (p) return { product: productDto(p, await lotsByProduct(prisma, req.auth.sid, [p.id])), suggestion: null };
    return { product: null, suggestion: lookup ? await lookupBarcode(code) : null };
  });

  app.get('/products/:id', guard(), async (req) => {
    const { id } = req.params as { id: string };
    const p = await prisma.product.findFirst({
      where: { id, storeId: req.auth.sid },
      include: { category: { select: { name: true } }, supplier: { select: { name: true } } },
    });
    if (!p) throw notFound();
    const [lots, stockLots, movements, prices, names] = await Promise.all([
      lotsByProduct(prisma, req.auth.sid, [p.id]),
      prisma.lot.findMany({ where: { productId: p.id, qtyRemaining: { gt: 0 } } }),
      prisma.stockMovement.findMany({ where: { productId: p.id }, orderBy: { createdAt: 'desc' }, take: 40 }),
      prisma.priceChange.findMany({ where: { productId: p.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      userNames(prisma, req.auth.sid),
    ]);
    return {
      ...productDto(p, lots),
      lots: stockLots.sort(fefoCompare).map((l) => ({
        id: l.id,
        lotCode: l.lotCode,
        expiresAt: l.expiresAt,
        qtyRemaining: num(l.qtyRemaining),
        unitCost: num(l.unitCost),
        receivedAt: l.receivedAt,
      })),
      movements: movements.map((m) => ({ ...m, qty: num(m.qty), user: m.userId ? names.get(m.userId) ?? null : null })),
      priceHistory: prices.map((c) => ({ ...c, oldPrice: num(c.oldPrice), newPrice: num(c.newPrice), user: c.userId ? names.get(c.userId) ?? null : null })),
    };
  });

  app.post('/products', guard('stock', 'prices'), async (req) => {
    const b = productBody.parse(req.body);
    const p = await createProduct(req.auth.sid, b);
    publish(req.auth.sid, 'catalog');
    return productDto(p, new Map());
  });

  /** Editar producto. Cambiar el precio requiere el permiso "prices" y queda registrado. */
  app.patch('/products/:id', guard('stock', 'prices'), async (req) => {
    const { id } = req.params as { id: string };
    const b = productBody
      .partial()
      .extend({ active: z.boolean().optional(), priceSource: z.enum(['manual', 'margin']).optional() })
      .parse(req.body);
    const p = await prisma.product.findFirst({ where: { id, storeId: req.auth.sid } });
    if (!p) throw notFound();
    await checkRefs(req.auth.sid, b);
    const priceChanged = b.price !== undefined && b.price !== num(p.price);
    if (priceChanged && !can(req.auth, 'prices')) throw new HttpError(403, 'forbidden_prices');
    const { priceSource, ...data } = b;
    try {
      const updated = await prisma.$transaction(async (tx) => {
        if (priceChanged) {
          await tx.priceChange.create({
            data: { storeId: req.auth.sid, productId: id, oldPrice: p.price, newPrice: b.price!, source: priceSource ?? 'manual', userId: req.auth.uid },
          });
        }
        return tx.product.update({
          where: { id },
          data,
          include: { category: { select: { name: true } }, supplier: { select: { name: true } } },
        });
      });
      publish(req.auth.sid, 'catalog');
      return productDto(updated, await lotsByProduct(prisma, req.auth.sid, [id]));
    } catch (e) {
      if (isUniqueError(e)) throw new HttpError(409, 'barcode_taken');
      throw e;
    }
  });

  /** Suba o baja de precios en masa por porcentaje, con vista previa (dryRun). */
  app.post('/products/bulk-price', guard('prices'), async (req) => {
    const b = z
      .object({
        percent: z.number().min(-90).max(500).refine((v) => v !== 0),
        categoryId: z.string().nullish(),
        supplierId: z.string().nullish(),
        dryRun: z.boolean().default(true),
      })
      .parse(req.body);
    const { settings } = await storeCtx(prisma, req.auth.sid);
    const products = await prisma.product.findMany({
      where: { storeId: req.auth.sid, active: true, categoryId: b.categoryId ?? undefined, supplierId: b.supplierId ?? undefined },
      orderBy: { name: 'asc' },
    });
    const changes = products
      .map((p) => ({ id: p.id, name: p.name, oldPrice: num(p.price), newPrice: bulkPrice(num(p.price), b.percent, settings.priceRounding) }))
      .filter((c) => c.newPrice !== c.oldPrice);
    if (!b.dryRun && changes.length) {
      await prisma.$transaction([
        ...changes.map((c) => prisma.product.update({ where: { id: c.id }, data: { price: c.newPrice } })),
        prisma.priceChange.createMany({
          data: changes.map((c) => ({ storeId: req.auth.sid, productId: c.id, oldPrice: c.oldPrice, newPrice: c.newPrice, source: 'bulk', userId: req.auth.uid })),
        }),
      ]);
      publish(req.auth.sid, 'catalog');
    }
    return { count: changes.length, applied: !b.dryRun, changes: changes.slice(0, 100) };
  });

  /** Totales rápidos para el listado. */
  app.get('/products-summary', guard(), async (req) => {
    const products = await prisma.product.findMany({ where: { storeId: req.auth.sid, active: true }, select: { id: true, unallocatedSold: true, minStock: true } });
    const lots = await lotsByProduct(prisma, req.auth.sid);
    const low = products.filter((p) => stockOf(p, lots).stock <= num(p.minStock)).length;
    return { count: products.length, lowStock: low, negative: products.filter((p) => round3(num(p.unallocatedSold)) > 0).length };
  });
}

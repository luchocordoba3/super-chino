import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseContent } from '@almacen/shared';
import { num, numOrNull, prisma, type Prisma } from '../db';
import { can, guard } from '../lib/auth';
import { HttpError } from '../lib/http';
import { publish } from '../services/notify';
import { checkLowStock } from '../services/sales';
import { createStockEntry, type EntryItem } from '../services/stock';
import { storeCtx } from '../services/store';

const importRow = z.object({
  /** Número de fila en el archivo (para informar errores). */
  row: z.number().int(),
  barcode: z.string().trim().max(32).nullish(),
  name: z.string().trim().max(120).nullish(),
  price: z.number().min(0).max(1e10).nullish(),
  cost: z.number().min(0).max(1e10).nullish(),
  stock: z.number().min(0).max(1e7).nullish(),
  minStock: z.number().min(0).max(1e7).nullish(),
  idealStock: z.number().min(0).max(1e7).nullish(),
  category: z.string().trim().max(60).nullish(),
  supplier: z.string().trim().max(80).nullish(),
  unit: z.enum(['UNIT', 'KG']).nullish(),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
});

export async function importRoutes(app: FastifyInstance) {
  /**
   * Importar el catálogo desde una planilla (la web la lee y manda tandas de hasta 500 filas).
   * Crea o actualiza productos (por código de barras o, si no tiene, por nombre exacto), categorías y
   * proveedores, y opcionalmente carga el stock inicial como un ingreso.
   */
  app.post('/products/import', guard('stock'), async (req) => {
    if (!can(req.auth, 'prices')) throw new HttpError(403, 'forbidden_prices');
    const b = z
      .object({ rows: z.array(importRow).min(1).max(500), updatePrices: z.boolean().default(true), addStock: z.boolean().default(true) })
      .parse(req.body);
    const storeId = req.auth.sid;
    const { settings } = await storeCtx(prisma, storeId);
    const result = { created: 0, updated: 0, unchanged: 0, stockLines: 0, errors: [] as { row: number; error: string }[] };

    await prisma.$transaction(
      async (tx) => {
        const cats = new Map((await tx.category.findMany({ where: { storeId } })).map((c) => [c.name.toLowerCase(), c.id]));
        const sups = new Map((await tx.supplier.findMany({ where: { storeId } })).map((s) => [s.name.toLowerCase(), s.id]));
        const existing = await tx.product.findMany({ where: { storeId } });
        const byBarcode = new Map(existing.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
        const byName = new Map(existing.map((p) => [p.name.trim().toLowerCase(), p]));

        const ensure = async (kind: 'category' | 'supplier', name: string | null | undefined) => {
          if (!name) return undefined;
          const map = kind === 'category' ? cats : sups;
          const key = name.toLowerCase();
          let id = map.get(key);
          if (!id) {
            id = kind === 'category' ? (await tx.category.create({ data: { storeId, name } })).id : (await tx.supplier.create({ data: { storeId, name } })).id;
            map.set(key, id);
          }
          return id;
        };

        const priceChanges: Prisma.PriceChangeCreateManyInput[] = [];
        const stockItems: EntryItem[] = [];
        for (const r of b.rows) {
          const barcode = r.barcode?.replace(/\s/g, '') || null;
          const found = (barcode ? byBarcode.get(barcode) : undefined) ?? (r.name ? byName.get(r.name.toLowerCase()) : undefined);
          const categoryId = await ensure('category', r.category);
          const supplierId = await ensure('supplier', r.supplier);
          let productId: string;
          if (!found) {
            if (!r.name || r.price == null) {
              result.errors.push({ row: r.row, error: !r.name ? 'missing_name' : 'missing_price' });
              continue;
            }
            const content = parseContent(r.name);
            const p = await tx.product.create({
              data: {
                storeId,
                barcode,
                name: r.name,
                price: r.price,
                cost: r.cost ?? 0,
                minStock: r.minStock ?? 0,
                idealStock: r.idealStock ?? null,
                unit: r.unit ?? 'UNIT',
                categoryId: categoryId ?? null,
                supplierId: supplierId ?? null,
                contentQty: content?.qty ?? null,
                contentUnit: content?.unit ?? null,
              },
            });
            if (barcode) byBarcode.set(barcode, p);
            byName.set(p.name.toLowerCase(), p);
            productId = p.id;
            result.created++;
          } else {
            const data: Prisma.ProductUncheckedUpdateInput = {};
            if (r.name && r.name !== found.name) {
              data.name = r.name;
              const content = found.contentQty == null ? parseContent(r.name) : null;
              if (content) Object.assign(data, { contentQty: content.qty, contentUnit: content.unit });
            }
            if (barcode && !found.barcode && !byBarcode.has(barcode)) data.barcode = barcode;
            if (b.updatePrices && r.price != null && r.price !== num(found.price)) {
              data.price = r.price;
              priceChanges.push({ storeId, productId: found.id, oldPrice: found.price, newPrice: r.price, source: 'import', userId: req.auth.uid });
            }
            if (r.cost != null && r.cost !== num(found.cost)) data.cost = r.cost;
            if (r.minStock != null && r.minStock !== num(found.minStock)) data.minStock = r.minStock;
            if (r.idealStock != null && r.idealStock !== numOrNull(found.idealStock)) data.idealStock = r.idealStock;
            if (r.unit && r.unit !== found.unit) data.unit = r.unit;
            if (categoryId && categoryId !== found.categoryId) data.categoryId = categoryId;
            if (supplierId && supplierId !== found.supplierId) data.supplierId = supplierId;
            if (!found.active) data.active = true;
            if (Object.keys(data).length) {
              const p = await tx.product.update({ where: { id: found.id }, data });
              if (p.barcode) byBarcode.set(p.barcode, p);
              byName.set(p.name.toLowerCase(), p);
              result.updated++;
            } else {
              result.unchanged++;
            }
            productId = found.id;
          }
          if (b.addStock && r.stock && r.stock > 0) {
            stockItems.push({ productId, qty: r.stock, unitCost: r.cost ?? null, expiresAt: r.expiresAt ?? null });
          }
        }
        if (priceChanges.length) await tx.priceChange.createMany({ data: priceChanges });
        if (stockItems.length) {
          await createStockEntry(tx, { storeId, userId: req.auth.uid, settings, invoiceNumber: 'Importación', items: stockItems });
          await checkLowStock(tx, storeId, [...new Set(stockItems.map((i) => i.productId))]);
          result.stockLines = stockItems.length;
        }
      },
      { timeout: 120_000 },
    );
    publish(storeId, 'catalog');
    return result;
  });
}

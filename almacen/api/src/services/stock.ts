import type { MovementType } from '../generated/prisma/index.js';
import { round3, type StoreSettings } from '@almacen/shared';
import { num, Prisma, type Db, type Tx } from '../db';
import { dateOnly } from '../domain/dates';
import { allocateFefo, type Allocation } from '../domain/fefo';
import { marginPrice } from '../domain/pricing';
import { badRequest, notFound } from '../lib/http';
import { resolveAlert } from './alerts';

/** Stock por producto a partir de los lotes (sin restar lo vendido sin stock). */
export async function lotsByProduct(db: Db, storeId: string, productIds?: string[]) {
  const groups = await db.lot.groupBy({
    by: ['productId'],
    where: { storeId, qtyRemaining: { gt: 0 }, ...(productIds ? { productId: { in: productIds } } : {}) },
    _sum: { qtyRemaining: true },
    _min: { expiresAt: true },
  });
  return new Map(groups.map((g) => [g.productId, { lotsQty: num(g._sum.qtyRemaining), nearestExpiry: g._min.expiresAt }]));
}
export type LotsMap = Awaited<ReturnType<typeof lotsByProduct>>;

/** Stock real = suma de lotes - vendido sin stock registrado. */
export function stockOf(p: { id: string; unallocatedSold: Prisma.Decimal | number }, lots: LotsMap) {
  const s = lots.get(p.id);
  return { stock: round3((s?.lotsQty ?? 0) - num(p.unallocatedSold)), nearestExpiry: s?.nearestExpiry ?? null };
}

interface AddLotArgs {
  storeId: string;
  productId: string;
  qty: number;
  unitCost: number;
  lotCode?: string | null;
  expiresAt?: Date | null;
  stockEntryId?: string | null;
  userId?: string | null;
  type: MovementType;
  refId?: string | null;
  reason?: string | null;
}

/** Suma stock en un lote nuevo. Primero compensa lo que se había vendido sin stock. */
export async function addLot(tx: Tx, a: AddLotArgs) {
  const qty = round3(a.qty);
  const p = await tx.product.findUniqueOrThrow({ where: { id: a.productId }, select: { id: true, unallocatedSold: true } });
  const owed = num(p.unallocatedSold);
  const comp = Math.min(owed, qty);
  if (comp > 0) {
    await tx.product.update({ where: { id: p.id }, data: { unallocatedSold: { decrement: comp } } });
    if (owed - comp <= 0) await resolveAlert(tx, a.storeId, `NEGATIVE_STOCK:${p.id}`);
  }
  const lot = await tx.lot.create({
    data: {
      storeId: a.storeId,
      productId: a.productId,
      stockEntryId: a.stockEntryId ?? null,
      lotCode: a.lotCode || null,
      expiresAt: a.expiresAt ?? null,
      qtyInitial: qty,
      qtyRemaining: round3(qty - comp),
      unitCost: a.unitCost,
    },
  });
  await tx.stockMovement.create({
    data: { storeId: a.storeId, productId: a.productId, lotId: lot.id, type: a.type, qty, unitCost: a.unitCost, refId: a.refId ?? null, userId: a.userId ?? null, reason: a.reason ?? null },
  });
  return lot;
}

export interface EntryItem {
  productId: string;
  qty: number;
  unitCost?: number | null;
  lotCode?: string | null;
  expiresAt?: string | null;
}
export interface PriceSuggestion {
  productId: string;
  name: string;
  oldPrice: number;
  suggestedPrice: number;
  cost: number;
}

/** Ingreso de mercadería: crea un lote por renglón y sugiere precios si subió el costo. */
export async function createStockEntry(
  tx: Tx,
  a: { storeId: string; userId: string; settings: StoreSettings; supplierId?: string | null; invoiceNumber?: string | null; invoiceScanId?: string | null; items: EntryItem[] },
) {
  const ids = [...new Set(a.items.map((i) => i.productId))];
  const products = await tx.product.findMany({ where: { storeId: a.storeId, id: { in: ids } } });
  if (products.length !== ids.length) throw notFound('product_not_found');
  if (a.supplierId && !(await tx.supplier.findFirst({ where: { id: a.supplierId, storeId: a.storeId } }))) throw notFound('supplier_not_found');
  const byId = new Map(products.map((p) => [p.id, p]));

  const entry = await tx.stockEntry.create({
    data: { storeId: a.storeId, userId: a.userId, supplierId: a.supplierId ?? null, invoiceNumber: a.invoiceNumber || null, invoiceScanId: a.invoiceScanId ?? null },
  });
  const suggestions = new Map<string, PriceSuggestion>();
  for (const it of a.items) {
    const p = byId.get(it.productId)!;
    const unitCost = it.unitCost ?? num(p.cost);
    await addLot(tx, {
      storeId: a.storeId,
      productId: p.id,
      qty: it.qty,
      unitCost,
      lotCode: it.lotCode,
      expiresAt: it.expiresAt ? dateOnly(it.expiresAt) : null,
      stockEntryId: entry.id,
      userId: a.userId,
      type: 'ENTRY',
      refId: entry.id,
    });
    const newSupplier = a.supplierId && !p.supplierId ? { supplierId: a.supplierId } : {};
    if (it.unitCost != null && it.unitCost > 0) {
      await tx.product.update({ where: { id: p.id }, data: { cost: it.unitCost, ...newSupplier } });
      const margin = p.targetMargin != null ? num(p.targetMargin) : a.settings.targetMargin;
      const suggested = marginPrice(it.unitCost, margin, a.settings.priceRounding);
      const prev = suggestions.get(p.id);
      if (suggested > num(p.price) && (!prev || suggested > prev.suggestedPrice)) {
        suggestions.set(p.id, { productId: p.id, name: p.name, oldPrice: num(p.price), suggestedPrice: suggested, cost: it.unitCost });
      }
    } else if (newSupplier.supplierId) {
      await tx.product.update({ where: { id: p.id }, data: newSupplier });
    }
  }
  // El 100% automático del stock en %: lo que quedó después de reponer.
  const fresh = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, unallocatedSold: true } });
  const lots = await lotsByProduct(tx, a.storeId, ids);
  for (const p of fresh) {
    await tx.product.update({ where: { id: p.id }, data: { refStock: Math.max(0, stockOf(p, lots).stock) } });
    await resolveAlert(tx, a.storeId, `SHORTAGE:${p.id}`);
  }
  return { entryId: entry.id, suggestions: [...suggestions.values()] };
}

/**
 * Descuenta stock por FEFO (o de un lote puntual) con los lotes bloqueados (SELECT ... FOR UPDATE).
 * Solo las ventas pueden dejar "vendido sin stock"; ajustes y mermas se limitan a lo que hay.
 */
export async function consumeStock(
  tx: Tx,
  a: { storeId: string; productId: string; qty: number; today: Date; type: MovementType; refId?: string | null; userId?: string | null; reason?: string | null; lotId?: string },
): Promise<Allocation[]> {
  const rows = await tx.$queryRaw<Array<{ id: string; expiresAt: Date | null; receivedAt: Date; qtyRemaining: unknown; unitCost: unknown }>>`
    SELECT id, "expiresAt", "receivedAt", "qtyRemaining", "unitCost" FROM "Lot"
    WHERE "storeId" = ${a.storeId} AND "productId" = ${a.productId} AND "qtyRemaining" > 0
    ${a.lotId ? Prisma.sql`AND id = ${a.lotId}` : Prisma.empty}
    ORDER BY id FOR UPDATE`;
  const lots = rows.map((r) => ({ id: r.id, expiresAt: r.expiresAt, receivedAt: r.receivedAt, qtyRemaining: Number(r.qtyRemaining), unitCost: Number(r.unitCost) }));
  const product = await tx.product.findUniqueOrThrow({ where: { id: a.productId }, select: { cost: true } });
  let allocations = allocateFefo(lots, a.qty, a.lotId ? new Date(0) : a.today, num(product.cost));
  if (a.type !== 'SALE') allocations = allocations.filter((x) => x.lotId);
  for (const al of allocations) {
    if (al.lotId) await tx.lot.update({ where: { id: al.lotId }, data: { qtyRemaining: { decrement: al.qty } } });
    else await tx.product.update({ where: { id: a.productId }, data: { unallocatedSold: { increment: al.qty } } });
    await tx.stockMovement.create({
      data: { storeId: a.storeId, productId: a.productId, lotId: al.lotId, type: a.type, qty: -al.qty, unitCost: al.unitCost, refId: a.refId ?? null, userId: a.userId ?? null, reason: a.reason ?? null },
    });
  }
  return allocations;
}

/** Devuelve al stock lo que se había descontado (anulación de venta). */
export async function restoreAllocations(
  tx: Tx,
  a: { storeId: string; productId: string; allocations: Allocation[]; refId: string; userId?: string | null },
) {
  for (const al of positive(a.allocations)) {
    if (al.lotId) {
      await tx.lot.update({ where: { id: al.lotId }, data: { qtyRemaining: { increment: al.qty } } });
      await tx.stockMovement.create({ data: { storeId: a.storeId, productId: a.productId, lotId: al.lotId, type: 'VOID', qty: al.qty, unitCost: al.unitCost, refId: a.refId, userId: a.userId ?? null } });
      continue;
    }
    // Vendido sin stock: primero se descuenta de la deuda; si ya se compensó con un ingreso, vuelve como lote nuevo.
    const p = await tx.product.findUniqueOrThrow({ where: { id: a.productId }, select: { unallocatedSold: true } });
    const back = Math.min(num(p.unallocatedSold), al.qty);
    if (back > 0) {
      await tx.product.update({ where: { id: a.productId }, data: { unallocatedSold: { decrement: back } } });
      await tx.stockMovement.create({ data: { storeId: a.storeId, productId: a.productId, lotId: null, type: 'VOID', qty: back, unitCost: al.unitCost, refId: a.refId, userId: a.userId ?? null } });
    }
    const rest = round3(al.qty - back);
    if (rest > 0) await addLot(tx, { storeId: a.storeId, productId: a.productId, qty: rest, unitCost: al.unitCost, type: 'VOID', refId: a.refId, userId: a.userId, lotCode: 'ANULACION' });
  }
}
const positive = (x: Allocation[]) => x.filter((al) => al.qty > 0);

/** Ajuste manual: negativo saca por FEFO, positivo suma un lote. */
export async function adjustStock(
  tx: Tx,
  a: { storeId: string; productId: string; qty: number; today: Date; type: 'ADJUSTMENT' | 'WASTE' | 'COUNT'; userId: string; reason?: string | null; lotId?: string },
) {
  if (a.qty === 0) throw badRequest('qty_zero');
  if (a.qty < 0) return consumeStock(tx, { ...a, qty: -a.qty });
  if (a.type === 'WASTE') throw badRequest('waste_must_be_negative');
  const p = await tx.product.findUniqueOrThrow({ where: { id: a.productId }, select: { cost: true } });
  const last = await tx.lot.findFirst({ where: { productId: a.productId, expiresAt: { not: null } }, orderBy: { receivedAt: 'desc' } });
  await addLot(tx, { storeId: a.storeId, productId: a.productId, qty: a.qty, unitCost: num(p.cost), expiresAt: last?.expiresAt ?? null, lotCode: 'AJUSTE', type: a.type, userId: a.userId, reason: a.reason });
  return [];
}

import { num, type Db } from '../db';
import { addDays, daysBetween } from '../domain/dates';

/** Venta diaria promedio por producto en los últimos días (mínimo 7 días de base). */
export async function avgDailySales(db: Db, storeId: string, productIds?: string[], window = 28) {
  const since = addDays(new Date(), -window);
  const [rows, first] = await Promise.all([
    db.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { storeId, status: 'COMPLETED', occurredAt: { gte: since } }, ...(productIds ? { productId: { in: productIds } } : {}) },
      _sum: { qty: true },
    }),
    db.sale.findFirst({ where: { storeId }, orderBy: { occurredAt: 'asc' }, select: { occurredAt: true } }),
  ]);
  const span = Math.min(window, Math.max(7, first ? daysBetween(first.occurredAt, new Date()) : 7));
  return new Map(rows.map((r) => [r.productId, num(r._sum.qty) / span]));
}

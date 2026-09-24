import { num, prisma } from '../db';
import { addDays } from '../domain/dates';
import { pickCountProducts } from '../domain/antiloss';
import { afterCreate, createMessage } from './messages';
import { avgDailySales } from './stats';

/** Crea un conteo sorpresa (productos elegidos o al azar ponderado) y la tarea para el equipo. */
export async function createStockCount(storeId: string, recipientIds: string[], opts: { productIds?: string[]; n?: number } = {}) {
  let ids = opts.productIds;
  if (!ids) {
    const products = await prisma.product.findMany({ where: { storeId, active: true }, select: { id: true, price: true } });
    const since = addDays(new Date(), -7);
    const [perDay, recent, diffs] = await Promise.all([
      avgDailySales(prisma, storeId),
      prisma.stockCountItem.findMany({ where: { count: { storeId, createdAt: { gte: since } } }, select: { productId: true } }),
      prisma.stockCountItem.findMany({ where: { count: { storeId }, difference: { not: 0 } }, select: { productId: true } }),
    ]);
    const recentSet = new Set(recent.map((r) => r.productId));
    const diffSet = new Set(diffs.map((d) => d.productId));
    ids = pickCountProducts(
      products.map((p) => ({ id: p.id, price: num(p.price), perDay: perDay.get(p.id) ?? 0, hadDiff: diffSet.has(p.id), countedRecently: recentSet.has(p.id) })),
      opts.n ?? 5,
    );
  }
  if (!ids.length || !recipientIds.length) return null;
  const products = await prisma.product.findMany({ where: { storeId, id: { in: ids } }, select: { id: true, name: true } });
  const count = await prisma.stockCount.create({ data: { storeId, items: { create: products.map((p) => ({ productId: p.id })) } } });
  const { message, needsTranslation } = await createMessage(prisma, {
    storeId,
    fromUserId: null,
    kind: 'TASK',
    text: products.map((p) => `• ${p.name}`).join('\n'),
    lang: 'es',
    recipientIds,
    meta: { type: 'COUNT', countId: count.id },
  });
  await prisma.stockCount.update({ where: { id: count.id }, data: { messageId: message.id } });
  afterCreate(storeId, message.id, needsTranslation);
  return count.id;
}


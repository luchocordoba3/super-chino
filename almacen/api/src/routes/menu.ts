import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseSettings, round2 } from '@almacen/shared';
import { num, prisma } from '../db';
import { env } from '../env';
import { guard } from '../lib/auth';
import { randomToken } from '../lib/crypto';
import { HttpError, notFound } from '../lib/http';
import { publish } from '../services/notify';
import { lotsByProduct, stockOf } from '../services/stock';

/** Rutas públicas de la carta: límite por IP para que nadie sature la caja de pedidos. */
const limit = (max: number) => ({ config: { rateLimit: { max: env.isTest ? 10_000 : max, timeWindow: '1 minute' } } });

/** Mesa del token de la carta (el QR de la mesa). */
async function tableOf(token: string) {
  const t = await prisma.menuTable.findUnique({ where: { token } });
  if (!t) throw notFound('menu_not_found');
  const store = await prisma.store.findUniqueOrThrow({ where: { id: t.storeId } });
  // Si el dueño bajó la cantidad de mesas, el QR de esa mesa deja de andar.
  if (t.table > parseSettings(store.settings).tables) throw notFound('menu_not_found');
  return { ...t, store };
}

export async function menuRoutes(app: FastifyInstance) {
  // ---------- Dueño: un QR de la carta por mesa ----------
  app.get('/menu/tables', guard('owner'), async (req) => {
    const storeId = req.auth.sid;
    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    const n = parseSettings(store.settings).tables;
    const existing = await prisma.menuTable.findMany({ where: { storeId } });
    for (let table = 1; table <= n; table++) {
      if (!existing.some((t) => t.table === table)) existing.push(await prisma.menuTable.create({ data: { storeId, table, token: randomToken(12) } }));
    }
    return existing.filter((t) => t.table <= n).sort((a, b) => a.table - b.table).map((t) => ({ table: t.table, path: `/m/${t.token}` }));
  });

  /** QR nuevo para una mesa (si alguien se llevó una foto del QR y manda pedidos en broma). */
  app.post('/menu/tables/:table/rotate', guard('owner'), async (req) => {
    const table = z.coerce.number().int().min(1).max(99).parse((req.params as { table: string }).table);
    const t = await prisma.menuTable.findUnique({ where: { storeId_table: { storeId: req.auth.sid, table } } });
    if (!t) throw notFound();
    const updated = await prisma.menuTable.update({ where: { id: t.id }, data: { token: randomToken(12) } });
    return { table, path: `/m/${updated.token}` };
  });

  // ---------- Cliente: la carta de la mesa (sin cuenta ni app) ----------
  app.get('/public/menu/:token', limit(120), async (req) => {
    const t = await tableOf((req.params as { token: string }).token);
    const storeId = t.storeId;
    const [products, categories, tab, payQr] = await Promise.all([
      prisma.product.findMany({ where: { storeId, active: true, menu: true }, include: { _count: { select: { recipe: true } } }, orderBy: { name: 'asc' } }),
      prisma.category.findMany({ where: { storeId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.tab.findFirst({ where: { storeId, table: t.table, status: 'OPEN' }, include: { items: { where: { status: { in: ['OK', 'PENDING'] } }, orderBy: { createdAt: 'asc' } } } }),
      prisma.mpPos.count({ where: { storeId, table: t.table } }),
    ]);
    const lots = await lotsByProduct(prisma, storeId, products.map((p) => p.id));
    const items = tab?.items.map((i) => ({ name: i.name, qty: num(i.qty), unitPrice: num(i.unitPrice), pending: i.status === 'PENDING' })) ?? [];
    return {
      store: { name: t.store.name, currency: t.store.currency },
      table: t.table,
      categories: categories.filter((c) => products.some((p) => p.categoryId === c.id)),
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        price: num(p.price),
        unit: p.unit,
        categoryId: p.categoryId,
        // Lo preparado (con receta) siempre se ofrece; lo demás, si hay stock.
        available: p._count.recipe > 0 || stockOf(p, lots).stock > 0,
      })),
      tab: tab ? { items, total: round2(items.filter((i) => !i.pending).reduce((s, i) => s + i.qty * i.unitPrice, 0)), billRequested: !!tab.billAt } : null,
      payQr: payQr > 0,
    };
  });

  /** El cliente pide desde la mesa: queda "pendiente" en la cuenta hasta que el vendedor lo acepta. */
  app.post('/public/menu/:token/order', limit(10), async (req) => {
    const t = await tableOf((req.params as { token: string }).token);
    const b = z.object({ items: z.array(z.object({ productId: z.string().min(1), qty: z.number().int().min(1).max(20) })).min(1).max(20) }).parse(req.body);
    const ids = [...new Set(b.items.map((i) => i.productId))];
    const products = await prisma.product.findMany({ where: { storeId: t.storeId, id: { in: ids }, active: true, menu: true } });
    if (products.length !== ids.length) throw notFound('product_not_found');
    const byId = new Map(products.map((p) => [p.id, p]));
    await prisma.$transaction(async (tx) => {
      const tab =
        (await tx.tab.findFirst({ where: { storeId: t.storeId, table: t.table, status: 'OPEN' } })) ??
        (await tx.tab.create({ data: { id: randomUUID(), storeId: t.storeId, label: `Mesa ${t.table}`, table: t.table, openedAt: new Date(), openedBy: 'menu' } }));
      const pending = await tx.tabItem.count({ where: { tabId: tab.id, status: 'PENDING' } });
      if (pending + b.items.length > 40) throw new HttpError(429, 'too_many_pending');
      for (const it of b.items) {
        const p = byId.get(it.productId)!;
        await tx.tabItem.create({ data: { id: randomUUID(), tabId: tab.id, productId: p.id, name: p.name, qty: it.qty, unitPrice: p.price, status: 'PENDING', addedBy: null } });
      }
    });
    publish(t.storeId, 'tabs');
    return { ok: true };
  });

  /** "Pedir la cuenta": la caja lo ve en la mesa. */
  app.post('/public/menu/:token/bill', limit(5), async (req) => {
    const t = await tableOf((req.params as { token: string }).token);
    const r = await prisma.tab.updateMany({ where: { storeId: t.storeId, table: t.table, status: 'OPEN' }, data: { billAt: new Date() } });
    if (r.count === 0) throw notFound('no_open_tab');
    publish(t.storeId, 'tabs');
    return { ok: true };
  });
}

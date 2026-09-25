import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseSettings, round2 } from '@almacen/shared';
import { type Db, num, prisma } from '../db';
import { env } from '../env';
import { deviceGuard, guard } from '../lib/auth';
import { randomToken } from '../lib/crypto';
import { HttpError, notFound } from '../lib/http';
import { publish } from '../services/notify';
import { lotsByProduct, stockOf } from '../services/stock';

const limit = (max: number) => ({ config: { rateLimit: { max: env.isTest ? 10_000 : max, timeWindow: '1 minute' } } });
const digits = (s: string) => s.replace(/\D/g, '');
export const ORDER_STATUSES = ['NEW', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'] as const;
const PAYMENTS = ['CASH', 'QR', 'TRANSFER'] as const;

async function shopOf(slug: string) {
  const store = await prisma.store.findUnique({ where: { shopSlug: slug } });
  if (!store) throw notFound('shop_not_found');
  return store;
}

/** Pedidos abiertos (y los cerrados de hoy) con sus renglones. */
async function openOrders(db: Db, storeId: string) {
  const since = new Date(Date.now() - 12 * 3_600_000);
  const rows = await db.order.findMany({
    where: { storeId, OR: [{ status: { in: ['NEW', 'PREPARING', 'READY'] } }, { updatedAt: { gte: since } }] },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((o) => ({
    id: o.id,
    number: o.number,
    name: o.name,
    phone: o.phone,
    delivery: o.delivery,
    address: o.address,
    payment: o.payment,
    note: o.note,
    status: o.status,
    total: num(o.total),
    createdAt: o.createdAt,
    items: o.items.map((i) => ({ productId: i.productId, name: i.name, qty: num(i.qty), unitPrice: num(i.unitPrice) })),
  }));
}

async function setStatus(storeId: string, id: string, status: (typeof ORDER_STATUSES)[number]) {
  const r = await prisma.order.updateMany({ where: { id, storeId, status: { notIn: ['DELIVERED', 'CANCELLED'] } }, data: { status } });
  if (r.count === 0) throw notFound();
  publish(storeId, 'orders');
  return { ok: true };
}

export async function shopRoutes(app: FastifyInstance) {
  // ---------- Dueño: prender el link de pedidos ----------
  app.get('/shop', guard('owner'), async (req) => {
    const s = await prisma.store.findUniqueOrThrow({ where: { id: req.auth.sid } });
    return { path: s.shopSlug ? `/p/${s.shopSlug}` : null };
  });
  app.post('/shop', guard('owner'), async (req) => {
    const b = z.object({ renew: z.boolean().optional() }).parse(req.body ?? {});
    const s = await prisma.store.findUniqueOrThrow({ where: { id: req.auth.sid } });
    const slug = !s.shopSlug || b.renew ? randomToken(8) : s.shopSlug;
    await prisma.store.update({ where: { id: s.id }, data: { shopSlug: slug } });
    return { path: `/p/${slug}` };
  });
  app.delete('/shop', guard('owner'), async (req) => {
    await prisma.store.update({ where: { id: req.auth.sid }, data: { shopSlug: null } });
    return { ok: true };
  });

  // ---------- Cliente: catálogo con precios y stock reales ----------
  app.get('/public/shop/:slug', limit(120), async (req) => {
    const store = await shopOf((req.params as { slug: string }).slug);
    const settings = parseSettings(store.settings);
    const [products, categories] = await Promise.all([
      prisma.product.findMany({ where: { storeId: store.id, active: true, price: { gt: 0 } }, include: { _count: { select: { recipe: true } } }, orderBy: { name: 'asc' } }),
      prisma.category.findMany({ where: { storeId: store.id }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const lots = await lotsByProduct(prisma, store.id, products.map((p) => p.id));
    return {
      store: { name: store.name, currency: store.currency },
      whatsapp: digits(settings.shopWhatsapp),
      delivery: settings.shopDelivery,
      note: settings.shopNote,
      categories: categories.filter((c) => products.some((p) => p.categoryId === c.id)),
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        price: num(p.price),
        unit: p.unit,
        categoryId: p.categoryId,
        available: p._count.recipe > 0 || stockOf(p, lots).stock > 0,
      })),
    };
  });

  app.post('/public/shop/:slug/orders', limit(5), async (req) => {
    const store = await shopOf((req.params as { slug: string }).slug);
    const settings = parseSettings(store.settings);
    const b = z
      .object({
        name: z.string().trim().min(2).max(60),
        phone: z.string().trim().min(6).max(25),
        delivery: z.boolean(),
        address: z.string().trim().max(160).optional(),
        payment: z.enum(PAYMENTS),
        note: z.string().trim().max(300).optional(),
        items: z.array(z.object({ productId: z.string().min(1), qty: z.number().positive().max(100) })).min(1).max(60),
      })
      .parse(req.body);
    if (b.delivery && !settings.shopDelivery) throw new HttpError(400, 'no_delivery');
    if (b.delivery && !b.address) throw new HttpError(400, 'address_required');
    const ids = [...new Set(b.items.map((i) => i.productId))];
    const products = await prisma.product.findMany({ where: { storeId: store.id, id: { in: ids }, active: true } });
    if (products.length !== ids.length) throw notFound('product_not_found');
    const byId = new Map(products.map((p) => [p.id, p]));
    const lines = b.items.map((i) => {
      const p = byId.get(i.productId)!;
      // Por kilo se aceptan decimales; por unidad, enteros.
      const qty = p.unit === 'KG' ? Math.round(i.qty * 1000) / 1000 : Math.round(i.qty);
      return { productId: p.id, name: p.name, qty: Math.max(p.unit === 'KG' ? 0.001 : 1, qty), unitPrice: num(p.price) };
    });
    const total = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
    // Número correlativo del local; si dos pedidos llegan juntos, se reintenta.
    for (let attempt = 0; ; attempt++) {
      try {
        const order = await prisma.$transaction(async (tx) => {
          const last = await tx.order.findFirst({ where: { storeId: store.id }, orderBy: { number: 'desc' }, select: { number: true } });
          return tx.order.create({
            data: {
              storeId: store.id,
              number: (last?.number ?? 0) + 1,
              name: b.name,
              phone: digits(b.phone),
              delivery: b.delivery,
              address: b.delivery ? b.address : null,
              payment: b.payment,
              note: b.note || null,
              total,
              items: { create: lines },
            },
          });
        });
        publish(store.id, 'orders');
        return { id: order.id, number: order.number, total };
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002' || attempt >= 3) throw e;
      }
    }
  });

  // ---------- Equipo (celular) y caja: preparar, avisar y entregar ----------
  app.get('/orders', guard('sell'), async (req) => openOrders(prisma, req.auth.sid));
  app.post('/orders/:id/status', guard('sell'), async (req) => {
    const b = z.object({ status: z.enum(['PREPARING', 'READY', 'CANCELLED']) }).parse(req.body);
    return setStatus(req.auth.sid, (req.params as { id: string }).id, b.status);
  });
  app.get('/pos/orders', deviceGuard, async (req) => openOrders(prisma, req.device.storeId));
  app.post('/pos/orders/:id/status', deviceGuard, async (req) => {
    const b = z.object({ status: z.enum(['PREPARING', 'READY', 'CANCELLED']) }).parse(req.body);
    return setStatus(req.device.storeId, (req.params as { id: string }).id, b.status);
  });
}

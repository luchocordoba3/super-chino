// Números de la casa de celulares: ganancia por equipo en dólares, stock y antigüedad, vendedores, técnicos, tomas y cadetes.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { agingBucket, type Payment, round2, toUsd } from '@super-chino/shared';
import { num, prisma } from '../db';
import { addDays, dateOnly, startOfLocalDay } from '../domain/dates';
import { guard } from '../lib/auth';
import { storeRate } from '../services/fx';
import { storeCtx, userNames } from '../services/store';

const Range = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Suma por clave. */
function bump<T extends Record<string, number>>(map: Map<string, T>, key: string, init: () => T, add: Partial<T>) {
  const row = map.get(key) ?? init();
  for (const [k, v] of Object.entries(add)) (row as Record<string, number>)[k] = round2(((row as Record<string, number>)[k] ?? 0) + (v as number));
  map.set(key, row);
}

export async function phoneReportRoutes(app: FastifyInstance) {
  app.get('/phone-reports', guard('reports'), async (req) => {
    const q = Range.parse(req.query);
    const storeId = req.auth.sid;
    const { store, settings } = await storeCtx(prisma, storeId);
    const tz = store.timezone;
    const from = q.from ? startOfLocalDay(tz, new Date(dateOnly(q.from).getTime() + 12 * 3_600_000)) : startOfLocalDay(tz);
    const to = q.to ? addDays(startOfLocalDay(tz, new Date(dateOnly(q.to).getTime() + 12 * 3_600_000)), 1) : addDays(from, 1);
    const { rate: rateNow } = await storeRate(storeId);
    const [sales, names, categories] = await Promise.all([
      prisma.sale.findMany({
        where: { storeId, status: 'COMPLETED', occurredAt: { gte: from, lt: to } },
        include: { items: { include: { product: { select: { name: true, categoryId: true, serialized: true, isService: true } } } } },
      }),
      userNames(prisma, storeId),
      prisma.category.findMany({ where: { storeId }, select: { id: true, name: true } }),
    ]);
    const catName = new Map(categories.map((c) => [c.id, c.name]));

    // ---------- Ventas ----------
    let total = 0;
    let cost = 0;
    let totalUsd = 0;
    let profitUsd = 0;
    let surcharge = 0;
    const bySeller = new Map<string, { count: number; total: number; profit: number; commission: number }>();
    const byChannel = new Map<string, { count: number; total: number }>();
    const byMethod = new Map<string, { amount: number; usd: number }>();
    const byModel = new Map<string, { units: number; revenueUsd: number; profitUsd: number }>();
    const byCategory = new Map<string, { total: number; profit: number }>();
    const units: { saleId: string; serialItemId: string | null; date: Date; name: string; imei: string | null; priceArs: number; rate: number | null; priceUsd: number; costUsd: number; profitUsd: number; seller: string | null }[] = [];
    const serialIds = sales.flatMap((s) => s.items.flatMap((i) => (i.serialItemId ? [i.serialItemId] : [])));
    const serials = new Map((await prisma.serialItem.findMany({ where: { id: { in: serialIds } }, select: { id: true, imei1: true, serial: true, origin: true, receivedAt: true } })).map((s) => [s.id, s]));

    for (const s of sales) {
      const rate = s.rate == null ? rateNow : num(s.rate);
      const t = num(s.total);
      const c = num(s.costTotal);
      total += t;
      cost += c;
      surcharge += num(s.surcharge);
      totalUsd += toUsd(t, rate);
      profitUsd += toUsd(t - c, rate);
      let commission = 0;
      for (const it of s.items) {
        const line = num(it.lineTotal);
        const lineCost = num(it.cost);
        const cat = it.product.categoryId;
        const pct = (cat ? settings.commissionByCategory[cat] : undefined) ?? settings.commissionPct;
        commission += (line * pct) / 100;
        bump(byCategory, cat ? (catName.get(cat) ?? '—') : 'Sin categoría', () => ({ total: 0, profit: 0 }), { total: line, profit: line - lineCost });
        if (it.serialItemId || it.product.serialized) {
          bump(byModel, it.name, () => ({ units: 0, revenueUsd: 0, profitUsd: 0 }), { units: num(it.qty), revenueUsd: toUsd(line, rate), profitUsd: toUsd(line - lineCost, rate) });
          const sr = it.serialItemId ? serials.get(it.serialItemId) : undefined;
          units.push({
            saleId: s.id,
            serialItemId: it.serialItemId,
            date: s.occurredAt,
            name: it.name,
            imei: sr?.imei1 ?? sr?.serial ?? null,
            priceArs: line,
            rate,
            priceUsd: toUsd(line, rate),
            costUsd: toUsd(lineCost, rate),
            profitUsd: toUsd(line - lineCost, rate),
            seller: names.get(s.userId) ?? null,
          });
        }
      }
      bump(bySeller, s.userId, () => ({ count: 0, total: 0, profit: 0, commission: 0 }), { count: 1, total: t, profit: t - c, commission });
      bump(byChannel, s.channel, () => ({ count: 0, total: 0 }), { count: 1, total: t });
      for (const p of s.payments as Payment[]) {
        const key = p.currency === 'USD' ? `${p.method}_USD` : p.method;
        bump(byMethod, key, () => ({ amount: 0, usd: 0 }), { amount: p.amount, usd: p.fx ?? 0 });
      }
    }

    // ---------- Stock valorizado y antigüedad ----------
    const inStock = await prisma.serialItem.findMany({
      where: { storeId, status: { in: ['AVAILABLE', 'RESERVED', 'IN_REPAIR', 'RMA'] } },
      include: { product: { select: { name: true, currency: true, price: true } } },
    });
    const now = Date.now();
    const aging = new Map<string, { units: number; costUsd: number }>();
    let stockCostUsd = 0;
    let stockPriceUsd = 0;
    const aged: { id: string; name: string; imei: string | null; days: number; costUsd: number; status: string }[] = [];
    for (const u of inStock) {
      const days = Math.floor((now - u.receivedAt.getTime()) / 86_400_000);
      const usd = u.product.currency === 'USD' ? num(u.cost) : toUsd(num(u.cost), rateNow);
      const price = u.price == null ? num(u.product.price) : num(u.price);
      stockCostUsd += usd;
      stockPriceUsd += u.product.currency === 'USD' ? price : toUsd(price, rateNow);
      bump(aging, agingBucket(days), () => ({ units: 0, costUsd: 0 }), { units: 1, costUsd: usd });
      if (days > settings.agingDays) aged.push({ id: u.id, name: u.product.name, imei: u.imei1 ?? u.serial, days, costUsd: round2(usd), status: u.status });
    }
    const lotRows = await prisma.$queryRaw<{ currency: string; value: number }[]>`
      SELECT p.currency, COALESCE(SUM(l."qtyRemaining" * l."unitCost"), 0)::float AS value
      FROM "Lot" l JOIN "Product" p ON p.id = l."productId"
      WHERE l."storeId" = ${storeId} AND l."qtyRemaining" > 0 GROUP BY p.currency`;
    const accessoriesUsd = round2(lotRows.reduce((s, r) => s + (r.currency === 'USD' ? r.value : toUsd(r.value, rateNow)), 0));

    // ---------- Servicio técnico ----------
    const repairs = await prisma.repairOrder.findMany({ where: { storeId, OR: [{ status: { notIn: ['DELIVERED', 'CANCELLED'] } }, { deliveredAt: { gte: from, lt: to } }] } });
    const openByStatus = new Map<string, number>();
    const byTech = new Map<string, { delivered: number; revenue: number; parts: number; comebacks: number; days: number }>();
    for (const r of repairs) {
      if (r.status !== 'DELIVERED' && r.status !== 'CANCELLED') openByStatus.set(r.status, (openByStatus.get(r.status) ?? 0) + 1);
      if (r.status === 'DELIVERED' && r.deliveredAt && r.deliveredAt >= from) {
        const sale = r.saleId ? sales.find((s) => s.id === r.saleId) : undefined;
        const revenue = sale ? num(sale.items.find((i) => i.repairOrderId === r.id)?.lineTotal) : 0;
        const turnaround = r.readyAt ? (r.readyAt.getTime() - r.createdAt.getTime()) / 86_400_000 : 0;
        bump(byTech, r.technicianId ?? '—', () => ({ delivered: 0, revenue: 0, parts: 0, comebacks: 0, days: 0 }), {
          delivered: 1,
          revenue,
          parts: num(r.partsCost),
          comebacks: r.warrantyOfId ? 1 : 0,
          days: turnaround,
        });
      }
    }

    // ---------- Tomas de usados ----------
    const tradeIns = await prisma.tradeIn.findMany({ where: { storeId, status: 'ACCEPTED', acceptedAt: { gte: from, lt: to } } });
    const resold = await prisma.serialItem.findMany({
      where: { storeId, origin: { in: ['TRADE_IN', 'PURCHASE'] }, status: 'SOLD', soldAt: { gte: from, lt: to } },
      select: { id: true, receivedAt: true, soldAt: true },
    });
    const resoldIds = new Set(resold.map((r) => r.id));
    const resoldUnits = units.filter((u) => u.serialItemId && resoldIds.has(u.serialItemId));
    const daysToSell = resold.length ? round2(resold.reduce((s, r) => s + (r.soldAt!.getTime() - r.receivedAt.getTime()) / 86_400_000, 0) / resold.length) : null;

    // ---------- Cadetes ----------
    const deliveries = await prisma.delivery.findMany({ where: { storeId, OR: [{ doneAt: { gte: from, lt: to } }, { status: 'DELIVERED', settledAt: null }] } });
    const byCourier = new Map<string, { delivered: number; failed: number; pendingArs: number; pendingUsd: number }>();
    for (const d of deliveries) {
      const key = d.courierId ?? d.courierName ?? '—';
      const pending = d.status === 'DELIVERED' && !d.settledAt ? num(d.collected) : 0;
      bump(byCourier, key, () => ({ delivered: 0, failed: 0, pendingArs: 0, pendingUsd: 0 }), {
        delivered: d.status === 'DELIVERED' && d.doneAt && d.doneAt >= from ? 1 : 0,
        failed: d.status === 'FAILED' && d.doneAt && d.doneAt >= from ? 1 : 0,
        ...(d.collectCurrency === 'USD' ? { pendingUsd: pending } : { pendingArs: pending }),
      });
    }

    // ---------- Caja por moneda ----------
    const sessions = await prisma.cashSession.findMany({ where: { storeId, openedAt: { gte: from, lt: to } }, orderBy: { openedAt: 'asc' } });

    const named = <T,>(m: Map<string, T>) => [...m.entries()].map(([id, v]) => ({ id, name: names.get(id) ?? id, ...v }));
    return {
      from,
      to,
      rate: rateNow,
      sales: {
        count: sales.length,
        total: round2(total),
        cost: round2(cost),
        profit: round2(total - cost),
        totalUsd: round2(totalUsd),
        profitUsd: round2(profitUsd),
        surcharge: round2(surcharge),
        bySeller: named(bySeller).sort((a, b) => b.total - a.total),
        byChannel: [...byChannel.entries()].map(([channel, v]) => ({ channel, ...v })),
        byMethod: [...byMethod.entries()].map(([method, v]) => ({ method, ...v })),
        byCategory: [...byCategory.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total),
        topModels: [...byModel.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.units - a.units).slice(0, 15),
        units: units.sort((a, b) => b.date.getTime() - a.date.getTime()),
      },
      stock: {
        units: inStock.length,
        costUsd: round2(stockCostUsd),
        priceUsd: round2(stockPriceUsd),
        accessoriesUsd,
        aging: ['0-30', '31-60', '61-90', '90+'].map((b) => ({ bucket: b, ...(aging.get(b) ?? { units: 0, costUsd: 0 }) })),
        aged: aged.sort((a, b) => b.days - a.days),
      },
      repairs: {
        open: [...openByStatus.entries()].map(([status, count]) => ({ status, count })),
        byTechnician: named(byTech).map((t) => ({ ...t, avgDays: t.delivered ? round2(t.days / t.delivered) : null, margin: round2(t.revenue - t.parts) })),
      },
      tradeIns: {
        count: tradeIns.length,
        paidUsd: round2(tradeIns.reduce((s, t) => s + num(t.offeredUsd), 0)),
        resold: resold.length,
        resoldProfitUsd: round2(resoldUnits.reduce((s, u) => s + u.profitUsd, 0)),
        avgDaysToSell: daysToSell,
      },
      couriers: named(byCourier),
      cash: sessions.map((s) => ({
        id: s.id,
        openedAt: s.openedAt,
        closedAt: s.closedAt,
        user: names.get(s.userId) ?? null,
        expected: s.expectedAmount == null ? null : num(s.expectedAmount),
        counted: s.countedAmount == null ? null : num(s.countedAmount),
        difference: s.difference == null ? null : num(s.difference),
        expectedUsd: s.expectedUsd == null ? null : num(s.expectedUsd),
        countedUsd: s.countedUsd == null ? null : num(s.countedUsd),
        differenceUsd: s.differenceUsd == null ? null : num(s.differenceUsd),
      })),
    };
  });
}

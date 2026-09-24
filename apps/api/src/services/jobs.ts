import type { FastifyBaseLogger } from 'fastify';
import { num, prisma } from '../db';
import { addDays, daysBetween } from '../domain/dates';
import { fefoCompare } from '../domain/fefo';
import { suggestOffer } from '../domain/offers';
import { type NewAlert, notifyAlerts, raiseAlert, resolveAlert } from './alerts';
import { afterCreate, createMessage } from './messages';
import { publish } from './notify';
import { checkLowStock } from './sales';
import { avgDailySales } from './stats';
import { storeCtx } from './store';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Empleados que reciben las tareas de stock (si nadie tiene el permiso, todo el equipo). */
async function stockStaff(storeId: string) {
  const emps = await prisma.user.findMany({ where: { storeId, active: true, role: 'EMPLOYEE' }, select: { id: true, perms: true } });
  const withPerm = emps.filter((e) => e.perms.includes('stock'));
  const list = withPerm.length ? withPerm : emps;
  if (list.length) return list.map((e) => e.id);
  return (await prisma.user.findMany({ where: { storeId, role: 'OWNER', active: true }, select: { id: true } })).map((u) => u.id);
}

/** Vencimientos: avisa lotes por vencer y vencidos, y crea la tarea "retirar vencidos". */
async function expiryJob(storeId: string, alerts: NewAlert[]) {
  const { settings, today } = await storeCtx(prisma, storeId);
  const lots = await prisma.lot.findMany({
    where: { storeId, qtyRemaining: { gt: 0 }, expiresAt: { not: null, lte: addDays(today, settings.expiryAlertDays) } },
    include: { product: { select: { name: true } }, offer: true },
  });
  const newlyExpired: typeof lots = [];
  for (const lot of lots) {
    const days = daysBetween(today, lot.expiresAt!);
    const data = { lotId: lot.id, productId: lot.productId, name: lot.product.name, date: ymd(lot.expiresAt!), qty: num(lot.qtyRemaining) };
    if (days < 0) {
      const r = await raiseAlert(prisma, storeId, 'EXPIRED', `EXPIRED:${lot.id}`, data, 'danger');
      await resolveAlert(prisma, storeId, `EXPIRING:${lot.id}`);
      if (r.isNew) {
        alerts.push(r.alert);
        newlyExpired.push(lot);
      }
      if (lot.offer && (lot.offer.status === 'ACTIVE' || lot.offer.status === 'SUGGESTED')) {
        await prisma.offer.update({ where: { id: lot.offer.id }, data: { status: 'ENDED', endedAt: new Date() } });
      }
    } else {
      const r = await raiseAlert(prisma, storeId, 'EXPIRING', `EXPIRING:${lot.id}`, data, 'warn');
      if (r.isNew) alerts.push(r.alert);
    }
  }
  // Los lotes que ya no tienen stock (vendidos o retirados) dejan de avisar.
  const open = await prisma.alert.findMany({ where: { storeId, resolvedAt: null, type: { in: ['EXPIRING', 'EXPIRED'] } } });
  const stillThere = new Set(lots.map((l) => l.id));
  for (const a of open) {
    const lotId = (a.data as { lotId?: string }).lotId;
    if (lotId && !stillThere.has(lotId)) await resolveAlert(prisma, storeId, a.key);
  }

  if (newlyExpired.length) {
    const text = newlyExpired.map((l) => `• ${l.product.name}${l.lotCode ? ` · ${l.lotCode}` : ''} · ${ymd(l.expiresAt!)} · ${num(l.qtyRemaining)}`).join('\n');
    const { message, needsTranslation } = await createMessage(prisma, {
      storeId,
      fromUserId: null,
      kind: 'TASK',
      text,
      lang: 'es',
      recipientIds: await stockStaff(storeId),
      meta: { type: 'REMOVE_EXPIRED', lotIds: newlyExpired.map((l) => l.id) },
    });
    afterCreate(storeId, message.id, needsTranslation);
  }
}

/** Ofertas antes de que venza: sugiere liquidar los lotes que no se van a vender a tiempo. */
async function offersJob(storeId: string, alerts: NewAlert[]) {
  const { settings, today } = await storeCtx(prisma, storeId);
  const maxDays = Math.max(0, ...settings.offerTiers.map((t) => t.days));
  const lots = await prisma.lot.findMany({
    where: { storeId, qtyRemaining: { gt: 0 }, expiresAt: { not: null, gte: today, lte: addDays(today, maxDays) } },
    include: { product: true, offer: true },
  });
  if (lots.length === 0) return 0;
  const perDay = await avgDailySales(prisma, storeId, [...new Set(lots.map((l) => l.productId))]);
  const byProduct = new Map<string, typeof lots>();
  for (const l of lots) byProduct.set(l.productId, [...(byProduct.get(l.productId) ?? []), l]);

  let changes = 0;
  for (const productLots of byProduct.values()) {
    let ahead = 0;
    for (const lot of productLots.sort(fefoCompare)) {
      ahead += num(lot.qtyRemaining);
      const p = lot.product;
      if (!p.active || (lot.offer && (lot.offer.status === 'DISMISSED' || lot.offer.status === 'ENDED'))) continue;
      const daysToExpiry = daysBetween(today, lot.expiresAt!);
      const s = suggestOffer({
        daysToExpiry,
        qtyAhead: ahead,
        perDay: perDay.get(p.id) ?? 0,
        price: num(p.price),
        unitCost: num(lot.unitCost),
        tiers: settings.offerTiers,
        allowBelowCostDays: settings.offerAllowBelowCostDays,
        rounding: settings.priceRounding,
      });
      if (!s) continue;
      const reason = { qty: num(lot.qtyRemaining), perDay: Math.round((perDay.get(p.id) ?? 0) * 10) / 10, days: daysToExpiry, daysToSell: s.daysToSell };
      if (!lot.offer) {
        const auto = settings.offerAutoApprove;
        const offer = await prisma.offer.create({
          data: {
            storeId,
            productId: p.id,
            lotId: lot.id,
            discountPct: s.discountPct,
            offerPrice: s.offerPrice,
            reason,
            status: auto ? 'ACTIVE' : 'SUGGESTED',
            activatedAt: auto ? new Date() : null,
          },
        });
        changes++;
        if (!auto) {
          const r = await raiseAlert(prisma, storeId, 'OFFER_SUGGESTED', `OFFER_SUGGESTED:${offer.id}`, { offerId: offer.id, name: p.name, price: s.offerPrice, pct: s.discountPct }, 'info');
          if (r.isNew) alerts.push(r.alert);
        }
      } else if (s.discountPct > lot.offer.discountPct) {
        // Más cerca del vencimiento: el descuento se profundiza según la escala del local.
        await prisma.offer.update({ where: { id: lot.offer.id }, data: { discountPct: s.discountPct, offerPrice: s.offerPrice, reason } });
        changes++;
      }
    }
  }
  return changes;
}

async function lowStockJob(storeId: string, alerts: NewAlert[]) {
  const products = await prisma.product.findMany({ where: { storeId, active: true, minStock: { gt: 0 } }, select: { id: true } });
  const res = await checkLowStock(prisma, storeId, products.map((p) => p.id));
  alerts.push(...res.filter((r) => r.isNew).map((r) => r.alert));
}

/** Revisión diaria (idempotente: se puede correr varias veces sin duplicar nada). */
export async function runDailyJobs(storeId: string) {
  const alerts: NewAlert[] = [];
  await expiryJob(storeId, alerts);
  const offerChanges = await offersJob(storeId, alerts);
  await lowStockJob(storeId, alerts);
  if (offerChanges) {
    publish(storeId, 'offers');
    publish(storeId, 'catalog');
  }
  await notifyAlerts(storeId, alerts);
  return { alerts: alerts.length, offers: offerChanges };
}

export async function runAllStores(log?: FastifyBaseLogger) {
  const stores = await prisma.store.findMany({ select: { id: true } });
  for (const s of stores) {
    await runDailyJobs(s.id).catch((e) => log?.error({ err: e, storeId: s.id }, 'daily jobs'));
  }
}

/** Corre la revisión al arrancar y después cada hora. */
export function startJobs(log: FastifyBaseLogger) {
  const run = () => void runAllStores(log);
  setTimeout(run, 10_000);
  setInterval(run, 60 * 60 * 1000);
}

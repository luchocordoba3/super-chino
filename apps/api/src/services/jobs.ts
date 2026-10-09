import type { FastifyBaseLogger } from 'fastify';
import { num, prisma } from '../db';
import { localHour, localYMD, startOfLocalDay } from '../domain/dates';
import { addDays, daysBetween } from '../domain/dates';
import { createStockCount } from './counts';
import { ownerIds, pushTo } from './notify';
import { fefoCompare } from '../domain/fefo';
import { suggestOffer } from '../domain/offers';
import { type NewAlert, notifyAlerts, raiseAlert, resolveAlert } from './alerts';
import { absentCheck } from './attendance';
import { afterCreate, createMessage } from './messages';
import { publish } from './notify';
import { checkLowStock } from './sales';
import { avgDailySales } from './stats';
import { storeCtx } from './store';
import { addMonthsYMD, effectiveRate, toUsd, waLink } from '@super-chino/shared';
import { env } from '../env';
import { latestQuotes, refreshRates } from './fx';
import { setSerialStatus } from './phones';

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

/** Marca un proceso como hecho hoy; devuelve false si ya estaba hecho. */
async function onceToday(storeId: string, key: string) {
  try {
    await prisma.jobRun.create({ data: { storeId, key } });
    return true;
  } catch {
    return false;
  }
}

/** Conteo sorpresa: una vez por día, desde las 9 de la mañana. */
async function countJob(storeId: string, now: Date) {
  const { store, settings } = await storeCtx(prisma, storeId);
  if (settings.countItemsPerDay <= 0 || localHour(store.timezone, now) < 9) return;
  if (!(await onceToday(storeId, `COUNT:${localYMD(store.timezone, now)}`))) return;
  await createStockCount(storeId, await stockStaff(storeId), { n: settings.countItemsPerDay });
}

/** Resumen del día al celular del dueño, desde las 21 hs. */
async function summaryJob(storeId: string, now: Date) {
  const { store } = await storeCtx(prisma, storeId);
  if (localHour(store.timezone, now) < 21) return;
  if (!(await onceToday(storeId, `SUMMARY:${localYMD(store.timezone, now)}`))) return;
  const sales = await prisma.sale.findMany({ where: { storeId, status: 'COMPLETED', occurredAt: { gte: startOfLocalDay(store.timezone) } }, select: { total: true, costTotal: true, rate: true } });
  const total = sales.reduce((s, x) => s + num(x.total), 0);
  const profit = total - sales.reduce((s, x) => s + num(x.costTotal), 0);
  const usd = sales.reduce((s, x) => s + toUsd(num(x.total) - num(x.costTotal), x.rate == null ? null : num(x.rate)), 0);
  const alerts = await prisma.alert.count({ where: { storeId, resolvedAt: null } });
  const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: store.currency, maximumFractionDigits: 0 }).format(n);
  const owners = await prisma.user.findMany({ where: { id: { in: await ownerIds(storeId) } }, select: { id: true, lang: true } });
  for (const o of owners) {
    const body =
      o.lang === 'zh'
        ? `今天：${sales.length} 单，销售额 ${fmt(total)}，利润 ${fmt(profit)}，${alerts} 条提醒`
        : `Hoy: ${sales.length} ventas por ${fmt(total)} · ganancia ${fmt(profit)}${store.businessType === 'PHONES' ? ` (US$ ${Math.round(usd)})` : ''} · ${alerts} avisos`;
    await pushTo([o.id], { title: store.name, body, url: '/' });
  }
}

/** Casa de celulares: señas vencidas, equipos parados, reparaciones trabadas, dólar viejo y postventa. */
async function phoneJobs(storeId: string, now: Date, alerts: NewAlert[]) {
  const { store, settings } = await storeCtx(prisma, storeId);
  const push = (r: { isNew: boolean; alert: NewAlert }) => r.isNew && alerts.push(r.alert);

  // Señas vencidas: el equipo se libera y queda el aviso (la plata se devuelve o no según lo que se acordó).
  const expired = await prisma.deposit.findMany({ where: { storeId, status: 'ACTIVE', expiresAt: { lt: now } }, include: { customer: { select: { name: true } } } });
  for (const d of expired) {
    await prisma.$transaction(async (tx) => {
      await tx.deposit.update({ where: { id: d.id }, data: { status: 'EXPIRED' } });
      if (d.serialItemId) {
        const u = await tx.serialItem.findUnique({ where: { id: d.serialItemId } });
        if (u?.status === 'RESERVED') await setSerialStatus(tx, u.id, 'AVAILABLE', { type: 'RELEASED', refId: d.id, note: 'Seña vencida', data: { customerId: null } });
      }
    });
    push(await raiseAlert(prisma, storeId, 'DEPOSIT_EXPIRED', `DEPOSIT_EXPIRED:${d.id}`, { depositId: d.id, name: d.customer?.name, amount: num(d.amount), currency: d.currency, fx: d.fx == null ? null : num(d.fx) }));
  }

  // Equipos parados en stock más de N días.
  const limit = addDays(now, -settings.agingDays);
  const old = await prisma.serialItem.findMany({ where: { storeId, status: 'AVAILABLE', receivedAt: { lt: limit } }, include: { product: { select: { name: true } } } });
  for (const u of old) {
    push(await raiseAlert(prisma, storeId, 'UNIT_AGING', `UNIT_AGING:${u.id}`, { serialItemId: u.id, name: u.product.name, imei: u.imei1, days: daysBetween(u.receivedAt, now) }, 'info'));
  }
  const openAging = await prisma.alert.findMany({ where: { storeId, type: 'UNIT_AGING', resolvedAt: null } });
  const stillOld = new Set(old.map((u) => u.id));
  for (const a of openAging) if (!stillOld.has((a.data as { serialItemId?: string }).serialItemId ?? '')) await resolveAlert(prisma, storeId, a.key);

  // Reparaciones sin movimiento y equipos listos que nadie retira.
  const repairs = await prisma.repairOrder.findMany({ where: { storeId, status: { notIn: ['DELIVERED', 'CANCELLED'] } }, include: { customer: { select: { name: true } } } });
  const keep = new Set<string>();
  for (const r of repairs) {
    const data = { repairId: r.id, number: r.number, name: r.customer.name, device: r.device };
    if (r.status === 'READY') {
      if (r.readyAt && r.readyAt < addDays(now, -settings.repairPickupDays)) {
        keep.add(`REPAIR_NOT_PICKED:${r.id}`);
        push(await raiseAlert(prisma, storeId, 'REPAIR_NOT_PICKED', `REPAIR_NOT_PICKED:${r.id}`, { ...data, days: daysBetween(r.readyAt, now) }, 'info'));
      }
    } else if (r.updatedAt < addDays(now, -settings.repairStuckDays)) {
      keep.add(`REPAIR_STUCK:${r.id}`);
      push(await raiseAlert(prisma, storeId, 'REPAIR_STUCK', `REPAIR_STUCK:${r.id}`, { ...data, status: r.status, days: daysBetween(r.updatedAt, now) }));
    }
  }
  for (const a of await prisma.alert.findMany({ where: { storeId, type: { in: ['REPAIR_STUCK', 'REPAIR_NOT_PICKED'] }, resolvedAt: null } })) {
    if (!keep.has(a.key)) await resolveAlert(prisma, storeId, a.key);
  }

  // Dólar: si no hay cotización reciente, se avisa (se sigue usando la propia o la última).
  if (settings.fxSource !== 'manual') {
    const q = (await latestQuotes()).find((x) => x.casa === settings.fxSource);
    if (!q || now.getTime() - new Date(q.fetchedAt).getTime() > 24 * 3_600_000) {
      push(await raiseAlert(prisma, storeId, 'RATE_STALE', 'RATE_STALE', { casa: settings.fxSource, lastAt: q?.fetchedAt ?? null, rate: effectiveRate(settings, q ? [q] : []) }));
    } else await resolveAlert(prisma, storeId, 'RATE_STALE');
  }

  // Postventa: una vez por día, tareas para escribirle por WhatsApp a los que compraron un equipo.
  if (localHour(store.timezone, now) < 10) return;
  if (!(await onceToday(storeId, `FOLLOWUP:${localYMD(store.timezone, now)}`))) return;
  const today = startOfLocalDay(store.timezone, now);
  const tasks: { userId: string; text: string; meta: Record<string, string | number> }[] = [];
  for (const n of settings.followUpDays) {
    const day = addDays(today, -n);
    const sold = await prisma.sale.findMany({
      where: { storeId, status: 'COMPLETED', customerId: { not: null }, occurredAt: { gte: day, lt: addDays(day, 1) }, items: { some: { serialItemId: { not: null } } } },
      include: { customer: true, items: { where: { serialItemId: { not: null } } } },
    });
    for (const s of sold) {
      if (!s.customer?.phone) continue;
      const model = s.items[0]?.name ?? 'el equipo';
      const msg = n <= 7 ? `¡Hola ${s.customer.name}! ¿Cómo te está andando el ${model}? Cualquier cosa estamos para ayudarte. ${store.name}` : `¡Hola ${s.customer.name}! Ya pasó un mes con tu ${model}. ¿Todo bien? Si te gustó la atención, nos ayuda mucho que nos recomiendes. ${store.name}`;
      tasks.push({ userId: s.userId, text: `Seguimiento (${n} días): escribile a ${s.customer.name} por el ${model}.\n${waLink(s.customer.phone, msg)}`, meta: { type: 'FOLLOW_UP', saleId: s.id, days: n } });
    }
  }
  if (settings.upgradeMonths > 0) {
    const ymd = addMonthsYMD(localYMD(store.timezone, now), -settings.upgradeMonths);
    const day = startOfLocalDay(store.timezone, new Date(`${ymd}T12:00:00Z`));
    const sold = await prisma.serialItem.findMany({ where: { storeId, status: 'SOLD', soldAt: { gte: day, lt: addDays(day, 1) } }, include: { customer: true, product: { select: { name: true } } } });
    for (const u of sold) {
      if (!u.customer?.phone || !u.saleId) continue;
      const sale = await prisma.sale.findUnique({ where: { id: u.saleId }, select: { userId: true } });
      const msg = `¡Hola ${u.customer.name}! Hace ${settings.upgradeMonths} meses te llevaste el ${u.product.name}. Si querés cambiarlo, te lo tomamos como parte de pago. ${store.name}`;
      tasks.push({ userId: sale?.userId ?? (await ownerIds(storeId))[0], text: `Ofrecer cambio de equipo a ${u.customer.name} (${u.product.name}).\n${waLink(u.customer.phone, msg)}`, meta: { type: 'UPGRADE', serialItemId: u.id } });
    }
  }
  for (const t of tasks) {
    if (!t.userId) continue;
    const { message } = await createMessage(prisma, { storeId, fromUserId: null, kind: 'TASK', text: t.text, lang: 'es', recipientIds: [t.userId], meta: t.meta });
    afterCreate(storeId, message.id, false);
  }
}

/** Revisión diaria (idempotente: se puede correr varias veces sin duplicar nada). */
export async function runDailyJobs(storeId: string, now = new Date()) {
  const alerts: NewAlert[] = [];
  const { store } = await storeCtx(prisma, storeId);
  if (store.businessType === 'PHONES') await phoneJobs(storeId, now, alerts);
  await expiryJob(storeId, alerts);
  const offerChanges = await offersJob(storeId, alerts);
  await lowStockJob(storeId, alerts);
  await countJob(storeId, now);
  await summaryJob(storeId, now);
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

/** Avisa quién no vino a trabajar (se revisa seguido para que el aviso llegue a tiempo). */
export async function runAbsentChecks(log?: FastifyBaseLogger) {
  const stores = await prisma.store.findMany({ select: { id: true } });
  for (const s of stores) {
    await absentCheck(s.id)
      .then((alerts) => notifyAlerts(s.id, alerts))
      .catch((e) => log?.error({ err: e, storeId: s.id }, 'absent check'));
  }
}

/** Corre la revisión al arrancar y después cada hora; las ausencias, cada 10 minutos. */
export function startJobs(log: FastifyBaseLogger) {
  const run = () => void runAllStores(log);
  // Dólar cada 15 minutos (solo si hay alguna casa de celulares).
  const fx = async () => {
    if (!env.FX_ENABLED || !(await prisma.store.count({ where: { businessType: 'PHONES' } }))) return;
    await refreshRates(fetch, log).catch((e) => log.error({ err: e }, 'fx'));
  };
  setTimeout(() => void fx(), 3_000);
  setInterval(() => void fx(), 15 * 60 * 1000);
  setTimeout(run, 10_000);
  setInterval(run, 60 * 60 * 1000);
  setInterval(() => void runAbsentChecks(log), 10 * 60 * 1000);
}

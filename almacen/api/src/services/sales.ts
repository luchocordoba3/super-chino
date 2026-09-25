import type { Prisma } from '../generated/prisma/index.js';
import { type CashMoveKind, cashMoveSign, type Payment, type PosEvent, PosEventSchema, round2, type StoreSettings, type SyncResult } from '@almacen/shared';
import { type Db, num, numOrNull, prisma, type Tx } from '../db';
import { stockLevel } from '../domain/stockLevel';
import { type NewAlert, notifyAlerts, raiseAlert, resolveAlert } from './alerts';
import { clock } from './attendance';
import { afterCreate, createMessage } from './messages';
import { publish } from './notify';
import { consumeStock, lotsByProduct, restoreAllocations, stockOf } from './stock';
import { storeCtx } from './store';

/** Error de negocio: el evento no se puede aplicar nunca (no tiene sentido reintentarlo). */
export class RejectError extends Error {}

interface Ctx {
  storeId: string;
  deviceId: string;
  today: Date;
  settings: StoreSettings;
  /** Lo que se hace recién cuando se confirma la transacción del evento (ej. mandar un mensaje). */
  onCommit: (() => void)[];
}
type Ev<T extends PosEvent['type']> = Extract<PosEvent, { type: T }>;

/** "Se está terminando": aviso al dueño (con push) que queda hasta que se reponga el producto. */
export async function reportShortage(tx: Db, storeId: string, productId: string, userId: string) {
  const [p, user] = await Promise.all([
    tx.product.findFirst({ where: { id: productId, storeId } }),
    tx.user.findFirst({ where: { id: userId, storeId }, select: { name: true } }),
  ]);
  if (!p) throw new RejectError('product_not_found');
  const { stock } = stockOf(p, await lotsByProduct(tx, storeId, [p.id]));
  return raiseAlert(tx, storeId, 'SHORTAGE', `SHORTAGE:${p.id}`, { productId: p.id, name: p.name, stock, by: user?.name ?? '' }, 'warn');
}

/** Avisa stock bajo (debajo del mínimo o del % bajo) o lo da por resuelto según el stock actual. */
export async function checkLowStock(tx: Db, storeId: string, productIds: string[]) {
  const alerts: { isNew: boolean; alert: NewAlert }[] = [];
  if (productIds.length === 0) return alerts;
  const products = await tx.product.findMany({ where: { storeId, id: { in: productIds } } });
  const lots = await lotsByProduct(tx, storeId, productIds);
  const { settings } = await storeCtx(tx, storeId);
  for (const p of products) {
    const { stock } = stockOf(p, lots);
    const min = num(p.minStock);
    const { pct } = stockLevel({ stock, idealStock: numOrNull(p.idealStock), refStock: numOrNull(p.refStock), minStock: min, perDay: 0, lowPct: settings.lowStockPct });
    const byMin = min > 0 && stock <= min;
    if (byMin || (pct != null && pct <= settings.lowStockPct)) {
      const data = { productId: p.id, name: p.name, stock, min, ...(byMin ? {} : { pct }) };
      alerts.push(await raiseAlert(tx, storeId, 'LOW_STOCK', `LOW_STOCK:${p.id}`, data, 'info'));
    } else {
      await resolveAlert(tx, storeId, `LOW_STOCK:${p.id}`);
    }
  }
  return alerts;
}

async function applySale(tx: Tx, ctx: Ctx, ev: Ev<'SALE'>) {
  const alerts: { isNew: boolean; alert: NewAlert }[] = [];
  const ids = [...new Set(ev.items.map((i) => i.productId))];
  const products = await tx.product.findMany({ where: { storeId: ctx.storeId, id: { in: ids } } });
  if (products.length !== ids.length) throw new RejectError('product_not_found');
  const byId = new Map(products.map((p) => [p.id, p]));

  let costTotal = 0;
  let discountTotal = 0;
  let total = 0;
  const items: Prisma.SaleItemCreateWithoutSaleInput[] = [];
  const offersTouched = new Set<string>();
  for (const it of ev.items) {
    const p = byId.get(it.productId)!;
    const allocations = await consumeStock(tx, { storeId: ctx.storeId, productId: p.id, qty: it.qty, today: ctx.today, type: 'SALE', refId: ev.id, userId: ev.userId });
    const cost = round2(allocations.reduce((s, a) => s + a.qty * a.unitCost, 0));
    const lineTotal = round2(it.qty * it.unitPrice);
    costTotal += cost;
    total += lineTotal;
    discountTotal += round2(it.qty * Math.max(0, it.listPrice - it.unitPrice));

    let offerId: string | null = null;
    if (it.offerId) {
      const offer = await tx.offer.findFirst({ where: { id: it.offerId, storeId: ctx.storeId, productId: p.id } });
      if (offer) {
        offerId = offer.id;
        offersTouched.add(offer.id);
        await tx.offer.update({ where: { id: offer.id }, data: { soldQty: { increment: it.qty }, soldAmount: { increment: lineTotal } } });
      }
    }
    items.push({
      product: { connect: { id: p.id } },
      name: p.name,
      qty: it.qty,
      unitPrice: it.unitPrice,
      listPrice: it.listPrice,
      lineTotal,
      cost,
      offerId,
      priceOverride: it.priceOverride,
      lots: { create: allocations.map((a) => ({ lotId: a.lotId, qty: a.qty, unitCost: a.unitCost })) },
    });
    if (allocations.some((a) => !a.lotId)) {
      const fresh = await tx.product.findUniqueOrThrow({ where: { id: p.id }, select: { unallocatedSold: true } });
      alerts.push(await raiseAlert(tx, ctx.storeId, 'NEGATIVE_STOCK', `NEGATIVE_STOCK:${p.id}`, { productId: p.id, name: p.name, qty: num(fresh.unallocatedSold) }));
    }
  }

  await tx.sale.create({
    data: {
      id: ev.id,
      storeId: ctx.storeId,
      deviceId: ctx.deviceId,
      userId: ev.userId,
      cashSessionId: ev.cashSessionId ?? null,
      total: round2(total),
      costTotal: round2(costTotal),
      discountTotal: round2(discountTotal),
      payments: ev.payments,
      occurredAt: new Date(ev.occurredAt),
      items: { create: items },
    },
  });

  // Oferta terminada cuando se agotó su lote.
  for (const offerId of offersTouched) {
    const offer = await tx.offer.findUniqueOrThrow({ where: { id: offerId }, include: { lot: true } });
    if (offer.status === 'ACTIVE' && num(offer.lot.qtyRemaining) <= 0) {
      await tx.offer.update({ where: { id: offerId }, data: { status: 'ENDED', endedAt: new Date() } });
    }
  }
  alerts.push(...(await checkLowStock(tx, ctx.storeId, ids)));
  return alerts;
}

async function applyVoid(tx: Tx, ctx: Ctx, ev: Ev<'SALE_VOIDED'>) {
  const sale = await tx.sale.findFirst({ where: { id: ev.saleId, storeId: ctx.storeId }, include: { items: { include: { lots: true } } } });
  if (!sale) throw new RejectError('sale_not_found');
  if (sale.status === 'VOIDED') return [];
  for (const item of sale.items) {
    await restoreAllocations(tx, {
      storeId: ctx.storeId,
      productId: item.productId,
      allocations: item.lots.map((l) => ({ lotId: l.lotId, qty: num(l.qty), unitCost: num(l.unitCost) })),
      refId: sale.id,
      userId: ev.userId,
    });
    if (item.offerId) {
      await tx.offer.updateMany({
        where: { id: item.offerId },
        data: { soldQty: { decrement: item.qty }, soldAmount: { decrement: item.lineTotal } },
      });
    }
  }
  await tx.sale.update({
    where: { id: sale.id },
    data: { status: 'VOIDED', voidedAt: new Date(ev.occurredAt), voidedBy: ev.userId, voidReason: ev.reason ?? null },
  });
  return checkLowStock(tx, ctx.storeId, [...new Set(sale.items.map((i) => i.productId))]);
}

const cashOf = (payments: unknown) =>
  (payments as Payment[]).filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amount, 0);

async function applyCashClose(tx: Tx, ctx: Ctx, ev: Ev<'CASH_CLOSE'>) {
  const alerts: { isNew: boolean; alert: NewAlert }[] = [];
  const s = await tx.cashSession.findFirst({ where: { id: ev.cashSessionId, storeId: ctx.storeId } });
  if (!s) throw new RejectError('cash_session_not_found');
  if (s.closedAt) return alerts;
  const sales = await tx.sale.findMany({ where: { storeId: ctx.storeId, cashSessionId: s.id, status: 'COMPLETED' }, select: { payments: true } });
  // Pagos a proveedores, gastos y retiros restan; el cambio que se agrega suma.
  const moves = await tx.cashMovement.findMany({ where: { cashSessionId: s.id }, select: { kind: true, amount: true } });
  const movesNet = moves.reduce((sum, m) => sum + cashMoveSign(m.kind as CashMoveKind) * num(m.amount), 0);
  const expected = round2(num(s.openingAmount) + sales.reduce((sum, x) => sum + cashOf(x.payments), 0) + movesNet);
  const difference = round2(ev.countedAmount - expected);
  await tx.cashSession.update({
    where: { id: s.id },
    data: { closedAt: new Date(ev.occurredAt), closedBy: ev.userId, countedAmount: ev.countedAmount, expectedAmount: expected, difference, notes: ev.notes?.trim() || null },
  });
  // Pase de turno: las novedades le llegan al dueño y al resto del equipo como mensaje.
  const note = ev.notes?.trim();
  if (note) {
    const [author, team] = await Promise.all([
      tx.user.findUnique({ where: { id: ev.userId }, select: { lang: true } }),
      tx.user.findMany({ where: { storeId: ctx.storeId, active: true, id: { not: ev.userId } }, select: { id: true } }),
    ]);
    if (team.length) {
      const { message, needsTranslation } = await createMessage(tx, {
        storeId: ctx.storeId,
        fromUserId: ev.userId,
        text: note,
        lang: author?.lang ?? 'es',
        recipientIds: team.map((u) => u.id),
        meta: { type: 'HANDOVER', cashSessionId: s.id },
      });
      ctx.onCommit.push(() => afterCreate(ctx.storeId, message.id, needsTranslation));
    }
  }
  const names = new Map((await tx.user.findMany({ where: { storeId: ctx.storeId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  if (Math.abs(difference) >= ctx.settings.cashDiffThreshold && difference !== 0) {
    alerts.push(
      await raiseAlert(tx, ctx.storeId, 'CASH_DIFF', `CASH_DIFF:${s.id}`, { sessionId: s.id, userId: s.userId, name: names.get(s.userId), expected, counted: ev.countedAmount, diff: difference }, 'danger'),
    );
  }
  // Control anti-pérdidas: productos borrados después de escanear y ventas anuladas en el turno.
  const suspicious = await tx.posEvent.groupBy({
    by: ['userId'],
    where: { storeId: ctx.storeId, type: { in: ['ITEM_REMOVED', 'SALE_VOIDED'] }, payload: { path: ['cashSessionId'], equals: s.id } },
    _count: { _all: true },
  });
  for (const row of suspicious) {
    if (row._count._all >= ctx.settings.voidAlertThreshold) {
      alerts.push(
        await raiseAlert(tx, ctx.storeId, 'VOID_SPIKE', `VOID_SPIKE:${s.id}:${row.userId}`, { sessionId: s.id, userId: row.userId, name: names.get(row.userId), count: row._count._all }, 'danger'),
      );
    }
  }
  return alerts;
}

async function applyEvent(tx: Tx, ctx: Ctx, ev: PosEvent) {
  switch (ev.type) {
    case 'SALE':
      return applySale(tx, ctx, ev);
    case 'SALE_VOIDED':
      return applyVoid(tx, ctx, ev);
    case 'CASH_OPEN':
      await tx.cashSession.upsert({
        where: { id: ev.cashSessionId },
        create: { id: ev.cashSessionId, storeId: ctx.storeId, deviceId: ctx.deviceId, userId: ev.userId, openedAt: new Date(ev.occurredAt), openingAmount: ev.openingAmount },
        update: {},
      });
      return [];
    case 'CASH_CLOSE':
      return applyCashClose(tx, ctx, ev);
    case 'ITEM_REMOVED':
      return []; // queda registrado en PosEvent para el control anti-pérdidas
    case 'SHORTAGE':
      return [await reportShortage(tx, ctx.storeId, ev.productId, ev.userId)];
    case 'CLOCK': {
      const r = await clock(tx, { id: ev.id, storeId: ctx.storeId, userId: ev.userId, action: ev.action, at: new Date(ev.occurredAt), source: 'pos', deviceId: ctx.deviceId });
      if (!r) throw new RejectError('user_inactive');
      return r.alerts;
    }
    case 'CASH_MOVE': {
      const s = await tx.cashSession.findFirst({ where: { id: ev.cashSessionId, storeId: ctx.storeId } });
      if (!s || s.closedAt) throw new RejectError('cash_session_not_found');
      await tx.cashMovement.create({
        data: {
          id: ev.id,
          storeId: ctx.storeId,
          cashSessionId: s.id,
          deviceId: ctx.deviceId,
          userId: ev.userId,
          kind: ev.kind,
          amount: ev.amount,
          reason: ev.reason || null,
          supplierId: ev.supplierId ?? null,
          occurredAt: new Date(ev.occurredAt),
        },
      });
      return [];
    }
  }
}

/**
 * Aplica los eventos que manda la caja, en orden. Es idempotente: un evento ya recibido se ignora.
 * Los errores de negocio marcan el evento como "rejected"; los errores técnicos cortan el lote para reintentar.
 */
export async function processPosEvents(storeId: string, deviceId: string, raw: unknown[]): Promise<SyncResult[]> {
  const { settings, today } = await storeCtx(prisma, storeId);
  const ctx: Ctx = { storeId, deviceId, today, settings, onCommit: [] };
  const results: SyncResult[] = [];
  const newAlerts: NewAlert[] = [];
  for (const r of raw) {
    const parsed = PosEventSchema.safeParse(r);
    if (!parsed.success) {
      results.push({ id: String((r as { id?: unknown })?.id ?? ''), status: 'rejected', error: 'invalid_event' });
      continue;
    }
    const ev = parsed.data;
    ctx.onCommit = [];
    try {
      const out = await prisma.$transaction(
        async (tx) => {
          if (await tx.posEvent.findUnique({ where: { id: ev.id }, select: { id: true } })) return null;
          const user = await tx.user.findFirst({ where: { id: ev.userId, storeId }, select: { id: true } });
          if (!user) throw new RejectError('user_not_found');
          await tx.posEvent.create({
            data: { id: ev.id, storeId, deviceId, userId: ev.userId, type: ev.type, payload: ev as unknown as Prisma.InputJsonValue, occurredAt: new Date(ev.occurredAt) },
          });
          return applyEvent(tx, ctx, ev);
        },
        { timeout: 30_000 },
      );
      if (out === null) results.push({ id: ev.id, status: 'duplicate' });
      else {
        results.push({ id: ev.id, status: 'ok' });
        for (const f of ctx.onCommit) f();
        newAlerts.push(...out.filter((a) => a.isNew).map((a) => a.alert));
      }
    } catch (e) {
      if (e instanceof RejectError) results.push({ id: ev.id, status: 'rejected', error: e.message });
      else if ((e as { code?: string }).code === 'P2002') results.push({ id: ev.id, status: 'duplicate' });
      else throw e;
    }
  }
  if (results.some((r) => r.status === 'ok')) {
    publish(storeId, 'sales');
    if (results.some((r, i) => r.status === 'ok' && (raw[i] as { type?: string })?.type === 'CLOCK')) publish(storeId, 'attendance');
    await notifyAlerts(storeId, newAlerts);
  }
  return results;
}


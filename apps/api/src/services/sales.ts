import type { BusinessType, Prisma } from '@prisma/client';
import { type CashMoveKind, cashMoveSign, type Payment, type PosEvent, PosEventSchema, round2, type StoreSettings, type SyncResult, toArs } from '@super-chino/shared';
import { type Db, num, prisma, type Tx } from '../db';
import { addDays } from '../domain/dates';
import { type NewAlert, notifyAlerts, raiseAlert, resolveAlert } from './alerts';
import { clock } from './attendance';
import { storeRate } from './fx';
import { publish } from './notify';
import { conflictAlert, resolveCustomer, serialEvent, warrantyUntil } from './phones';
import { consumeStock, lotsByProduct, restoreAllocations, stockOf } from './stock';
import { storeCtx } from './store';

/** Error de negocio: el evento no se puede aplicar nunca (no tiene sentido reintentarlo). */
export class RejectError extends Error {}

export interface Ctx {
  storeId: string;
  /** null = venta generada fuera de la caja (pedido entregado). */
  deviceId: string | null;
  today: Date;
  settings: StoreSettings;
  businessType: BusinessType;
  /** Cotización actual, por si la caja no mandó la suya. */
  rate: number | null;
}
type Alerts = { isNew: boolean; alert: NewAlert }[];
type Ev<T extends PosEvent['type']> = Extract<PosEvent, { type: T }>;

/** Avisa stock bajo o lo da por resuelto según el stock actual. */
export async function checkLowStock(tx: Db, storeId: string, productIds: string[]) {
  const alerts: { isNew: boolean; alert: NewAlert }[] = [];
  if (productIds.length === 0) return alerts;
  const products = await tx.product.findMany({ where: { storeId, id: { in: productIds } } });
  const lots = await lotsByProduct(tx, storeId, productIds);
  for (const p of products) {
    const { stock } = stockOf(p, lots);
    const min = num(p.minStock);
    if (min > 0 && stock <= min) {
      alerts.push(await raiseAlert(tx, storeId, 'LOW_STOCK', `LOW_STOCK:${p.id}`, { productId: p.id, name: p.name, stock, min }, 'info'));
    } else {
      await resolveAlert(tx, storeId, `LOW_STOCK:${p.id}`);
    }
  }
  return alerts;
}

export async function applySale(tx: Tx, ctx: Ctx, ev: Ev<'SALE'>, extra: { channel?: string; orderId?: string } = {}) {
  const alerts: Alerts = [];
  const ids = [...new Set(ev.items.map((i) => i.productId))];
  const products = await tx.product.findMany({ where: { storeId: ctx.storeId, id: { in: ids } } });
  if (products.length !== ids.length) throw new RejectError('product_not_found');
  const byId = new Map(products.map((p) => [p.id, p]));
  const rate = ev.rate ?? ctx.rate ?? 0;
  const phones = ctx.businessType === 'PHONES';
  const customerId = await resolveCustomer(tx, ctx.storeId, ev.customerId, ev.newCustomer);
  const soldAt = new Date(ev.occurredAt);
  // La garantía corre desde el día de la venta (aunque la caja sincronice después).
  const saleDay = new Date(`${ev.occurredAt.slice(0, 10)}T00:00:00.000Z`);

  let costTotal = 0;
  let discountTotal = 0;
  let total = 0;
  const items: Prisma.SaleItemCreateWithoutSaleInput[] = [];
  const offersTouched = new Set<string>();
  const stockTouched = new Set<string>();
  for (const it of ev.items) {
    const p = byId.get(it.productId)!;
    const lineTotal = round2(it.qty * it.unitPrice);
    total += lineTotal;
    discountTotal += round2(it.qty * Math.max(0, it.listPrice - it.unitPrice));
    let cost = 0;
    let allocations: { lotId: string | null; qty: number; unitCost: number }[] = [];
    let until: Date | null = null;
    let serialItemId: string | null = null;
    let repairOrderId: string | null = null;

    if (it.repairOrderId) {
      // Cobro de una reparación: el costo son los repuestos que ya se usaron.
      const r = await tx.repairOrder.findFirst({ where: { id: it.repairOrderId, storeId: ctx.storeId } });
      if (r) {
        repairOrderId = r.id;
        cost = num(r.partsCost);
        until = r.warrantyDays > 0 ? addDays(saleDay, r.warrantyDays) : null;
        if (r.saleId && r.saleId !== ev.id) alerts.push(await conflictAlert(tx, ctx.storeId, `repair:${r.id}:${ev.id}`, { kind: 'repair_paid_twice', number: r.number, saleId: ev.id }));
        await tx.repairOrder.update({ where: { id: r.id }, data: { status: 'DELIVERED', deliveredAt: soldAt, saleId: ev.id } });
        await tx.repairEvent.create({ data: { repairId: r.id, status: 'DELIVERED', userId: ev.userId, note: null } });
      }
    } else if (it.serialItemId) {
      // Equipo con IMEI: no pasa por los lotes; el costo es el de ese equipo.
      const u = await tx.serialItem.findFirst({ where: { id: it.serialItemId, storeId: ctx.storeId } });
      if (!u) throw new RejectError('serial_not_found');
      serialItemId = u.id;
      cost = toArs(num(u.cost), p.currency, rate);
      until = warrantyUntil(ctx.settings, saleDay, u.condition, p.warrantyMonths);
      if (u.status !== 'AVAILABLE' && u.status !== 'RESERVED') {
        // Se vendió igual (la plata ya entró): queda el aviso para revisar.
        alerts.push(await conflictAlert(tx, ctx.storeId, `serial:${u.id}:${ev.id}`, { kind: 'serial_not_available', name: p.name, imei: u.imei1 ?? u.serial, status: u.status, saleId: ev.id }));
      }
      await tx.serialItem.update({ where: { id: u.id }, data: { status: 'SOLD', soldAt, saleId: ev.id, customerId, warrantyUntil: until } });
      await serialEvent(tx, { serialItemId: u.id, type: 'SOLD', status: 'SOLD', refId: ev.id, userId: ev.userId });
      // Si estaba señado, la seña queda para descontar (se usa con el pago DEPOSIT).
    } else if (p.isService) {
      cost = 0;
    } else {
      if (p.serialized && phones) {
        alerts.push(await conflictAlert(tx, ctx.storeId, `noimei:${ev.id}:${p.id}`, { kind: 'sold_without_imei', name: p.name, saleId: ev.id }));
      }
      allocations = await consumeStock(tx, { storeId: ctx.storeId, productId: p.id, qty: it.qty, today: ctx.today, type: 'SALE', refId: ev.id, userId: ev.userId });
      cost = toArs(round2(allocations.reduce((s, a) => s + a.qty * a.unitCost, 0)), p.currency, rate);
      stockTouched.add(p.id);
      if (phones) until = warrantyUntil(ctx.settings, saleDay, 'NEW', p.warrantyMonths);
    }
    costTotal += cost;

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
      serialItemId,
      repairOrderId,
      warrantyUntil: until,
      lots: { create: allocations.map((a) => ({ lotId: a.lotId, qty: a.qty, unitCost: a.unitCost })) },
    });
    if (allocations.some((a) => !a.lotId)) {
      const fresh = await tx.product.findUniqueOrThrow({ where: { id: p.id }, select: { unallocatedSold: true } });
      alerts.push(await raiseAlert(tx, ctx.storeId, 'NEGATIVE_STOCK', `NEGATIVE_STOCK:${p.id}`, { productId: p.id, name: p.name, qty: num(fresh.unallocatedSold) }));
    }
  }

  // Crédito de un usado tomado y señas: se marcan usados (si ya estaban usados, queda el aviso).
  for (const pay of ev.payments) {
    if (pay.method === 'TRADE_IN' && pay.ref) {
      const ti = await tx.tradeIn.findFirst({ where: { id: pay.ref, storeId: ctx.storeId } });
      if (!ti || ti.status !== 'ACCEPTED' || ti.usedSaleId || ti.paidAt) {
        alerts.push(await conflictAlert(tx, ctx.storeId, `tradein:${pay.ref}:${ev.id}`, { kind: 'trade_in_credit', ref: pay.ref, number: ti?.number, saleId: ev.id }));
      } else await tx.tradeIn.update({ where: { id: ti.id }, data: { usedSaleId: ev.id } });
    }
    if (pay.method === 'DEPOSIT' && pay.ref) {
      const d = await tx.deposit.findFirst({ where: { id: pay.ref, storeId: ctx.storeId } });
      if (!d || d.status !== 'ACTIVE') {
        alerts.push(await conflictAlert(tx, ctx.storeId, `deposit:${pay.ref}:${ev.id}`, { kind: 'deposit', ref: pay.ref, saleId: ev.id }));
      } else await tx.deposit.update({ where: { id: d.id }, data: { status: 'USED', usedSaleId: ev.id } });
    }
  }
  const surcharge = round2(ev.payments.reduce((s, p) => s + (p.surcharge ?? 0), 0));

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
      occurredAt: soldAt,
      customerId,
      rate: rate > 0 ? rate : null,
      cashArs: ev.cashArs ?? null,
      cashUsd: ev.cashUsd ?? null,
      surcharge,
      channel: extra.channel ?? 'POS',
      orderId: extra.orderId ?? null,
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
  alerts.push(...(await checkLowStock(tx, ctx.storeId, [...stockTouched])));
  return alerts;
}

/** Seña cobrada en la caja: reserva el equipo hasta la fecha de vencimiento. */
async function applyDeposit(tx: Tx, ctx: Ctx, ev: Ev<'DEPOSIT_IN'>) {
  const alerts: Alerts = [];
  const customerId = await resolveCustomer(tx, ctx.storeId, ev.customerId, ev.newCustomer);
  const expiresAt = ev.expiresAt ? new Date(ev.expiresAt) : addDays(new Date(ev.occurredAt), ctx.settings.depositDays);
  let serialItemId: string | null = null;
  if (ev.serialItemId) {
    const u = await tx.serialItem.findFirst({ where: { id: ev.serialItemId, storeId: ctx.storeId }, include: { product: { select: { name: true } } } });
    if (u) {
      serialItemId = u.id;
      if (u.status === 'AVAILABLE') {
        await tx.serialItem.update({ where: { id: u.id }, data: { status: 'RESERVED', customerId } });
        await serialEvent(tx, { serialItemId: u.id, type: 'RESERVED', status: 'RESERVED', refId: ev.depositId, userId: ev.userId });
      } else {
        alerts.push(await conflictAlert(tx, ctx.storeId, `depserial:${ev.depositId}`, { kind: 'deposit_serial_not_available', name: u.product.name, imei: u.imei1, status: u.status }));
      }
    }
  }
  await tx.deposit.create({
    data: {
      id: ev.depositId,
      storeId: ctx.storeId,
      customerId,
      serialItemId,
      repairOrderId: ev.repairOrderId ?? null,
      orderId: ev.orderId ?? null,
      amount: ev.amount,
      currency: ev.currency,
      fx: ev.fx ?? null,
      method: ev.method,
      cashSessionId: ev.cashSessionId ?? null,
      deviceId: ctx.deviceId,
      userId: ev.userId,
      note: ev.note ?? null,
      expiresAt,
      createdAt: new Date(ev.occurredAt),
    },
  });
  if (ev.orderId) {
    await tx.order.updateMany({ where: { id: ev.orderId, storeId: ctx.storeId, status: { in: ['INQUIRY'] } }, data: { status: 'RESERVED' } });
  }
  return alerts;
}

export async function applyVoid(tx: Tx, ctx: Ctx, ev: Ev<'SALE_VOIDED'>) {
  const sale = await tx.sale.findFirst({ where: { id: ev.saleId, storeId: ctx.storeId }, include: { items: { include: { lots: true } } } });
  if (!sale) throw new RejectError('sale_not_found');
  if (sale.status === 'VOIDED') return [];
  for (const item of sale.items) {
    if (item.serialItemId) {
      // El equipo vuelve a estar disponible.
      await tx.serialItem.update({ where: { id: item.serialItemId }, data: { status: 'AVAILABLE', soldAt: null, saleId: null, warrantyUntil: null } });
      await serialEvent(tx, { serialItemId: item.serialItemId, type: 'VOID', status: 'AVAILABLE', refId: sale.id, userId: ev.userId });
    }
    if (item.repairOrderId) {
      await tx.repairOrder.updateMany({ where: { id: item.repairOrderId, saleId: sale.id }, data: { status: 'READY', deliveredAt: null, saleId: null } });
      await tx.repairEvent.create({ data: { repairId: item.repairOrderId, status: 'READY', userId: ev.userId, note: 'Cobro anulado', public: false } });
    }
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
  // El crédito de la toma y las señas se pueden volver a usar.
  await tx.tradeIn.updateMany({ where: { storeId: ctx.storeId, usedSaleId: sale.id }, data: { usedSaleId: null } });
  await tx.deposit.updateMany({ where: { storeId: ctx.storeId, usedSaleId: sale.id }, data: { status: 'ACTIVE', usedSaleId: null } });
  await tx.sale.update({
    where: { id: sale.id },
    data: { status: 'VOIDED', voidedAt: new Date(ev.occurredAt), voidedBy: ev.userId, voidReason: ev.reason ?? null },
  });
  return checkLowStock(tx, ctx.storeId, [...new Set(sale.items.map((i) => i.productId))]);
}

const cashOf = (payments: unknown) =>
  (payments as Payment[]).filter((p) => p.method === 'CASH' && p.currency !== 'USD').reduce((s, p) => s + p.amount, 0);

/** Lo que tiene que haber en cada cajón (pesos y dólares) al cerrar. */
export async function expectedCash(db: Db, s: { id: string; openingAmount: Prisma.Decimal | number; openingUsd: Prisma.Decimal | number }) {
  const [sales, moves, deposits] = await Promise.all([
    db.sale.findMany({ where: { cashSessionId: s.id, status: 'COMPLETED' }, select: { payments: true, cashArs: true, cashUsd: true } }),
    db.cashMovement.findMany({ where: { cashSessionId: s.id }, select: { kind: true, amount: true, currency: true } }),
    db.deposit.findMany({ where: { cashSessionId: s.id, method: 'CASH' }, select: { amount: true, currency: true, fx: true } }),
  ]);
  let ars = num(s.openingAmount);
  let usd = num(s.openingUsd);
  for (const x of sales) {
    ars += x.cashArs != null ? num(x.cashArs) : cashOf(x.payments);
    usd += num(x.cashUsd);
  }
  // Pagos a proveedores, gastos, retiros y compras de usados restan; el cambio y las rendiciones suman.
  for (const m of moves) {
    const v = cashMoveSign(m.kind as CashMoveKind) * num(m.amount);
    if (m.currency === 'USD') usd += v;
    else ars += v;
  }
  for (const d of deposits) {
    if (d.currency === 'USD') usd += num(d.fx);
    else ars += num(d.amount);
  }
  return { ars: round2(ars), usd: round2(usd) };
}

async function applyCashClose(tx: Tx, ctx: Ctx, ev: Ev<'CASH_CLOSE'>) {
  const alerts: { isNew: boolean; alert: NewAlert }[] = [];
  const s = await tx.cashSession.findFirst({ where: { id: ev.cashSessionId, storeId: ctx.storeId } });
  if (!s) throw new RejectError('cash_session_not_found');
  if (s.closedAt) return alerts;
  const exp = await expectedCash(tx, s);
  const expected = exp.ars;
  const difference = round2(ev.countedAmount - expected);
  const usdCounted = ev.countedUsd ?? (exp.usd === 0 ? 0 : null);
  const diffUsd = usdCounted == null ? null : round2(usdCounted - exp.usd);
  await tx.cashSession.update({
    where: { id: s.id },
    data: {
      closedAt: new Date(ev.occurredAt),
      closedBy: ev.userId,
      countedAmount: ev.countedAmount,
      expectedAmount: expected,
      difference,
      countedUsd: usdCounted,
      expectedUsd: exp.usd,
      differenceUsd: diffUsd,
      notes: ev.notes ?? null,
    },
  });
  const names = new Map((await tx.user.findMany({ where: { storeId: ctx.storeId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const usdTooFar = diffUsd != null && Math.abs(diffUsd) >= 1 && Math.abs(diffUsd) * (ctx.rate ?? 1000) >= ctx.settings.cashDiffThreshold;
  if ((Math.abs(difference) >= ctx.settings.cashDiffThreshold && difference !== 0) || usdTooFar) {
    alerts.push(
      await raiseAlert(
        tx,
        ctx.storeId,
        'CASH_DIFF',
        `CASH_DIFF:${s.id}`,
        { sessionId: s.id, userId: s.userId, name: names.get(s.userId), expected, counted: ev.countedAmount, diff: difference, ...(diffUsd ? { expectedUsd: exp.usd, countedUsd: usdCounted, diffUsd } : {}) },
        'danger',
      ),
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
    case 'DEPOSIT_IN':
      return applyDeposit(tx, ctx, ev);
    case 'CASH_OPEN':
      await tx.cashSession.upsert({
        where: { id: ev.cashSessionId },
        create: {
          id: ev.cashSessionId,
          storeId: ctx.storeId,
          deviceId: ctx.deviceId!,
          userId: ev.userId,
          openedAt: new Date(ev.occurredAt),
          openingAmount: ev.openingAmount,
          openingUsd: ev.openingUsd ?? 0,
        },
        update: {},
      });
      return [];
    case 'CASH_CLOSE':
      return applyCashClose(tx, ctx, ev);
    case 'ITEM_REMOVED':
      return []; // queda registrado en PosEvent para el control anti-pérdidas
    case 'CLOCK': {
      const r = await clock(tx, { id: ev.id, storeId: ctx.storeId, userId: ev.userId, action: ev.action, at: new Date(ev.occurredAt), source: 'pos', deviceId: ctx.deviceId });
      if (!r) throw new RejectError('user_inactive');
      return r.alerts;
    }
    case 'CASH_MOVE':
      return applyCashMove(tx, ctx, ev);
  }
}

async function applyCashMove(tx: Tx, ctx: Ctx, ev: Ev<'CASH_MOVE'>): Promise<Alerts> {
  const alerts: Alerts = [];
  const s = await tx.cashSession.findFirst({ where: { id: ev.cashSessionId, storeId: ctx.storeId } });
  if (!s || s.closedAt) throw new RejectError('cash_session_not_found');
  const currency = ev.currency ?? 'ARS';
  await tx.cashMovement.create({
    data: {
      id: ev.id,
      storeId: ctx.storeId,
      cashSessionId: s.id,
      deviceId: ctx.deviceId!,
      userId: ev.userId,
      kind: ev.kind,
      amount: ev.amount,
      currency,
      reason: ev.reason || null,
      supplierId: ev.supplierId ?? null,
      refId: ev.refId ?? null,
      occurredAt: new Date(ev.occurredAt),
    },
  });
  if (ev.kind === 'PURCHASE' && ev.refId) {
    // Se le pagó al particular el usado que se le compró.
    const ti = await tx.tradeIn.findFirst({ where: { id: ev.refId, storeId: ctx.storeId } });
    if (ti && !ti.paidAt && !ti.usedSaleId) await tx.tradeIn.update({ where: { id: ti.id }, data: { paidAt: new Date(ev.occurredAt) } });
    else alerts.push(await conflictAlert(tx, ctx.storeId, `purchase:${ev.id}`, { kind: 'trade_in_paid_twice', number: ti?.number }));
  }
  if (ev.kind === 'COURIER' && ev.refId) {
    // Rendición del cadete: lo cobrado en las entregas de esa moneda contra lo que entrega en la caja.
    const pending = await tx.delivery.findMany({ where: { storeId: ctx.storeId, courierId: ev.refId, status: 'DELIVERED', settledAt: null, collectCurrency: currency } });
    const expected = round2(pending.reduce((sum, d) => sum + num(d.collected), 0));
    await tx.delivery.updateMany({ where: { id: { in: pending.map((d) => d.id) } }, data: { settledAt: new Date(ev.occurredAt), settlementId: ev.id } });
    const diff = round2(ev.amount - expected);
    const diffArs = currency === 'USD' ? diff * (ctx.rate ?? 1000) : diff;
    if (diff !== 0 && Math.abs(diffArs) >= ctx.settings.courierDiffThreshold) {
      const u = await tx.user.findUnique({ where: { id: ev.refId }, select: { name: true } });
      alerts.push(await raiseAlert(tx, ctx.storeId, 'COURIER_DIFF', `COURIER_DIFF:${ev.id}`, { courierId: ev.refId, name: u?.name, expected, amount: ev.amount, diff, currency }, 'danger'));
    }
  }
  return alerts;
}

export async function saleCtx(storeId: string, deviceId: string | null): Promise<Ctx> {
  const { store, settings, today } = await storeCtx(prisma, storeId);
  const rate = store.businessType === 'PHONES' ? (await storeRate(storeId)).rate : null;
  return { storeId, deviceId, today, settings, businessType: store.businessType, rate };
}

/**
 * Aplica los eventos que manda la caja, en orden. Es idempotente: un evento ya recibido se ignora.
 * Los errores de negocio marcan el evento como "rejected"; los errores técnicos cortan el lote para reintentar.
 */
export async function processPosEvents(storeId: string, deviceId: string, raw: unknown[]): Promise<SyncResult[]> {
  const ctx = await saleCtx(storeId, deviceId);
  const results: SyncResult[] = [];
  const newAlerts: NewAlert[] = [];
  for (const r of raw) {
    const parsed = PosEventSchema.safeParse(r);
    if (!parsed.success) {
      results.push({ id: String((r as { id?: unknown })?.id ?? ''), status: 'rejected', error: 'invalid_event' });
      continue;
    }
    const ev = parsed.data;
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
    if (ctx.businessType === 'PHONES') publish(storeId, 'phones');
    await notifyAlerts(storeId, newAlerts);
  }
  return results;
}


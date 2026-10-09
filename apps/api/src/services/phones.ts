// Casa de celulares: clientes, equipos con IMEI y garantías (lo usan la caja, las tomas, las reparaciones y los pedidos).
import type { ItemCondition, SerialStatus } from '@prisma/client';
import { addMonthsYMD, cleanImei, type StoreSettings, warrantyMonths } from '@super-chino/shared';
import { type Db, num, type Tx } from '../db';
import { badRequest, HttpError, notFound } from '../lib/http';
import { raiseAlert } from './alerts';

/** Cliente existente del local, o uno nuevo con el id que mandó la caja. Devuelve el id (o null). */
export async function resolveCustomer(
  tx: Tx,
  storeId: string,
  customerId?: string | null,
  newCustomer?: { id: string; name: string; phone?: string; dni?: string },
) {
  if (customerId) {
    const c = await tx.customer.findFirst({ where: { id: customerId, storeId }, select: { id: true } });
    if (c) return c.id;
  }
  if (!newCustomer) return null;
  const existing = await tx.customer.findUnique({ where: { id: newCustomer.id } });
  if (existing) return existing.storeId === storeId ? existing.id : null;
  const phone = newCustomer.phone?.replace(/\D/g, '') || null;
  const dni = newCustomer.dni?.replace(/\D/g, '') || null;
  // Mismo DNI o teléfono = misma persona (no se duplica si la cargan dos veces).
  const same = dni || phone ? await tx.customer.findFirst({ where: { storeId, OR: [...(dni ? [{ dni }] : []), ...(phone ? [{ phone }] : [])] } }) : null;
  if (same) return same.id;
  const c = await tx.customer.create({ data: { id: newCustomer.id, storeId, name: newCustomer.name, phone, dni } });
  return c.id;
}

export async function serialEvent(
  db: Db,
  a: { serialItemId: string; type: string; status?: SerialStatus | null; refId?: string | null; userId?: string | null; note?: string | null },
) {
  await db.serialEvent.create({ data: { serialItemId: a.serialItemId, type: a.type, status: a.status ?? null, refId: a.refId ?? null, userId: a.userId ?? null, note: a.note ?? null } });
}

/** Busca un equipo por IMEI (1 o 2) o número de serie. */
export async function findSerial(db: Db, storeId: string, code: string) {
  const imei = cleanImei(code);
  const raw = code.trim();
  return db.serialItem.findFirst({
    where: { storeId, OR: [...(imei.length >= 8 ? [{ imei1: imei }, { imei2: imei }] : []), { serial: raw }] },
    include: { product: true },
  });
}

/** Equipos disponibles por producto (el "stock" de los productos con IMEI). */
export async function serialStock(db: Db, storeId: string, productIds?: string[]) {
  const rows = await db.serialItem.groupBy({
    by: ['productId'],
    where: { storeId, status: 'AVAILABLE', ...(productIds ? { productId: { in: productIds } } : {}) },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.productId, r._count._all]));
}

/** Fecha hasta la que tiene garantía algo vendido hoy. */
export function warrantyUntil(settings: StoreSettings, today: Date, condition: ItemCondition, productMonths?: number | null) {
  const months = warrantyMonths(settings, condition, productMonths);
  return new Date(addMonthsYMD(today.toISOString().slice(0, 10), months) + 'T00:00:00.000Z');
}

export interface SerialInput {
  imei1?: string | null;
  imei2?: string | null;
  serial?: string | null;
}

/** Normaliza IMEI y avisa si ya hay otro equipo con el mismo IMEI o serie. */
export async function checkSerialUnique(db: Db, storeId: string, s: SerialInput, exceptId?: string) {
  const imei1 = s.imei1 ? cleanImei(s.imei1) : null;
  const imei2 = s.imei2 ? cleanImei(s.imei2) : null;
  if (!imei1 && !s.serial) throw badRequest('imei_or_serial_required');
  const ors = [
    ...(imei1 ? [{ imei1 }, { imei2: imei1 }] : []),
    ...(imei2 ? [{ imei1: imei2 }, { imei2 }] : []),
    ...(s.serial ? [{ serial: s.serial }] : []),
  ];
  const dup = await db.serialItem.findFirst({ where: { storeId, OR: ors, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (dup) throw new HttpError(409, 'imei_taken', dup.id);
  return { imei1, imei2, serial: s.serial || null };
}

/** Pasa un equipo a otro estado dejando registro. */
export async function setSerialStatus(db: Db, id: string, status: SerialStatus, a: { type: string; refId?: string | null; userId?: string | null; note?: string | null; data?: Record<string, unknown> }) {
  await db.serialItem.update({ where: { id }, data: { status, ...(a.data ?? {}) } });
  await serialEvent(db, { serialItemId: id, type: a.type, status, refId: a.refId, userId: a.userId, note: a.note });
}

/** Un equipo del local o 404. */
export async function getSerial(db: Db, storeId: string, id: string) {
  const s = await db.serialItem.findFirst({ where: { id, storeId }, include: { product: true } });
  if (!s) throw notFound('serial_not_found');
  return s;
}

export const serialDto = (s: Awaited<ReturnType<typeof getSerial>>) => ({
  id: s.id,
  productId: s.productId,
  product: s.product.name,
  currency: s.product.currency,
  imei1: s.imei1,
  imei2: s.imei2,
  serial: s.serial,
  condition: s.condition,
  grade: s.grade,
  battery: s.battery,
  color: s.color,
  carrierLocked: s.carrierLocked,
  accountFree: s.accountFree,
  includes: s.includes,
  notes: s.notes,
  photos: s.photos,
  price: s.price == null ? num(s.product.price) : num(s.price),
  ownPrice: s.price != null,
  cost: num(s.cost),
  supplierId: s.supplierId,
  origin: s.origin,
  supplierWarrantyUntil: s.supplierWarrantyUntil,
  status: s.status,
  receivedAt: s.receivedAt,
  soldAt: s.soldAt,
  saleId: s.saleId,
  customerId: s.customerId,
  warrantyUntil: s.warrantyUntil,
});

/** Avisa que algo no cerró al sincronizar una venta (equipo ya vendido, crédito ya usado, etc.). */
export const conflictAlert = (tx: Tx, storeId: string, key: string, data: Record<string, unknown>) =>
  raiseAlert(tx, storeId, 'UNIT_CONFLICT', `UNIT_CONFLICT:${key}`, data, 'danger');

/** Próximo número correlativo (tomas, reparaciones, pedidos). */
export async function nextNumber(tx: Tx, table: 'tradeIn' | 'repairOrder' | 'order', storeId: string) {
  // Bloquea el local para que dos altas al mismo tiempo no tomen el mismo número.
  await tx.$executeRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;
  const delegate = tx[table] as unknown as { aggregate: (a: object) => Promise<{ _max: { number: number | null } }> };
  const r = await delegate.aggregate({ where: { storeId }, _max: { number: true } });
  return (r._max.number ?? 0) + 1;
}

/** Producto "servicio" (sin stock) para cobrar reparaciones y envíos. Se crea la primera vez. */
export async function serviceProduct(db: Db, storeId: string, kind: 'REPAIR' | 'SHIPPING') {
  const barcode = kind === 'REPAIR' ? 'SERV-REPARACION' : 'SERV-ENVIO';
  const existing = await db.product.findUnique({ where: { storeId_barcode: { storeId, barcode } } });
  if (existing) return existing;
  return db.product.create({ data: { storeId, barcode, name: kind === 'REPAIR' ? 'Servicio técnico' : 'Envío', price: 0, isService: true } });
}

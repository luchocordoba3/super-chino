import type { AlertType, Prisma } from '../generated/prisma/index.js';
import type { Db } from '../db';
import { ownerIds, publish, pushTo } from './notify';

export interface NewAlert {
  type: AlertType;
  data: Record<string, unknown>;
  severity: string;
}

/** Crea (o reabre) un aviso sin duplicarlo. Devuelve isNew = true si es nuevo para el dueño. */
export async function raiseAlert(db: Db, storeId: string, type: AlertType, key: string, data: Record<string, unknown>, severity = 'warn') {
  const json = data as Prisma.InputJsonValue;
  const existing = await db.alert.findUnique({ where: { storeId_key: { storeId, key } } });
  if (existing && !existing.resolvedAt) {
    await db.alert.update({ where: { id: existing.id }, data: { data: json, severity } });
    return { isNew: false, alert: { type, data, severity } as NewAlert };
  }
  if (existing) {
    await db.alert.update({ where: { id: existing.id }, data: { resolvedAt: null, createdAt: new Date(), data: json, severity } });
  } else {
    await db.alert.create({ data: { storeId, type, key, data: json, severity } });
  }
  return { isNew: true, alert: { type, data, severity } as NewAlert };
}

export async function resolveAlert(db: Db, storeId: string, key: string) {
  await db.alert.updateMany({ where: { storeId, key, resolvedAt: null }, data: { resolvedAt: new Date() } });
}

/** Avisos que siempre llegan al celular del dueño, además de los graves. */
const PUSH_TYPES = new Set<AlertType>(['LATE', 'ABSENT', 'SHORTAGE']);

/** Después de confirmar la transacción: refresca pantallas y manda push al dueño si es grave. */
export async function notifyAlerts(storeId: string, alerts: NewAlert[]) {
  if (alerts.length === 0) return;
  publish(storeId, 'alerts');
  const danger = alerts.filter((a) => a.severity === 'danger' || PUSH_TYPES.has(a.type));
  if (danger.length) {
    const owners = await ownerIds(storeId);
    const title = danger.length === 1 ? 'Almacén: aviso importante' : `Almacén: ${danger.length} avisos importantes`;
    await pushTo(owners, { title, body: danger.map((a) => String(a.data.name ?? a.type)).join(', '), url: '/alerts' });
  }
}


import { parseSettings } from '@super-chino/shared';
import type { Db } from '../db';
import { localToday } from '../domain/dates';

/** Datos del local que casi todo necesita: configuración y "hoy" en su zona horaria. */
export async function storeCtx(db: Db, storeId: string) {
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId } });
  return { store, settings: parseSettings(store.settings), today: localToday(store.timezone) };
}

/** id -> nombre de los usuarios del local (son pocos). */
export async function userNames(db: Db, storeId: string) {
  const users = await db.user.findMany({ where: { storeId }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

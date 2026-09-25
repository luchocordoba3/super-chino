import type { PosEvent, SyncResult } from '@almacen/shared';
import { type CatalogProduct, type CategoryRow, db, type Handover, type LocalTab, kvDel, kvGet, kvSet, normalize, type OfferRow, type PosUser, type StoreInfo, type SupplierRow } from './db';

export class UnlinkedError extends Error {}

/** Aviso interno para que la pantalla actualice "pendientes de enviar". */
export const syncEvents = new EventTarget();
const changed = () => syncEvents.dispatchEvent(new Event('change'));

export const getDeviceToken = () => kvGet<string>('deviceToken');

async function posFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getDeviceToken();
  if (!token) throw new UnlinkedError();
  const res = await fetch('/api' + path, {
    ...init,
    headers: { 'x-device-token': token, ...(init.body ? { 'content-type': 'application/json' } : {}) },
  });
  if (res.status === 401) {
    await kvDel('deviceToken');
    throw new UnlinkedError();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Llamadas de la caja a la API (con el token de la caja). */
export const posGet = <T>(path: string) => posFetch<T>(path);
export const posPost = <T>(path: string, body: unknown = {}) => posFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });

interface Bootstrap {
  serverTime: string;
  full: boolean;
  store: StoreInfo;
  users: PosUser[];
  products: Omit<CatalogProduct, 'search'>[];
  offers: OfferRow[];
  suppliers?: SupplierRow[];
  handover?: Handover | null;
  categories?: CategoryRow[];
}

/** Cambia cuando el catálogo local suma datos: la caja lo vuelve a bajar entero una vez. */
const CATALOG_VERSION = 2;

/** Baja catálogo, precios, ofertas y cajeros. Incremental: solo lo que cambió desde la última vez. */
export async function refreshCatalog(full = false) {
  if ((await kvGet<number>('catalogVersion')) !== CATALOG_VERSION) full = true;
  const since = full ? undefined : await kvGet<string>('catalogSince');
  const data = await posFetch<Bootstrap>(`/pos/bootstrap${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  await db.transaction('rw', [db.products, db.users, db.offers, db.kv], async () => {
    if (data.full) await db.products.clear();
    await db.products.bulkPut(data.products.map((p) => ({ ...p, search: normalize(`${p.name} ${p.barcode ?? ''}`) })));
    await db.users.clear();
    await db.users.bulkPut(data.users);
    await db.offers.clear();
    await db.offers.bulkPut(data.offers);
    await kvSet('store', data.store);
    await kvSet('suppliers', data.suppliers ?? []);
    await kvSet('catalogSince', data.serverTime);
    await kvSet('catalogVersion', CATALOG_VERSION);
    await kvSet('categories', data.categories ?? []);
    // Pase de turno: el más nuevo entre el del servidor y el que se dejó en esta caja (quizás sin enviar).
    const local = await kvGet<Handover>('handover');
    if (data.handover && (!local || data.handover.closedAt > local.closedAt)) await kvSet('handover', data.handover);
  });
  changed();
  return data;
}

let flushing: Promise<void> | null = null;

/** Manda a la API los eventos pendientes, en orden. Si no hay internet, quedan para después. */
export function flushOutbox(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      for (;;) {
        const batch = await db.outbox.orderBy('seq').limit(100).toArray();
        if (batch.length === 0) break;
        const { results } = await posFetch<{ results: SyncResult[] }>('/pos/sync', {
          method: 'POST',
          body: JSON.stringify({ events: batch.map((b) => b.event) }),
        });
        const rejected = results.filter((r) => r.status === 'rejected');
        await db.transaction('rw', db.outbox, db.rejected, async () => {
          await db.outbox.where('id').anyOf(results.map((r) => r.id)).delete();
          await db.rejected.bulkPut(rejected.map((r) => ({ id: r.id, error: r.error, event: batch.find((b) => b.id === r.id)?.event })));
        });
        if (batch.length < 100) break;
      }
    } finally {
      flushing = null;
      changed();
    }
  })();
  return flushing;
}

/** Guarda el evento en la PC (nunca se pierde) y trata de enviarlo. */
export async function enqueue(event: PosEvent) {
  await db.outbox.add({ id: event.id, event });
  changed();
  void flushOutbox().catch(() => undefined);
}

export const pendingCount = () => db.outbox.count();

/** Hay cambios de cuentas de mesa sin enviar (mientras tanto manda lo que se anotó en esta caja). */
const pendingTabEvents = () => db.outbox.filter((r) => r.event.type.startsWith('TAB_') || (r.event.type === 'SALE' && !!r.event.tabId)).count();

/** Trae las cuentas abiertas (de todas las cajas y los pedidos desde la mesa). */
export async function refreshTabs() {
  if (await pendingTabEvents()) return;
  const tabs = await posFetch<(LocalTab & { total: number })[]>('/pos/tabs');
  if (await pendingTabEvents()) return;
  await db.transaction('rw', db.tabs, async () => {
    await db.tabs.clear();
    await db.tabs.bulkPut(tabs.map(({ total: _total, ...t }) => t));
  });
  changed();
}

/** Cuántas unidades en oferta se vendieron en esta caja y todavía no se sincronizaron. */
export async function unsyncedOfferQty(): Promise<Map<string, number>> {
  const used = new Map<string, number>();
  await db.outbox.each((row) => {
    if (row.event.type !== 'SALE') return;
    for (const it of row.event.items) if (it.offerId) used.set(it.offerId, (used.get(it.offerId) ?? 0) + it.qty);
  });
  return used;
}

export async function linkDevice(name: string) {
  const res = await fetch('/api/pos/devices', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { token } = (await res.json()) as { token: string };
  await kvSet('deviceToken', token);
  await kvSet('deviceName', name);
  await refreshCatalog(true);
}

import { round3 } from '@almacen/shared';
import { db, type LocalTab } from './db';
import { enqueue } from './sync';

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

/** Abre una cuenta (mesa o nombre libre). Queda en la caja y se manda al servidor. */
export async function openTab(userId: string, label: string, table: number | null): Promise<LocalTab> {
  const tab: LocalTab = { id: uuid(), label, table, openedAt: nowIso(), items: [], pending: [] };
  await db.tabs.put(tab);
  await enqueue({ id: uuid(), type: 'TAB_OPEN', userId, occurredAt: tab.openedAt, tabId: tab.id, label, table });
  return tab;
}

/** Deja `qty` de un producto en la cuenta (0 = lo saca). */
export async function setTabQty(userId: string, tabId: string, p: { id: string; name: string; price: number; unit: 'UNIT' | 'KG' }, qty: number) {
  const tab = await db.tabs.get(tabId);
  if (!tab) return;
  const q = Math.max(0, round3(qty));
  const i = tab.items.findIndex((x) => x.productId === p.id);
  const items = [...tab.items];
  const unitPrice = i >= 0 ? items[i].unitPrice : p.price;
  if (q === 0) items.splice(i, i >= 0 ? 1 : 0);
  else if (i >= 0) items[i] = { ...items[i], qty: q };
  else items.push({ id: uuid(), productId: p.id, name: p.name, qty: q, unitPrice, unit: p.unit });
  await db.tabs.put({ ...tab, items });
  await enqueue({ id: uuid(), type: 'TAB_ITEM', userId, occurredAt: nowIso(), tabId, productId: p.id, qty: q, unitPrice });
}

/** Mesa que se fue sin consumir. */
export async function cancelTab(userId: string, tabId: string) {
  await db.tabs.delete(tabId);
  await enqueue({ id: uuid(), type: 'TAB_CANCEL', userId, occurredAt: nowIso(), tabId });
}

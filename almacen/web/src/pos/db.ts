import Dexie, { type Table } from 'dexie';
import type { CashMoveKind, Lang, Payment, PosEvent, StoreSettings } from '@almacen/shared';

export interface CatalogProduct {
  id: string;
  barcode: string | null;
  name: string;
  price: number;
  unit: 'UNIT' | 'KG';
  active: boolean;
  updatedAt: string;
  search: string;
  categoryId?: string | null;
  /** Botón rápido en la caja táctil. */
  quickKey?: boolean;
}
export interface CategoryRow {
  id: string;
  name: string;
}
export interface OfferRow {
  id: string;
  productId: string;
  offerPrice: number;
  discountPct: number;
  maxQty: number;
}
export interface PosUser {
  id: string;
  name: string;
  lang: Lang;
  role: 'OWNER' | 'EMPLOYEE';
  perms: string[];
  /** Puede cobrar (el resto solo ficha). Las cajas viejas no lo traen: se toma como sí. */
  canSell?: boolean;
  pin: string;
}
export interface SupplierRow {
  id: string;
  name: string;
}
/** Pago, gasto, retiro o ingreso de cambio anotado en la caja (para calcular el cierre sin internet). */
export interface CashMoveLocal {
  id: string;
  kind: CashMoveKind;
  amount: number;
  reason?: string;
  supplierName?: string;
  occurredAt: string;
}
export interface OutboxRow {
  seq?: number;
  id: string;
  event: PosEvent;
}
export interface LocalSale {
  id: string;
  occurredAt: string;
  userId: string;
  cashSessionId: string;
  lines: { name: string; qty: number; unitPrice: number; lineTotal: number; offer: boolean }[];
  total: number;
  payments: Payment[];
  change: number;
  voided?: boolean;
}
export interface CashSessionLocal {
  id: string;
  userId: string;
  openedAt: string;
  openingAmount: number;
}
/** Renglón de una cuenta de mesa. */
export interface TabLine {
  id: string;
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  unit?: 'UNIT' | 'KG';
}
/** Cuenta abierta de una mesa: se anota en la caja (anda sin internet) y se cobra al final. */
export interface LocalTab {
  id: string;
  label: string;
  table: number | null;
  openedAt: string;
  items: TabLine[];
  /** Lo que pidió el cliente desde el menú QR y falta aceptar. */
  pending: TabLine[];
}
/** Novedades que deja el que cierra la caja para el turno siguiente. */
export interface Handover {
  notes: string;
  user: string;
  closedAt: string;
}
export interface StoreInfo {
  name: string;
  code: string;
  currency: string;
  timezone: string;
  settings: StoreSettings;
  /** Hay QR de Mercado Pago armados: se puede cobrar con el monto cargado. */
  mp?: boolean;
}

class PosDB extends Dexie {
  products!: Table<CatalogProduct, string>;
  offers!: Table<OfferRow, string>;
  users!: Table<PosUser, string>;
  outbox!: Table<OutboxRow, number>;
  rejected!: Table<{ id: string; error?: string; event?: PosEvent }, string>;
  sales!: Table<LocalSale, string>;
  kv!: Table<{ key: string; value: unknown }, string>;
  tabs!: Table<LocalTab, string>;

  constructor() {
    super('almacen-pos');
    this.version(1).stores({
      products: 'id, barcode, updatedAt',
      offers: 'id, productId',
      users: 'id',
      outbox: '++seq, &id',
      rejected: 'id',
      sales: 'id, occurredAt, cashSessionId',
      kv: 'key',
    });
    this.version(2).stores({ tabs: 'id' });
  }
}

export const db = new PosDB();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}
export async function kvSet(key: string, value: unknown) {
  await db.kv.put({ key, value });
}
export async function kvDel(key: string) {
  await db.kv.delete(key);
}

/** Texto normalizado para buscar sin acentos ni mayúsculas. */
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

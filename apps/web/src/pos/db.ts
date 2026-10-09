import Dexie, { type Table } from 'dexie';
import type { CashMoveKind, Lang, Payment, PosEvent, StoreSettings } from '@super-chino/shared';

export interface CatalogProduct {
  id: string;
  barcode: string | null;
  name: string;
  price: number;
  unit: 'UNIT' | 'KG';
  active: boolean;
  updatedAt: string;
  search: string;
  /** Casa de celulares: moneda del precio, con IMEI, servicio y garantía propia. */
  currency?: 'ARS' | 'USD';
  serialized?: boolean;
  isService?: boolean;
  warrantyMonths?: number | null;
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
  currency?: 'ARS' | 'USD';
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
  lines: { name: string; qty: number; unitPrice: number; lineTotal: number; offer: boolean; imei?: string | null; condition?: string | null; warrantyUntil?: string | null }[];
  total: number;
  payments: Payment[];
  change: number;
  voided?: boolean;
  /** Casa de celulares. */
  cashArs?: number;
  cashUsd?: number;
  changeUsd?: number;
  rate?: number | null;
  customerName?: string | null;
}
export interface CashSessionLocal {
  id: string;
  userId: string;
  openedAt: string;
  openingAmount: number;
  openingUsd?: number;
}
export interface StoreInfo {
  name: string;
  code: string;
  currency: string;
  timezone: string;
  settings: StoreSettings;
}

/** Lo que la caja de una casa de celulares guarda para trabajar sin internet. */
export interface PhoneData {
  rate: number | null;
  quotes: { casa: string; compra: number; venta: number; fetchedAt: string }[];
  serials: {
    id: string;
    productId: string;
    name: string;
    imei1: string | null;
    imei2: string | null;
    serial: string | null;
    condition: 'NEW' | 'USED' | 'REFURB';
    grade: string | null;
    battery: number | null;
    color: string | null;
    price: number;
    currency: 'ARS' | 'USD';
    status: 'AVAILABLE' | 'RESERVED';
    customerId: string | null;
  }[];
  tradeIns: { id: string; number: number; customerId: string; customer: string; model: string; amountUsd: number; payout: 'CREDIT' | 'CASH' }[];
  deposits: { id: string; customerId: string | null; customer: string | null; serialItemId: string | null; repairOrderId: string | null; orderId: string | null; amount: number; currency: string; fx: number | null; expiresAt: string | null }[];
  repairs: { id: string; number: number; customerId: string; customer: string; device: string; status: string; amount: number; currency: 'ARS' | 'USD' }[];
  repairProductId: string;
  customers: { id: string; name: string; phone: string | null; dni: string | null }[];
  couriers: { id: string; name: string; pendingArs: number; pendingUsd: number }[];
}

class PosDB extends Dexie {
  products!: Table<CatalogProduct, string>;
  offers!: Table<OfferRow, string>;
  users!: Table<PosUser, string>;
  outbox!: Table<OutboxRow, number>;
  rejected!: Table<{ id: string; error?: string; event?: PosEvent }, string>;
  sales!: Table<LocalSale, string>;
  kv!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('superchino-pos');
    this.version(1).stores({
      products: 'id, barcode, updatedAt',
      offers: 'id, productId',
      users: 'id',
      outbox: '++seq, &id',
      rejected: 'id',
      sales: 'id, occurredAt, cashSessionId',
      kv: 'key',
    });
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

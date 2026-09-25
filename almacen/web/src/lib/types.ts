export type Unit = 'UNIT' | 'KG';

export interface Product {
  id: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  categoryId: string | null;
  category: string | null;
  supplierId: string | null;
  supplier: string | null;
  unit: Unit;
  price: number;
  cost: number;
  minStock: number;
  idealStock: number | null;
  refStock: number | null;
  targetMargin: number | null;
  contentQty: number | null;
  contentUnit: 'g' | 'kg' | 'ml' | 'l' | 'u' | null;
  unallocatedSold: number;
  active: boolean;
  updatedAt: string;
  stock: number;
  nearestExpiry: string | null;
}

export interface Category {
  id: string;
  name: string;
}
export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  leadTimeDays: number;
  /** Productos activos de este proveedor. */
  products?: number;
}

export interface PriceSuggestion {
  productId: string;
  name: string;
  oldPrice: number;
  suggestedPrice: number;
  cost: number;
}

export interface LotRow {
  id: string;
  productId: string;
  product: string;
  unit: Unit;
  price: number;
  lotCode: string | null;
  expiresAt: string | null;
  daysLeft: number | null;
  qtyRemaining: number;
  unitCost: number;
  offer: { status: string; offerPrice: number } | null;
}

export interface Movement {
  id: string;
  productId: string;
  product?: string;
  type: 'ENTRY' | 'SALE' | 'VOID' | 'ADJUSTMENT' | 'WASTE' | 'COUNT';
  qty: number;
  reason: string | null;
  user: string | null;
  createdAt: string;
}

export interface ProductDetail extends Product {
  lots: { id: string; lotCode: string | null; expiresAt: string | null; qtyRemaining: number; unitCost: number; receivedAt: string }[];
  movements: Movement[];
  priceHistory: { id: string; oldPrice: number; newPrice: number; source: 'manual' | 'bulk' | 'margin' | 'import'; user: string | null; createdAt: string }[];
}

export interface Msg {
  id: string;
  kind: 'MESSAGE' | 'TASK';
  text: string;
  lang: 'es' | 'zh';
  translations: Partial<Record<'es' | 'zh', string>>;
  translationStatus: 'none' | 'pending' | 'done' | 'failed';
  requiresPhoto: boolean;
  dueAt: string | null;
  meta: { type?: 'REMOVE_EXPIRED' | 'COUNT'; lotIds?: string[]; countId?: string } | null;
  createdAt: string;
  from: { id: string; name: string } | null;
  doneAt: string | null;
  doneBy: string | null;
  donePhoto: string | null;
  doneNote: string | null;
  myReadAt: string | null;
  recipients: { userId: string; name: string; readAt: string | null }[];
}

export type AlertType = 'EXPIRING' | 'EXPIRED' | 'LOW_STOCK' | 'NEGATIVE_STOCK' | 'VOID_SPIKE' | 'CASH_DIFF' | 'COUNT_DIFF' | 'OFFER_SUGGESTED' | 'LATE' | 'ABSENT' | 'SHORTAGE';
export interface AlertRow {
  id: string;
  type: AlertType;
  severity: 'info' | 'warn' | 'danger';
  data: Record<string, string | number | null>;
  createdAt: string;
  resolvedAt: string | null;
}

export interface OfferRow {
  id: string;
  productId: string;
  name: string;
  barcode: string | null;
  listPrice: number;
  offerPrice: number;
  discountPct: number;
  status: 'SUGGESTED' | 'ACTIVE' | 'DISMISSED' | 'ENDED';
  reason: { qty?: number; perDay?: number; days?: number; daysToSell?: number | null };
  lotCode: string | null;
  expiresAt: string | null;
  daysLeft: number | null;
  remaining: number;
  soldQty: number;
  soldAmount: number;
}

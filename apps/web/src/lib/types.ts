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
  targetMargin: number | null;
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
  priceHistory: { id: string; oldPrice: number; newPrice: number; source: 'manual' | 'bulk' | 'margin'; user: string | null; createdAt: string }[];
}

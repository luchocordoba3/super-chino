import { round2, round3 } from '@super-chino/shared';

export interface CartItem {
  productId: string;
  name: string;
  unit: 'UNIT' | 'KG';
  qty: number;
  listPrice: number;
  /** Precio cambiado a mano por el cajero (queda marcado para el control anti-pérdidas). */
  overridePrice?: number | null;
}
export interface OfferInfo {
  id: string;
  offerPrice: number;
  /** Unidades que quedan en el lote en oferta. */
  remaining: number;
}
export interface PricedLine {
  key: string;
  productId: string;
  name: string;
  unit: 'UNIT' | 'KG';
  qty: number;
  unitPrice: number;
  listPrice: number;
  offerId: string | null;
  priceOverride: boolean;
  lineTotal: number;
}

/** Agrega al carrito (si ya está el producto, suma la cantidad). */
export function addItem(items: CartItem[], p: { id: string; name: string; unit: 'UNIT' | 'KG'; price: number }, qty: number): CartItem[] {
  const i = items.findIndex((x) => x.productId === p.id && x.overridePrice == null);
  if (i >= 0) return items.map((x, j) => (j === i ? { ...x, qty: round3(x.qty + qty) } : x));
  return [...items, { productId: p.id, name: p.name, unit: p.unit, qty: round3(qty), listPrice: p.price }];
}

/**
 * Calcula precios: la oferta se aplica solo hasta agotar su lote; el resto va a precio normal.
 * Un producto puede quedar en dos renglones (en oferta y sin oferta).
 */
export function priceCart(items: CartItem[], offers: Map<string, OfferInfo>): PricedLine[] {
  const out: PricedLine[] = [];
  const used = new Map<string, number>();
  items.forEach((it, idx) => {
    const base = { productId: it.productId, name: it.name, unit: it.unit, listPrice: it.listPrice };
    if (it.overridePrice != null) {
      out.push({ ...base, key: `${idx}o`, qty: it.qty, unitPrice: it.overridePrice, offerId: null, priceOverride: true, lineTotal: round2(it.qty * it.overridePrice) });
      return;
    }
    const offer = offers.get(it.productId);
    const avail = offer ? Math.max(0, round3(offer.remaining - (used.get(offer.id) ?? 0))) : 0;
    const offerQty = offer && offer.offerPrice < it.listPrice ? Math.min(it.qty, avail) : 0;
    if (offer && offerQty > 0) {
      used.set(offer.id, round3((used.get(offer.id) ?? 0) + offerQty));
      out.push({ ...base, key: `${idx}a`, qty: offerQty, unitPrice: offer.offerPrice, offerId: offer.id, priceOverride: false, lineTotal: round2(offerQty * offer.offerPrice) });
    }
    const rest = round3(it.qty - offerQty);
    if (rest > 0) out.push({ ...base, key: `${idx}b`, qty: rest, unitPrice: it.listPrice, offerId: null, priceOverride: false, lineTotal: round2(rest * it.listPrice) });
  });
  return out;
}

export const cartTotal = (lines: PricedLine[]) => round2(lines.reduce((s, l) => s + l.lineTotal, 0));

/** "3*7790001" => { qty: 3, code: "7790001" } */
export function parseScan(input: string): { qty: number | null; code: string } {
  const m = input.trim().match(/^(\d+(?:[.,]\d+)?)\s*[*xX]\s*(.*)$/);
  if (!m) return { qty: null, code: input.trim() };
  return { qty: Number(m[1].replace(',', '.')), code: m[2].trim() };
}

/** Reparte el total entre medios de pago. En efectivo puede sobrar (vuelto). */
export function settlePayments(total: number, rows: { method: string; amount: number }[]) {
  let remaining = round2(total);
  const payments: { method: string; amount: number }[] = [];
  let change = 0;
  for (const r of rows) {
    if (remaining <= 0 || r.amount <= 0) continue;
    const applied = Math.min(r.amount, remaining);
    if (r.method === 'CASH' && r.amount > remaining) change = round2(change + r.amount - remaining);
    payments.push({ method: r.method, amount: round2(applied) });
    remaining = round2(remaining - applied);
  }
  return { payments, change, missing: remaining > 0 ? remaining : 0 };
}

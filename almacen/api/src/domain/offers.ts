import { roundPrice } from './pricing';

export interface OfferInput {
  daysToExpiry: number;
  /** Unidades de este lote + las de lotes que vencen antes (FEFO: se venden primero). */
  qtyAhead: number;
  /** Venta diaria promedio del producto. */
  perDay: number;
  price: number;
  unitCost: number;
  tiers: { days: number; pct: number }[];
  allowBelowCostDays: number;
  rounding: number;
}

/**
 * ¿Hay que liquidar este lote? Si al ritmo actual no se vende antes de vencer, sugiere un descuento
 * escalonado según los días que faltan. No baja del costo salvo en los últimos días.
 */
export function suggestOffer(i: OfferInput): { discountPct: number; offerPrice: number; daysToSell: number | null } | null {
  if (i.daysToExpiry < 0 || i.price <= 0) return null;
  const daysToSell = i.perDay > 0 ? i.qtyAhead / i.perDay : Infinity;
  if (daysToSell <= i.daysToExpiry) return null;
  const tier = [...i.tiers].sort((a, b) => a.days - b.days).find((t) => i.daysToExpiry <= t.days);
  if (!tier) return null;
  let price = roundPrice(i.price * (1 - tier.pct / 100), i.rounding, 'down');
  if (i.daysToExpiry > i.allowBelowCostDays && price < i.unitCost) price = roundPrice(i.unitCost, i.rounding, 'up');
  if (price <= 0 || price >= i.price) return null;
  return {
    discountPct: Math.round((1 - price / i.price) * 100),
    offerPrice: price,
    daysToSell: Number.isFinite(daysToSell) ? Math.round(daysToSell * 10) / 10 : null,
  };
}

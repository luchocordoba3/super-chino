/** Hasta este % el producto se ve amarillo (a medias); por debajo de `lowPct`, rojo. */
export const MID_PCT = 50;

export type StockLevel = 'ok' | 'mid' | 'low' | 'none';

/**
 * Stock en %: el 100% es el stock ideal que cargó el dueño o, si no hay, lo que quedó después de la
 * última reposición. También cuántos días alcanza al ritmo de venta de las últimas semanas.
 */
export function stockLevel(a: { stock: number; idealStock: number | null; refStock: number | null; minStock: number; perDay: number; lowPct: number }) {
  const ref = a.idealStock != null && a.idealStock > 0 ? a.idealStock : a.refStock != null && a.refStock > 0 ? a.refStock : null;
  const pct = ref == null ? null : Math.min(100, Math.max(0, Math.round((a.stock / ref) * 100)));
  const daysLeft = a.perDay > 0 ? Math.max(0, Math.floor(a.stock / a.perDay)) : null;
  const low = a.stock <= 0 || (a.minStock > 0 && a.stock <= a.minStock) || (pct != null && pct <= a.lowPct);
  const level: StockLevel = low ? 'low' : pct == null ? 'none' : pct <= MID_PCT ? 'mid' : 'ok';
  return { pct, ref, daysLeft, level };
}

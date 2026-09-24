import { round2 } from '@super-chino/shared';

/** Redondea un precio a múltiplos de `step` (ej. 10 => a los $10). */
export function roundPrice(value: number, step: number, mode: 'up' | 'down' | 'nearest' = 'nearest') {
  if (!step || step <= 0) return round2(value);
  const q = value / step;
  const r = mode === 'up' ? Math.ceil(q - 1e-9) : mode === 'down' ? Math.floor(q + 1e-9) : Math.round(q);
  return round2(r * step);
}

/** Precio que mantiene el margen objetivo sobre el costo, redondeado para arriba. */
export const marginPrice = (cost: number, marginPct: number, step: number) => roundPrice(cost * (1 + marginPct / 100), step, 'up');

/** Suba/baja masiva por porcentaje: sube redondeando para arriba, baja redondeando para abajo. */
export function bulkPrice(price: number, percent: number, step: number) {
  const raw = price * (1 + percent / 100);
  const p = roundPrice(raw, step, percent >= 0 ? 'up' : 'down');
  return p > 0 ? p : roundPrice(raw, 0);
}

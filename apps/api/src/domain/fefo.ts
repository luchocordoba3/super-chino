import { round3 } from '@super-chino/shared';

export interface LotStock {
  id: string;
  expiresAt: Date | null;
  receivedAt: Date;
  qtyRemaining: number;
  unitCost: number;
}
export interface Allocation {
  lotId: string | null;
  qty: number;
  unitCost: number;
}

/** Orden FEFO: primero el que vence antes; sin vencimiento al final; a igual fecha, el más viejo. */
export function fefoCompare(a: Pick<LotStock, 'expiresAt' | 'receivedAt'>, b: Pick<LotStock, 'expiresAt' | 'receivedAt'>) {
  if (a.expiresAt && b.expiresAt) {
    const d = a.expiresAt.getTime() - b.expiresAt.getTime();
    if (d) return d;
  } else if (a.expiresAt) return -1;
  else if (b.expiresAt) return 1;
  return a.receivedAt.getTime() - b.receivedAt.getTime();
}

/**
 * Reparte una cantidad vendida entre lotes (FEFO). Los lotes vencidos se usan solo si no queda otra.
 * Si no alcanza el stock registrado, el resto queda con lotId null ("vendido sin stock").
 */
export function allocateFefo(lots: LotStock[], qty: number, today: Date, fallbackCost: number): Allocation[] {
  const usable = lots.filter((l) => l.qtyRemaining > 0);
  const fresh = usable.filter((l) => !l.expiresAt || l.expiresAt >= today).sort(fefoCompare);
  const expired = usable.filter((l) => l.expiresAt && l.expiresAt < today).sort(fefoCompare);
  let left = round3(qty);
  const out: Allocation[] = [];
  for (const lot of [...fresh, ...expired]) {
    if (left <= 0) break;
    const take = round3(Math.min(lot.qtyRemaining, left));
    out.push({ lotId: lot.id, qty: take, unitCost: lot.unitCost });
    left = round3(left - take);
  }
  if (left > 0) out.push({ lotId: null, qty: left, unitCost: fallbackCost });
  return out;
}

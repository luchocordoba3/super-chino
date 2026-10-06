import type { Business, CustomerType } from '@prisma/client';
import type { QuoteSettings } from '@vidrieria/shared';
import { num } from '../db';

export function quoteSettings(b: Business, dollarRate: number): QuoteSettings {
  return {
    dollarRate,
    wastePct: num(b.wastePct),
    depositPct: num(b.depositPct),
    urgencyPct: num(b.urgencyPct),
    freightPerKm: num(b.freightPerKm),
    pricesIncludeVat: b.pricesIncludeVat,
    vatPct: num(b.vatPct),
    roundToCm: b.roundToCm,
    minAreaM2: num(b.minAreaM2),
  };
}

/** % de ajuste para un tipo de cliente (ej. -10 a otras vidrierías). */
export function adjustFor(b: Pick<Business, 'customerAdjust'>, type: CustomerType | null | undefined) {
  if (!type) return 0;
  const map = (b.customerAdjust ?? {}) as Record<string, unknown>;
  const v = Number(map[type]);
  return Number.isFinite(v) ? v : 0;
}

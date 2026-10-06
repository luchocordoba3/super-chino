import type { Business, DollarSource } from '@prisma/client';
import { num, prisma } from '../db';

const URLS: Record<Exclude<DollarSource, 'MANUAL'>, string> = {
  OFICIAL: 'https://dolarapi.com/v1/dolares/oficial',
  BLUE: 'https://dolarapi.com/v1/dolares/blue',
};

/** Lee el dólar oficial y el blue (precio de venta) y guarda el último valor. */
export async function refreshDollar() {
  for (const [source, url] of Object.entries(URLS) as [Exclude<DollarSource, 'MANUAL'>, string][]) {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`dolarapi ${res.status}`);
    const data = (await res.json()) as { venta?: number };
    if (!data.venta || data.venta <= 0) continue;
    await prisma.dollarRate.upsert({
      where: { source },
      create: { source, sell: data.venta, fetchedAt: new Date() },
      update: { sell: data.venta, fetchedAt: new Date() },
    });
  }
}

export interface DollarInfo {
  rate: number;
  source: DollarSource;
  /** null si es manual o si todavía no se pudo leer y se usa el manual. */
  fetchedAt: string | null;
  /** true si se pidió automático pero no hay lectura y se usa el manual. */
  fallback: boolean;
}

/** Cotización que usa la vidriería: la automática elegida o, si no hay, la manual. */
export async function dollarFor(b: Pick<Business, 'dollarSource' | 'dollarManual'>): Promise<DollarInfo> {
  if (b.dollarSource !== 'MANUAL') {
    const r = await prisma.dollarRate.findUnique({ where: { source: b.dollarSource } });
    if (r) return { rate: num(r.sell), source: b.dollarSource, fetchedAt: r.fetchedAt.toISOString(), fallback: false };
    return { rate: num(b.dollarManual), source: b.dollarSource, fetchedAt: null, fallback: true };
  }
  return { rate: num(b.dollarManual), source: 'MANUAL', fetchedAt: null, fallback: false };
}

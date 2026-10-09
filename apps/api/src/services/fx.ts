// Cotización del dólar: se baja de dolarapi.com (o bluelytics si falla) y queda guardada.
import { effectiveRate, parseSettings, type RateQuote } from '@super-chino/shared';
import type { FastifyBaseLogger } from 'fastify';
import { type Db, num, prisma } from '../db';

type Fetcher = typeof fetch;
const CASAS = ['oficial', 'blue', 'bolsa', 'tarjeta'] as const;

async function getJson(f: Fetcher, url: string): Promise<unknown> {
  const res = await f(url, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

/** dolarapi.com: [{ casa, compra, venta, fechaActualizacion }] */
async function fromDolarApi(f: Fetcher) {
  const data = (await getJson(f, 'https://dolarapi.com/v1/dolares')) as { casa?: string; compra?: number; venta?: number }[];
  return data
    .filter((d) => d.casa && (CASAS as readonly string[]).includes(d.casa) && Number(d.venta) > 0)
    .map((d) => ({ casa: d.casa!, compra: Number(d.compra ?? d.venta), venta: Number(d.venta), source: 'dolarapi' }));
}

/** bluelytics: { oficial: { value_buy, value_sell }, blue: {...} } (solo oficial y blue). */
async function fromBluelytics(f: Fetcher) {
  const data = (await getJson(f, 'https://api.bluelytics.com.ar/v2/latest')) as Record<string, { value_buy?: number; value_sell?: number }>;
  return (['oficial', 'blue'] as const)
    .filter((k) => Number(data[k]?.value_sell) > 0)
    .map((k) => ({ casa: k, compra: Number(data[k].value_buy ?? data[k].value_sell), venta: Number(data[k].value_sell), source: 'bluelytics' }));
}

/** Baja las cotizaciones y las guarda. Devuelve cuántas guardó (0 si no hubo internet). */
export async function refreshRates(f: Fetcher = fetch, log?: FastifyBaseLogger) {
  let rows: { casa: string; compra: number; venta: number; source: string }[] = [];
  try {
    rows = await fromDolarApi(f);
  } catch (e) {
    log?.warn({ err: e }, 'dolarapi');
  }
  if (rows.length === 0) {
    try {
      rows = await fromBluelytics(f);
    } catch (e) {
      log?.warn({ err: e }, 'bluelytics');
    }
  }
  if (rows.length) await prisma.exchangeRate.createMany({ data: rows });
  // Se guarda solo lo último de cada día y casa (para el historial) más lo de las últimas 48 hs.
  await prisma.$executeRaw`
    DELETE FROM "ExchangeRate" e WHERE e."fetchedAt" < now() - interval '48 hours' AND EXISTS (
      SELECT 1 FROM "ExchangeRate" x WHERE x.casa = e.casa AND x."fetchedAt"::date = e."fetchedAt"::date AND x."fetchedAt" > e."fetchedAt")`;
  return rows.length;
}

/** Última cotización de cada casa. */
export async function latestQuotes(db: Db = prisma): Promise<RateQuote[]> {
  const rows = await db.exchangeRate.findMany({ where: { fetchedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, orderBy: { fetchedAt: 'desc' }, take: 200 });
  const seen = new Map<string, RateQuote>();
  for (const r of rows) {
    if (!seen.has(r.casa)) seen.set(r.casa, { casa: r.casa, compra: num(r.compra), venta: num(r.venta), fetchedAt: r.fetchedAt.toISOString() });
  }
  return [...seen.values()];
}

/** Pesos por dólar del local en este momento (null si no hay ninguna cotización). */
export async function storeRate(storeId: string, db: Db = prisma) {
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { settings: true } });
  const quotes = await latestQuotes(db);
  return { rate: effectiveRate(parseSettings(store.settings), quotes), quotes };
}

/** Cotización histórica de una fecha (la última de ese día), para reportes. */
export async function rateOn(casa: string, day: Date) {
  const r = await prisma.exchangeRate.findFirst({ where: { casa, fetchedAt: { lt: new Date(day.getTime() + 86_400_000) } }, orderBy: { fetchedAt: 'desc' } });
  return r ? num(r.venta) : null;
}

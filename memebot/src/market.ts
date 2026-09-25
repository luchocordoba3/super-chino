import { z } from 'zod';
import type { PairMetrics } from './types';
import { errMsg, getJson, log, type Fetch } from './util';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const QUOTE_MINTS = new Set([SOL_MINT, USDC_MINT]);

export interface Market {
  /** Monedas que conviene mirar ahora (en tendencia o recién promocionadas). */
  discover(): Promise<string[]>;
  metrics(mints: string[]): Promise<Map<string, PairMetrics>>;
}

const Txns = z.object({ buys: z.number().default(0), sells: z.number().default(0) });
const DexPair = z.object({
  chainId: z.string(),
  baseToken: z.object({ address: z.string(), symbol: z.string().default('?') }),
  quoteToken: z.object({ address: z.string() }),
  priceUsd: z.coerce.number(),
  txns: z.object({ m5: Txns.optional(), h1: Txns.optional() }).default({}),
  volume: z.object({ m5: z.number().optional(), h1: z.number().optional() }).default({}),
  priceChange: z.object({ m5: z.number().optional(), h1: z.number().optional() }).default({}),
  liquidity: z.object({ usd: z.number() }),
  fdv: z.number().optional(),
  marketCap: z.number().optional(),
  pairCreatedAt: z.number(),
});

/** Por cada moneda se queda con su par contra SOL o USDC de mayor liquidez. Descarta los pares incompletos. */
export function bestPairs(payload: unknown): Map<string, PairMetrics> {
  const list = Array.isArray(payload) ? payload : (payload as { pairs?: unknown } | null)?.pairs;
  const out = new Map<string, PairMetrics>();
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    const r = DexPair.safeParse(item);
    if (!r.success) continue;
    const p = r.data;
    if (p.chainId !== 'solana' || !QUOTE_MINTS.has(p.quoteToken.address)) continue;
    const m: PairMetrics = {
      mint: p.baseToken.address,
      symbol: p.baseToken.symbol,
      priceUsd: p.priceUsd,
      liquidityUsd: p.liquidity.usd,
      marketCapUsd: p.marketCap ?? p.fdv ?? 0,
      volumeM5: p.volume.m5 ?? 0,
      volumeH1: p.volume.h1 ?? 0,
      priceChangeM5: p.priceChange.m5 ?? 0,
      priceChangeH1: p.priceChange.h1 ?? 0,
      buysM5: p.txns.m5?.buys ?? 0,
      sellsM5: p.txns.m5?.sells ?? 0,
      buysH1: p.txns.h1?.buys ?? 0,
      sellsH1: p.txns.h1?.sells ?? 0,
      pairCreatedAt: p.pairCreatedAt,
    };
    const prev = out.get(m.mint);
    if (!prev || m.liquidityUsd > prev.liquidityUsd) out.set(m.mint, m);
  }
  return out;
}

const DexTokenRef = z.object({ chainId: z.string(), tokenAddress: z.string() });

/** Monedas de Solana en las listas de promocionadas / perfiles recientes de DexScreener. */
export function dexscreenerMints(payload: unknown): string[] {
  const list = Array.isArray(payload) ? payload : [payload];
  return list.flatMap((item) => {
    const r = DexTokenRef.safeParse(item);
    return r.success && r.data.chainId === 'solana' ? [r.data.tokenAddress] : [];
  });
}

const GeckoPool = z.object({
  relationships: z.object({ base_token: z.object({ data: z.object({ id: z.string() }) }) }),
});

/** Monedas base de los pools en tendencia de GeckoTerminal (ids con forma `solana_<mint>`). */
export function geckoMints(payload: unknown): string[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const r = GeckoPool.safeParse(item);
    const id = r.success ? r.data.relationships.base_token.data.id : '';
    return id.startsWith('solana_') ? [id.slice('solana_'.length)] : [];
  });
}

const SOURCES: [string, (payload: unknown) => string[]][] = [
  ['https://api.geckoterminal.com/api/v2/networks/solana/trending_pools', geckoMints],
  ['https://api.dexscreener.com/token-boosts/latest/v1', dexscreenerMints],
  ['https://api.dexscreener.com/token-profiles/latest/v1', dexscreenerMints],
];

export class LiveMarket implements Market {
  constructor(private fetchImpl: Fetch = fetch) {}

  async discover(): Promise<string[]> {
    const results = await Promise.allSettled(
      SOURCES.map(async ([url, parse]) => parse(await getJson(url, {}, this.fetchImpl))),
    );
    const mints = new Set<string>();
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') r.value.forEach((m) => mints.add(m));
      else log('warn', `fuente ${SOURCES[i][0]} falló: ${errMsg(r.reason)}`);
    });
    for (const m of QUOTE_MINTS) mints.delete(m);
    return [...mints];
  }

  /** DexScreener acepta hasta 30 monedas por consulta. */
  async metrics(mints: string[]): Promise<Map<string, PairMetrics>> {
    const out = new Map<string, PairMetrics>();
    for (let i = 0; i < mints.length; i += 30) {
      const chunk = mints.slice(i, i + 30).join(',');
      const payload = await getJson(`https://api.dexscreener.com/tokens/v1/solana/${chunk}`, {}, this.fetchImpl);
      for (const [mint, m] of bestPairs(payload)) out.set(mint, m);
    }
    return out;
  }
}

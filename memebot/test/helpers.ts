import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bot } from '../src/bot';
import { PaperBroker, type Quote, type Quoter } from '../src/broker';
import { parseConfig, type Config } from '../src/config';
import { USDC_MINT, type Market } from '../src/market';
import type { Safety, SafetyReport } from '../src/safety';
import { Store, freshState } from '../src/state';
import type { PairMetrics } from '../src/types';

export const NOW = Date.UTC(2026, 8, 25, 12);

export const cfgWith = (o: Partial<Config> = {}): Config => ({ ...parseConfig({}), ...o });

/** Una moneda que pasa todos los filtros con la configuración por defecto. */
export function metrics(mint: string, o: Partial<PairMetrics> = {}): PairMetrics {
  return {
    mint,
    symbol: mint.toUpperCase(),
    priceUsd: 0.01,
    liquidityUsd: 200_000,
    marketCapUsd: 2_000_000,
    volumeM5: 50_000,
    volumeH1: 300_000,
    priceChangeM5: 5,
    priceChangeH1: 60,
    buysM5: 120,
    sellsM5: 60,
    buysH1: 1200,
    sellsH1: 600,
    pairCreatedAt: NOW - 5 * 3_600_000,
    ...o,
  };
}

/** Mercado falso: DexScreener y Jupiter usan la misma tabla de precios. Todas las monedas tienen 6 decimales, como USDC. */
export class FakeMarket implements Market, Quoter {
  data = new Map<string, PairMetrics>();
  discovered: string[] = [];
  /** Empeora las compras de más de US$1 en esta fracción (para simular impacto en el precio). */
  impact = new Map<string, number>();

  set(mint: string, o: Partial<PairMetrics> = {}): void {
    this.data.set(mint, { ...(this.data.get(mint) ?? metrics(mint)), ...o });
    if (!this.discovered.includes(mint)) this.discovered.push(mint);
  }

  price(mint: string, priceUsd: number): void {
    this.set(mint, { priceUsd });
  }

  async discover(): Promise<string[]> {
    return [...this.discovered];
  }

  async metrics(mints: string[]): Promise<Map<string, PairMetrics>> {
    return new Map(mints.flatMap((m) => (this.data.has(m) ? [[m, this.data.get(m)!] as const] : [])));
  }

  async quote(inputMint: string, outputMint: string, amount: bigint): Promise<Quote> {
    const buying = inputMint === USDC_MINT;
    const token = buying ? outputMint : inputMint;
    const m = this.data.get(token);
    if (!m || m.priceUsd <= 0) throw new Error('sin ruta');
    let out = buying ? Number(amount) / m.priceUsd : Number(amount) * m.priceUsd;
    if (buying && amount > 1_000_000n) out *= 1 - (this.impact.get(token) ?? 0);
    return { inAmount: amount, outAmount: BigInt(Math.floor(out)), raw: {} };
  }
}

export class FakeSafety implements Safety {
  reports = new Map<string, SafetyReport>();

  async check(mint: string): Promise<SafetyReport> {
    return this.reports.get(mint) ?? { ok: true, decimals: 6 };
  }
}

/** Bot en simulación, sin red, con reloj manual y estado en una carpeta temporal. */
export function setup(o: Partial<Config> = {}, cash = 1000) {
  const cfg = cfgWith({ PAPER_FEE_USD: 0, PAPER_SLIPPAGE_PCT: 0, ...o });
  const market = new FakeMarket();
  const safety = new FakeSafety();
  const store = new Store(mkdtempSync(join(tmpdir(), 'memebot-')), 'paper');
  const state = freshState('paper', cash, NOW);
  const clock = { t: NOW };
  const notes: string[] = [];
  const broker = new PaperBroker(market, state, cfg.PAPER_FEE_USD, cfg.PAPER_SLIPPAGE_PCT);
  const deps = {
    cfg,
    market,
    safety,
    store,
    broker,
    notify: async (msg: string) => {
      notes.push(msg);
    },
    now: () => clock.t,
  };
  const bot = new Bot(deps, state);
  const advance = (ms: number) => {
    clock.t += ms;
  };
  return { cfg, market, safety, store, state, bot, deps, notes, advance };
}

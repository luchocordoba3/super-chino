import type { Config } from './config';
import type { PairMetrics, Position } from './types';
import { clamp } from './util';

const ratio = (buys: number, sells: number) => buys / Math.max(sells, 1);

/** Motivo por el que una moneda no califica para entrar, o `null` si pasa todos los filtros. */
export function rejectReason(m: PairMetrics, cfg: Config, now: number): string | null {
  const ageMin = (now - m.pairCreatedAt) / 60_000;
  if (m.liquidityUsd < cfg.MIN_LIQUIDITY_USD) return 'liquidez baja';
  if (m.volumeH1 < cfg.MIN_VOLUME_H1_USD) return 'poco volumen';
  if (ageMin < cfg.PAIR_AGE_MIN_MINUTES) return 'demasiado nueva';
  if (ageMin > cfg.PAIR_AGE_MAX_HOURS * 60) return 'demasiado vieja';
  if (m.marketCapUsd < cfg.MCAP_MIN_USD || m.marketCapUsd > cfg.MCAP_MAX_USD) return 'capitalización fuera de rango';
  if (ratio(m.buysM5, m.sellsM5) < cfg.MIN_BUY_SELL_RATIO || ratio(m.buysH1, m.sellsH1) < cfg.MIN_BUY_SELL_RATIO) {
    return 'no dominan las compras';
  }
  if (m.priceChangeM5 <= 0) return 'sin impulso a 5 min';
  if (m.priceChangeH1 < cfg.PRICE_H1_MIN_PCT || m.priceChangeH1 > cfg.PRICE_H1_MAX_PCT) return 'suba de 1 h fuera de rango';
  return null;
}

/**
 * Puntaje de 0 a 1: presión compradora, aceleración del volumen (5 min ×12 contra 1 h),
 * suba de precio (con tope) y profundidad de liquidez.
 */
export function score(m: PairMetrics, cfg: Config): number {
  const share = (b: number, s: number) => (b + s === 0 ? 0.5 : b / (b + s));
  const pressure = clamp((0.5 * share(m.buysM5, m.sellsM5) + 0.5 * share(m.buysH1, m.sellsH1) - 0.5) / 0.3, 0, 1);
  const accel = m.volumeH1 > 0 ? clamp(((m.volumeM5 * 12) / m.volumeH1 - 0.5) / 1.5, 0, 1) : 0;
  const trend = 0.5 * clamp(m.priceChangeM5 / 10, 0, 1) + 0.5 * clamp(m.priceChangeH1 / 100, 0, 1);
  const depth = clamp(Math.log10(m.liquidityUsd / Math.max(cfg.MIN_LIQUIDITY_USD, 1)), 0, 1);
  return 0.3 * pressure + 0.3 * accel + 0.25 * trend + 0.15 * depth;
}

/** Tamaño de la compra: el menor entre una fracción del capital, una fracción del pool y el efectivo. */
export function positionSizeUsd(equity: number, cash: number, liquidityUsd: number, cfg: Config): number {
  const size = Math.min(equity * cfg.POSITION_FRACTION, liquidityUsd * cfg.MAX_POOL_FRACTION, cash);
  return size >= cfg.MIN_TRADE_USD ? Math.floor(size * 100) / 100 : 0;
}

export interface ExitDecision {
  /** 0 = mantener; 1 = vender todo. */
  sellFraction: number;
  reason: string;
  emergency: boolean;
  takeProfit?: boolean;
}

const HOLD: ExitDecision = { sellFraction: 0, reason: '', emergency: false };

export function exitDecision(p: Position, m: PairMetrics, cfg: Config, now: number): ExitDecision {
  const price = m.priceUsd;
  const pnlPct = (price / p.entryPrice - 1) * 100;
  const peak = Math.max(p.peakPrice, price);
  if (m.liquidityUsd < p.entryLiquidityUsd * (1 - cfg.RUG_LIQ_DROP_PCT / 100)) {
    return { sellFraction: 1, reason: 'la liquidez se desplomó', emergency: true };
  }
  if (pnlPct <= -cfg.STOP_LOSS_PCT) return { sellFraction: 1, reason: 'stop-loss', emergency: false };
  if (!p.tookProfit && pnlPct >= cfg.TAKE_PROFIT_PCT) {
    return { sellFraction: cfg.TAKE_PROFIT_SELL_FRACTION, reason: 'toma de ganancia', emergency: false, takeProfit: true };
  }
  if (p.tookProfit && price <= peak * (1 - cfg.TRAILING_STOP_PCT / 100)) {
    return { sellFraction: 1, reason: 'stop dinámico', emergency: false };
  }
  if (!p.tookProfit && now - p.openedAt >= cfg.TIME_STOP_MINUTES * 60_000 && pnlPct < cfg.TIME_STOP_MIN_GAIN_PCT) {
    return { sellFraction: 1, reason: 'sin impulso (tiempo)', emergency: false };
  }
  if (pnlPct < 0 && m.sellsM5 > 0 && ratio(m.buysM5, m.sellsM5) < cfg.EXIT_SELL_RATIO) {
    return { sellFraction: 1, reason: 'dominan las ventas', emergency: false };
  }
  return HOLD;
}

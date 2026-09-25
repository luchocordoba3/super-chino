export type Mode = 'paper' | 'live';
export type Status = 'running' | 'won' | 'busted';

/** Métricas de una moneda, tomadas de su par contra SOL o USDC con más liquidez. */
export interface PairMetrics {
  mint: string;
  symbol: string;
  priceUsd: number;
  liquidityUsd: number;
  marketCapUsd: number;
  volumeM5: number;
  volumeH1: number;
  priceChangeM5: number;
  priceChangeH1: number;
  buysM5: number;
  sellsM5: number;
  buysH1: number;
  sellsH1: number;
  pairCreatedAt: number;
}

export interface Position {
  mint: string;
  symbol: string;
  decimals: number;
  /** Cantidad en unidades mínimas del token (bigint guardado como texto). */
  amountRaw: string;
  /** Costo en USD de la parte que todavía se tiene. */
  costUsd: number;
  /** Precio de entrada en USD por token, con comisiones incluidas. */
  entryPrice: number;
  entryLiquidityUsd: number;
  peakPrice: number;
  openedAt: number;
  tookProfit: boolean;
  /** Ganancia o pérdida acumulada de las ventas parciales. */
  realizedPnlUsd: number;
}

export interface Trade {
  at: number;
  side: 'buy' | 'sell';
  mint: string;
  symbol: string;
  usd: number;
  amountRaw: string;
  reason: string;
  pnlUsd?: number;
  signature?: string;
}

export interface BotState {
  version: 1;
  mode: Mode;
  status: Status;
  startedAt: number;
  endedAt?: number;
  /** USDC disponible: en simulación es el saldo virtual; en real, el último saldo leído de la billetera. */
  cashUsd: number;
  positions: Position[];
  lossStreak: number;
  pausedUntil: number;
  /** Monedas en las que no se vuelve a entrar hasta la fecha indicada (ms). */
  cooldowns: Record<string, number>;
  lastEquityUsd: number;
  peakEquityUsd: number;
  trades: number;
}

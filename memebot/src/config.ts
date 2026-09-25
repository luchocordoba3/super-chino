import { z } from 'zod';

const num = (d: number) => z.coerce.number().min(0).default(d);
const fraction = (d: number) => z.coerce.number().gt(0).max(1).default(d);

/** Toda la configuración sale de variables de entorno (o del archivo .env). */
export const ConfigSchema = z.object({
  MODE: z.enum(['paper', 'live']).default('paper'),
  DATA_DIR: z.string().default('data'),

  // Meta y quiebra
  TARGET_USD: num(100_000),
  BUST_USD: num(10),

  // Simulación
  PAPER_START_USD: num(100),
  PAPER_FEE_USD: num(0.05),
  PAPER_SLIPPAGE_PCT: z.coerce.number().min(0).max(50).default(1),

  // Conexiones
  SOLANA_RPC_URL: z.url().default('https://api.mainnet-beta.solana.com'),
  WALLET_PRIVATE_KEY: z.string().optional(),
  JUP_API_URL: z.url().default('https://lite-api.jup.ag'),
  JUP_API_KEY: z.string().optional(),
  RUGCHECK_API_URL: z.url().default('https://api.rugcheck.xyz'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  // Riesgo y ejecución
  MAX_POSITIONS: z.coerce.number().int().min(1).default(3),
  POSITION_FRACTION: fraction(0.25),
  MAX_POOL_FRACTION: fraction(0.02),
  MAX_PRICE_IMPACT_PCT: num(2),
  MIN_TRADE_USD: num(5),
  SLIPPAGE_BPS: z.coerce.number().int().min(1).default(300),
  EMERGENCY_SLIPPAGE_BPS: z.coerce.number().int().min(1).default(1500),
  MAX_PRIORITY_FEE_LAMPORTS: z.coerce.number().int().min(0).default(1_000_000),
  SOL_FEE_RESERVE: num(0.05),

  // Filtros de entrada
  MIN_LIQUIDITY_USD: num(30_000),
  MIN_VOLUME_H1_USD: num(50_000),
  PAIR_AGE_MIN_MINUTES: num(30),
  PAIR_AGE_MAX_HOURS: num(72),
  MCAP_MIN_USD: num(100_000),
  MCAP_MAX_USD: num(20_000_000),
  MIN_BUY_SELL_RATIO: num(1.2),
  PRICE_H1_MIN_PCT: z.coerce.number().default(10),
  PRICE_H1_MAX_PCT: z.coerce.number().default(200),
  MIN_SCORE: num(0.5),

  // Salidas
  STOP_LOSS_PCT: num(25),
  TAKE_PROFIT_PCT: num(50),
  TAKE_PROFIT_SELL_FRACTION: fraction(0.5),
  TRAILING_STOP_PCT: num(25),
  TIME_STOP_MINUTES: num(90),
  TIME_STOP_MIN_GAIN_PCT: z.coerce.number().default(10),
  RUG_LIQ_DROP_PCT: num(50),
  EXIT_SELL_RATIO: num(0.6),

  // Pausas y ritmo
  LOSS_STREAK_PAUSE: z.coerce.number().int().min(1).default(4),
  PAUSE_MINUTES: num(60),
  REENTRY_COOLDOWN_HOURS: num(6),
  TICK_SECONDS: z.coerce.number().min(1).default(15),
  SCAN_SECONDS: z.coerce.number().min(1).default(60),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Las variables vacías (`CLAVE=`) cuentan como no definidas. */
export function parseConfig(env: Record<string, string | undefined>): Config {
  const defined = Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== '');
  return ConfigSchema.parse(Object.fromEntries(defined));
}

export function loadConfig(): Config {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Sin .env: se usan las variables de entorno y los valores por defecto.
  }
  return parseConfig(process.env);
}

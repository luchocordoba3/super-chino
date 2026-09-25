import { Connection } from '@solana/web3.js';
import { Bot } from './bot';
import { Jupiter, LiveBroker, PaperBroker, loadKeypair, type Broker } from './broker';
import { loadConfig, type Config } from './config';
import { LiveMarket } from './market';
import { makeNotifier } from './notify';
import { ChainSafety } from './safety';
import { Store, freshState } from './state';
import { fmtUsd, log } from './util';

const STATUS_LABEL = { running: 'operando', won: 'GANÓ: objetivo cumplido', busted: 'QUEBRÓ: capital agotado' } as const;

async function start(cfg: Config, store: Store): Promise<number> {
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    // La primera señal termina el ciclo en curso y guarda; la segunda corta en seco.
    process.on(sig, () => (controller.signal.aborted ? process.exit(130) : controller.abort()));
  }

  const conn = new Connection(cfg.SOLANA_RPC_URL, 'confirmed');
  const jupiter = new Jupiter(cfg.JUP_API_URL, cfg.JUP_API_KEY);
  let state = store.load();
  let broker: Broker;
  if (cfg.MODE === 'live') {
    if (!cfg.WALLET_PRIVATE_KEY) {
      log('error', 'MODE=live necesita WALLET_PRIVATE_KEY en el .env');
      return 1;
    }
    const live = new LiveBroker(jupiter, conn, loadKeypair(cfg.WALLET_PRIVATE_KEY), cfg);
    const [usdc, sol] = await Promise.all([live.cashUsd(), live.solBalance()]);
    log('warn', `MODO REAL, con dinero de verdad. Billetera ${live.owner.toBase58()}: ${fmtUsd(usdc)} en USDC y ${sol.toFixed(4)} SOL.`);
    state ??= freshState('live', usdc, Date.now());
    await live.reconcile(state);
    broker = live;
  } else {
    state ??= freshState('paper', cfg.PAPER_START_USD, Date.now());
    broker = new PaperBroker(jupiter, state, cfg.PAPER_FEE_USD, cfg.PAPER_SLIPPAGE_PCT);
  }

  if (state.status === 'running') {
    const safety = new ChainSafety(conn, cfg.RUGCHECK_API_URL);
    const bot = new Bot({ cfg, market: new LiveMarket(), safety, broker, store, notify: makeNotifier(cfg) }, state);
    await bot.run(controller.signal);
    if (state.status === 'running') return 0; // detenido con Ctrl+C o por Docker
  }
  log('info', `Este bot terminó (${STATUS_LABEL[state.status]}) y no vuelve a operar. Para empezar de cero: npm run reset -- --yes`);
  // En Docker queda en reposo: si saliera, el contenedor se reiniciaría en bucle.
  if (process.env.IDLE_AFTER_END === '1') {
    await new Promise<void>((resolve) => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
  }
  return 0;
}

function status(cfg: Config, store: Store): number {
  const s = store.load();
  if (!s) {
    console.log(`Todavía no hay estado en ${store.statePath}. Arrancá con: npm start`);
    return 0;
  }
  const pct = (s.lastEquityUsd / cfg.TARGET_USD) * 100;
  const lines = [
    `Modo: ${s.mode === 'live' ? 'REAL' : 'simulación'} | Estado: ${STATUS_LABEL[s.status]}${store.panic() ? ' | PÁNICO ACTIVADO' : ''}`,
    `Capital: ${fmtUsd(s.lastEquityUsd)} (${pct.toFixed(2)}% de ${fmtUsd(cfg.TARGET_USD)}) | Máximo: ${fmtUsd(s.peakEquityUsd)}`,
    `USDC: ${fmtUsd(s.cashUsd)} | Operaciones: ${s.trades} | Posiciones abiertas: ${s.positions.length}`,
    ...s.positions.map(
      (p) => `  • ${p.symbol}: costo ${fmtUsd(p.costUsd)}, entrada ${p.entryPrice.toPrecision(4)}, desde ${new Date(p.openedAt).toLocaleString('es-AR')}`,
    ),
  ];
  if (s.pausedUntil > Date.now()) lines.push(`En pausa hasta ${new Date(s.pausedUntil).toLocaleString('es-AR')}`);
  console.log(lines.join('\n'));
  return 0;
}

async function main(): Promise<number> {
  const [command = 'start', ...args] = process.argv.slice(2);
  const cfg = loadConfig();
  if (args.includes('--paper')) cfg.MODE = 'paper';
  const store = new Store(cfg.DATA_DIR, cfg.MODE);

  switch (command) {
    case 'start':
      return start(cfg, store);
    case 'status':
      return status(cfg, store);
    case 'panic':
      store.setPanic(true);
      console.log('Pánico activado: en el próximo ciclo el bot vende todo y deja de comprar. Para seguir: npm run resume');
      return 0;
    case 'resume':
      store.setPanic(false);
      console.log('Pánico desactivado: el bot vuelve a buscar entradas.');
      return 0;
    case 'reset': {
      if (!args.includes('--yes')) {
        console.error('Esto archiva el estado y el bot empieza de cero. Detené el bot y confirmá con: npm run reset -- --yes');
        return 1;
      }
      const dest = store.archive(Date.now());
      console.log(dest ? `Estado archivado en ${dest}` : 'No había estado para archivar.');
      return 0;
    }
    default:
      console.error(`Comando desconocido "${command}". Opciones: start | status | panic | resume | reset`);
      return 1;
  }
}

// process.exit explícito: la conexión de Solana puede dejar sockets abiertos.
main().then(
  (code) => process.exit(code),
  (e) => {
    log('error', e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.exit(1);
  },
);

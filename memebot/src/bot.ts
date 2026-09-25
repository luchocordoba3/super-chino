import { rawToUsd, type Broker, type Quote } from './broker';
import type { Config } from './config';
import type { Market } from './market';
import type { Notifier } from './notify';
import type { Safety } from './safety';
import type { Store } from './state';
import { exitDecision, positionSizeUsd, rejectReason, score } from './strategy';
import type { BotState, PairMetrics, Position, Status, Trade } from './types';
import { errMsg, fmtUsd, log, sleep } from './util';

export interface BotDeps {
  cfg: Config;
  market: Market;
  safety: Safety;
  broker: Broker;
  store: Store;
  notify: Notifier;
  now?: () => number;
}

const DAY_MS = 24 * 3_600_000;
const units = (p: Position) => Number(BigInt(p.amountRaw)) / 10 ** p.decimals;
const signedUsd = (n: number) => `${n >= 0 ? '+' : '-'}${fmtUsd(Math.abs(n))}`;

export class Bot {
  private lastScanAt = -Infinity;
  private lastErrorAt = -Infinity;
  private lastFeeWarnAt = -Infinity;
  private lastSummaryAt: number;

  constructor(private deps: BotDeps, readonly state: BotState) {
    this.lastSummaryAt = this.now();
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  async run(signal: AbortSignal): Promise<void> {
    const { cfg, notify } = this.deps;
    await notify(
      `Arranca en modo ${cfg.MODE === 'live' ? 'REAL' : 'simulación'}. ` +
        `Capital ${fmtUsd(this.state.lastEquityUsd)}, objetivo ${fmtUsd(cfg.TARGET_USD)}.`,
    );
    while (!signal.aborted) {
      if ((await this.tick()) === 'stopped') return;
      await sleep(cfg.TICK_SECONDS * 1000, signal);
    }
    log('info', 'Detenido. Las posiciones abiertas se retoman al volver a arrancar.');
  }

  /** Un ciclo: valuar, chequear meta y quiebra, revisar salidas y, cada SCAN_SECONDS, buscar una entrada. */
  async tick(): Promise<'running' | 'stopped'> {
    const { cfg, store, broker } = this.deps;
    const s = this.state;
    if (s.status !== 'running') return 'stopped';
    try {
      const held = await this.heldMetrics();
      const cash = await broker.cashUsd();
      s.cashUsd = cash;
      const equity = cash + s.positions.reduce((sum, p) => sum + this.markValue(p, held.get(p.mint)), 0);
      s.lastEquityUsd = equity;
      s.peakEquityUsd = Math.max(s.peakEquityUsd, equity);

      if (!(await this.checkEnd(equity, cash))) {
        if (store.panic()) {
          if (s.positions.length) await this.liquidate('botón de pánico', false);
        } else {
          await this.manageExits(held);
          const now = this.now();
          if (now - this.lastScanAt >= cfg.SCAN_SECONDS * 1000) {
            this.lastScanAt = now;
            await this.scanAndEnter(equity);
          }
        }
        await this.maybeSummary();
      }
    } catch (e) {
      await this.reportError(e);
    } finally {
      store.save(s);
    }
    return s.status === 'running' ? 'running' : 'stopped';
  }

  /** Devuelve true si el bot terminó: ganó (llegó al objetivo) o quebró. */
  private async checkEnd(equity: number, cash: number): Promise<boolean> {
    const { cfg, broker, notify } = this.deps;
    const s = this.state;

    if (equity >= cfg.TARGET_USD) {
      // Se confirma con cotizaciones reales de venta antes de declarar la victoria.
      if ((await this.realizable(cash)) < cfg.TARGET_USD) return false;
      await this.liquidate('objetivo cumplido', false);
      if (s.positions.length) return false; // alguna venta falló: se reintenta en el próximo ciclo
      s.cashUsd = await broker.cashUsd();
      this.finish('won');
      await notify(`🏆 OBJETIVO CUMPLIDO: ${fmtUsd(s.cashUsd)} en USDC. El bot no vuelve a operar.`);
      return true;
    }

    // Una billetera que nunca tuvo capital (por ejemplo, todavía sin USDC) no "quiebra".
    if (s.peakEquityUsd < Math.max(cfg.BUST_USD, cfg.MIN_TRADE_USD)) return false;
    const cannotTrade = s.positions.length === 0 && cash < cfg.MIN_TRADE_USD + broker.swapFeeUsd;
    if (!cannotTrade) {
      if (equity >= cfg.BUST_USD) return false;
      if ((await this.realizable(cash)) >= cfg.BUST_USD) return false;
    }
    await this.liquidate('quiebra', true);
    s.cashUsd = await broker.cashUsd();
    this.finish('busted');
    await notify(`💀 Capital agotado (${fmtUsd(s.cashUsd)}). El bot se apaga para siempre.`);
    return true;
  }

  private finish(status: Status): void {
    this.state.status = status;
    this.state.endedAt = this.now();
  }

  /** Efectivo + lo que se obtendría vendiendo ahora cada posición (sin ruta de venta = 0). */
  private async realizable(cash: number): Promise<number> {
    let total = cash;
    for (const p of this.state.positions) {
      try {
        const q = await this.deps.broker.quoteSell(p.mint, BigInt(p.amountRaw), this.deps.cfg.SLIPPAGE_BPS);
        total += rawToUsd(q.outAmount);
      } catch {
        // Sin ruta de venta: la posición no vale nada.
      }
    }
    return total;
  }

  private markValue(p: Position, m: PairMetrics | undefined): number {
    return m ? units(p) * m.priceUsd : p.costUsd;
  }

  private async heldMetrics(): Promise<Map<string, PairMetrics>> {
    if (!this.state.positions.length) return new Map();
    try {
      return await this.deps.market.metrics(this.state.positions.map((p) => p.mint));
    } catch (e) {
      log('warn', `no se pudieron leer los precios de las posiciones: ${errMsg(e)}`);
      return new Map();
    }
  }

  private async manageExits(held: Map<string, PairMetrics>): Promise<void> {
    for (const p of [...this.state.positions]) {
      const m = held.get(p.mint);
      if (!m) continue;
      p.peakPrice = Math.max(p.peakPrice, m.priceUsd);
      const d = exitDecision(p, m, this.deps.cfg, this.now());
      if (d.sellFraction <= 0) continue;
      const sold = await this.sellPosition(p, d.sellFraction, d.reason, d.emergency);
      if (sold && d.takeProfit) p.tookProfit = true;
    }
  }

  private async liquidate(reason: string, emergency: boolean): Promise<void> {
    for (const p of [...this.state.positions]) await this.sellPosition(p, 1, reason, emergency);
  }

  /** Vende una fracción de la posición; si falla, reintenta con más slippage (hasta 3 intentos). */
  private async sellPosition(p: Position, fraction: number, reason: string, emergency: boolean): Promise<boolean> {
    const { cfg, broker, notify } = this.deps;
    const total = BigInt(p.amountRaw);
    const amount = fraction >= 1 ? total : (total * BigInt(Math.round(fraction * 10_000))) / 10_000n;
    if (amount <= 0n) return false;
    const mid = Math.round((cfg.SLIPPAGE_BPS + cfg.EMERGENCY_SLIPPAGE_BPS) / 2);
    const attempts = emergency
      ? [cfg.EMERGENCY_SLIPPAGE_BPS, cfg.EMERGENCY_SLIPPAGE_BPS, cfg.EMERGENCY_SLIPPAGE_BPS]
      : [cfg.SLIPPAGE_BPS, mid, cfg.EMERGENCY_SLIPPAGE_BPS];
    let lastError: unknown;
    for (const bps of attempts) {
      try {
        const { usdReceived, signature } = await broker.sell(p.mint, amount, bps);
        const cost = amount === total ? p.costUsd : p.costUsd * (Number(amount) / Number(total));
        const pnlUsd = usdReceived - cost;
        p.amountRaw = (total - amount).toString();
        p.costUsd -= cost;
        p.realizedPnlUsd += pnlUsd;
        this.record({ side: 'sell', mint: p.mint, symbol: p.symbol, usd: usdReceived, amountRaw: amount.toString(), reason, pnlUsd, signature });
        await notify(`🔴 Venta ${p.symbol} (${reason}): ${fmtUsd(usdReceived)}, resultado ${signedUsd(pnlUsd)}`);
        if (amount === total) await this.close(p);
        return true;
      } catch (e) {
        lastError = e;
      }
    }
    await this.reportError(new Error(`no se pudo vender ${p.symbol} (${reason}): ${errMsg(lastError)}`));
    return false;
  }

  private async close(p: Position): Promise<void> {
    const { cfg, notify } = this.deps;
    const s = this.state;
    const now = this.now();
    s.positions = s.positions.filter((x) => x !== p);
    s.cooldowns[p.mint] = now + cfg.REENTRY_COOLDOWN_HOURS * 3_600_000;
    if (p.realizedPnlUsd >= 0) {
      s.lossStreak = 0;
      return;
    }
    s.lossStreak += 1;
    if (s.lossStreak >= cfg.LOSS_STREAK_PAUSE) {
      s.lossStreak = 0;
      s.pausedUntil = now + cfg.PAUSE_MINUTES * 60_000;
      await notify(`${cfg.LOSS_STREAK_PAUSE} pérdidas seguidas: ${cfg.PAUSE_MINUTES} min sin comprar.`);
    }
  }

  private async scanAndEnter(equity: number): Promise<void> {
    const { cfg, market, broker, notify } = this.deps;
    const s = this.state;
    const now = this.now();
    for (const [mint, until] of Object.entries(s.cooldowns)) if (until <= now) delete s.cooldowns[mint];
    if (now < s.pausedUntil || s.positions.length >= cfg.MAX_POSITIONS) return;
    const cash = (await broker.cashUsd()) - broker.swapFeeUsd;
    if (cash < cfg.MIN_TRADE_USD) return;
    if (!(await broker.canPayFees())) {
      if (now - this.lastFeeWarnAt >= 3_600_000) {
        this.lastFeeWarnAt = now;
        await notify(`Falta SOL para las comisiones (mínimo ${cfg.SOL_FEE_RESERVE} SOL): no se abren posiciones.`);
      }
      return;
    }

    const held = new Set(s.positions.map((p) => p.mint));
    const mints = (await market.discover()).filter((m) => !held.has(m) && !Object.hasOwn(s.cooldowns, m));
    if (!mints.length) return;
    const ranked = [...(await market.metrics(mints)).values()]
      .filter((m) => rejectReason(m, cfg, now) === null)
      .map((m) => ({ m, score: score(m, cfg) }))
      .filter((c) => c.score >= cfg.MIN_SCORE)
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    log('info', `escaneo: ${mints.length} monedas, ${ranked.length} candidatas${best ? `; la mejor ${best.m.symbol} (${best.score.toFixed(2)})` : ''}`);
    for (const c of ranked.slice(0, 3)) {
      if (await this.tryEnter(c.m, c.score, equity, cash)) return;
    }
  }

  /** Devuelve true si compró, o si la compra falló y conviene no seguir probando en este escaneo. */
  private async tryEnter(m: PairMetrics, sc: number, equity: number, cash: number): Promise<boolean> {
    const { cfg, broker, safety, notify } = this.deps;
    const skip = (why: string) => {
      log('info', `${m.symbol}: descartada (${why})`);
      return false;
    };

    const report = await safety.check(m.mint);
    if (!report.ok || report.decimals === undefined) return skip(report.reason ?? 'sin datos');
    const decimals = report.decimals;

    let quote: Quote | undefined;
    try {
      // Venta de prueba por ~US$1: si no hay ruta o devuelve casi nada, es una trampa.
      const probe = BigInt(Math.floor((1 / m.priceUsd) * 10 ** decimals));
      const back = await broker.quoteSell(m.mint, probe, cfg.SLIPPAGE_BPS);
      if (rawToUsd(back.outAmount) < 0.5) return skip('la venta de prueba devuelve casi nada');

      let usd = positionSizeUsd(equity, cash, m.liquidityUsd, cfg);
      if (usd <= 0) return skip('monto demasiado chico');
      // Impacto en el precio: compara lo que rinde el dólar en la compra real contra una compra de US$1.
      const rate = (q: Quote) => Number(q.outAmount) / rawToUsd(q.inAmount);
      const ref = await broker.quoteBuy(m.mint, 1, cfg.SLIPPAGE_BPS);
      for (let attempt = 0; attempt < 2 && usd >= cfg.MIN_TRADE_USD; attempt++) {
        const q = await broker.quoteBuy(m.mint, usd, cfg.SLIPPAGE_BPS);
        if ((1 - rate(q) / rate(ref)) * 100 <= cfg.MAX_PRICE_IMPACT_PCT) {
          quote = q;
          break;
        }
        usd = Math.floor(usd * 50) / 100; // la mitad, redondeada a centavos
      }
    } catch (e) {
      return skip(`sin cotización: ${errMsg(e)}`);
    }
    if (!quote) return skip('impacto en el precio demasiado alto');

    try {
      const fill = await broker.buy(m.mint, quote);
      if (fill.amountRaw <= 0n) throw new Error('no se recibieron monedas');
      const entryPrice = fill.usdSpent / (Number(fill.amountRaw) / 10 ** decimals);
      this.state.positions.push({
        mint: m.mint,
        symbol: m.symbol,
        decimals,
        amountRaw: fill.amountRaw.toString(),
        costUsd: fill.usdSpent,
        entryPrice,
        entryLiquidityUsd: m.liquidityUsd,
        peakPrice: entryPrice,
        openedAt: this.now(),
        tookProfit: false,
        realizedPnlUsd: 0,
      });
      this.record({ side: 'buy', mint: m.mint, symbol: m.symbol, usd: fill.usdSpent, amountRaw: fill.amountRaw.toString(), reason: `puntaje ${sc.toFixed(2)}`, signature: fill.signature });
      await notify(`🟢 Compra ${m.symbol}: ${fmtUsd(fill.usdSpent)} (puntaje ${sc.toFixed(2)}, liquidez ${fmtUsd(m.liquidityUsd)})`);
    } catch (e) {
      await this.reportError(new Error(`falló la compra de ${m.symbol}: ${errMsg(e)}`));
    }
    return true;
  }

  private record(t: Omit<Trade, 'at'>): void {
    this.state.trades += 1;
    this.deps.store.appendTrade({ at: this.now(), ...t });
  }

  private async maybeSummary(): Promise<void> {
    const now = this.now();
    if (now - this.lastSummaryAt < DAY_MS) return;
    this.lastSummaryAt = now;
    const s = this.state;
    const pct = (s.lastEquityUsd / this.deps.cfg.TARGET_USD) * 100;
    await this.deps.notify(
      `Resumen diario: capital ${fmtUsd(s.lastEquityUsd)} (${pct.toFixed(2)}% del objetivo), ` +
        `${s.positions.length} posiciones abiertas, ${s.trades} operaciones.`,
    );
  }

  /** Siempre queda en el log; por Telegram, como mucho un aviso cada 10 minutos. */
  private async reportError(e: unknown): Promise<void> {
    log('error', errMsg(e));
    const now = this.now();
    if (now - this.lastErrorAt < 10 * 60_000) return;
    this.lastErrorAt = now;
    await this.deps.notify(`⚠️ ${errMsg(e)}`);
  }
}

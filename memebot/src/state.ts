import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BotState, Mode, Trade } from './types';

export function freshState(mode: Mode, cashUsd: number, now: number): BotState {
  return {
    version: 1,
    mode,
    status: 'running',
    startedAt: now,
    cashUsd,
    positions: [],
    lossStreak: 0,
    pausedUntil: 0,
    cooldowns: {},
    lastEquityUsd: cashUsd,
    peakEquityUsd: cashUsd,
    trades: 0,
  };
}

/** Estado en `data/state-<modo>.json` (escritura atómica) y operaciones en `data/trades-<modo>.jsonl`. */
export class Store {
  readonly statePath: string;
  readonly tradesPath: string;
  readonly panicPath: string;

  constructor(readonly dir: string, readonly mode: Mode) {
    mkdirSync(dir, { recursive: true });
    this.statePath = join(dir, `state-${mode}.json`);
    this.tradesPath = join(dir, `trades-${mode}.jsonl`);
    this.panicPath = join(dir, 'PANIC');
  }

  load(): BotState | null {
    if (!existsSync(this.statePath)) return null;
    return JSON.parse(readFileSync(this.statePath, 'utf8')) as BotState;
  }

  save(state: BotState): void {
    const tmp = `${this.statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, this.statePath);
  }

  appendTrade(trade: Trade): void {
    appendFileSync(this.tradesPath, `${JSON.stringify(trade)}\n`);
  }

  panic(): boolean {
    return existsSync(this.panicPath);
  }

  setPanic(on: boolean): void {
    if (on) writeFileSync(this.panicPath, new Date().toISOString());
    else rmSync(this.panicPath, { force: true });
  }

  /** Guarda el estado actual con otro nombre (no lo borra) para empezar de cero. */
  archive(now: number): string | null {
    if (!existsSync(this.statePath)) return null;
    const dest = join(this.dir, `state-${this.mode}.${now}.bak.json`);
    renameSync(this.statePath, dest);
    return dest;
  }
}

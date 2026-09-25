import { Connection, PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import { errMsg, getJson, type Fetch } from './util';

export interface SafetyReport {
  ok: boolean;
  reason?: string;
  decimals?: number;
  /** Falla pasajera (red caída): no se guarda en caché. */
  transient?: boolean;
}

export interface Safety {
  check(mint: string): Promise<SafetyReport>;
}

/** Extensiones de Token-2022 que permiten cobrar, bloquear o quitar monedas al que las tiene. */
const DANGEROUS_EXTENSIONS = new Set([
  'transferFeeConfig',
  'transferHook',
  'permanentDelegate',
  'nonTransferable',
  'pausableConfig',
]);

const MintInfo = z.object({
  decimals: z.number(),
  mintAuthority: z.string().nullable(),
  freezeAuthority: z.string().nullable(),
  extensions: z.array(z.object({ extension: z.string(), state: z.unknown().optional() })).optional(),
});

/** Evalúa la cuenta del mint tal como la devuelve `getParsedAccountInfo`. */
export function evaluateMint(data: unknown): SafetyReport {
  const parsed = (data as { parsed?: { type?: string; info?: unknown } } | null)?.parsed;
  if (parsed?.type !== 'mint') return { ok: false, reason: 'no es un token' };
  const r = MintInfo.safeParse(parsed.info);
  if (!r.success) return { ok: false, reason: 'datos del token ilegibles' };
  const info = r.data;
  if (info.mintAuthority) return { ok: false, reason: 'alguien puede emitir más monedas' };
  if (info.freezeAuthority) return { ok: false, reason: 'alguien puede congelar monedas' };
  for (const ext of info.extensions ?? []) {
    const frozenByDefault = ext.extension === 'defaultAccountState' && JSON.stringify(ext.state ?? '').includes('frozen');
    if (DANGEROUS_EXTENSIONS.has(ext.extension) || frozenByDefault) {
      return { ok: false, reason: `extensión peligrosa: ${ext.extension}` };
    }
  }
  return { ok: true, decimals: info.decimals };
}

const RugSummary = z.object({
  risks: z.array(z.object({ name: z.string(), level: z.string().optional() })),
});

/** Rechaza si RugCheck marca algún riesgo de nivel "danger". */
export function evaluateRugcheck(payload: unknown): SafetyReport {
  const r = RugSummary.safeParse(payload);
  if (!r.success) return { ok: false, reason: 'RugCheck: respuesta ilegible' };
  const danger = r.data.risks.find((x) => x.level === 'danger');
  return danger ? { ok: false, reason: `RugCheck: ${danger.name}` } : { ok: true };
}

/** Controles en cadena + RugCheck. Ante cualquier duda, no se compra. */
export class ChainSafety implements Safety {
  private cache = new Map<string, { at: number; report: SafetyReport }>();

  constructor(
    private conn: Connection,
    private rugcheckUrl: string,
    private fetchImpl: Fetch = fetch,
    private ttlMs = 30 * 60_000,
  ) {}

  async check(mint: string): Promise<SafetyReport> {
    const hit = this.cache.get(mint);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.report;
    const report = await this.evaluate(mint);
    if (!report.transient) this.cache.set(mint, { at: Date.now(), report });
    return report;
  }

  private async evaluate(mint: string): Promise<SafetyReport> {
    let onChain: SafetyReport;
    try {
      const acc = await this.conn.getParsedAccountInfo(new PublicKey(mint), 'confirmed');
      onChain = evaluateMint(acc.value?.data);
    } catch (e) {
      return { ok: false, reason: `RPC: ${errMsg(e)}`, transient: true };
    }
    if (!onChain.ok) return onChain;
    try {
      const payload = await getJson(`${this.rugcheckUrl}/v1/tokens/${mint}/report/summary`, {}, this.fetchImpl);
      const rug = evaluateRugcheck(payload);
      return rug.ok ? onChain : rug;
    } catch (e) {
      return { ok: false, reason: `RugCheck no respondió: ${errMsg(e)}`, transient: true };
    }
  }
}

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { z } from 'zod';
import type { Config } from './config';
import { USDC_MINT } from './market';
import type { BotState } from './types';
import { errMsg, getJson, log, sleep, type Fetch } from './util';

const USDC_DECIMALS = 6;
export const usdToRaw = (usd: number): bigint => BigInt(Math.floor(usd * 10 ** USDC_DECIMALS));
export const rawToUsd = (raw: bigint): number => Number(raw) / 10 ** USDC_DECIMALS;

export interface Quote {
  inAmount: bigint;
  outAmount: bigint;
  /** Respuesta original de Jupiter: hay que devolverla tal cual para armar la transacción. */
  raw: unknown;
}

export interface Quoter {
  quote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number): Promise<Quote>;
}

const QuoteSchema = z.object({ inAmount: z.string(), outAmount: z.string() });
const SwapSchema = z.object({ swapTransaction: z.string(), lastValidBlockHeight: z.number() });

/** Jupiter Swap API v1: busca la mejor ruta entre todos los DEX de Solana. */
export class Jupiter implements Quoter {
  constructor(private baseUrl: string, private apiKey?: string, private fetchImpl: Fetch = fetch) {}

  private headers(): Record<string, string> {
    return this.apiKey ? { 'x-api-key': this.apiKey } : {};
  }

  async quote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number): Promise<Quote> {
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: String(slippageBps),
      restrictIntermediateTokens: 'true',
    });
    const raw = await getJson(`${this.baseUrl}/swap/v1/quote?${params}`, { headers: this.headers() }, this.fetchImpl);
    const q = QuoteSchema.parse(raw);
    return { inAmount: BigInt(q.inAmount), outAmount: BigInt(q.outAmount), raw };
  }

  async swapTransaction(quoteRaw: unknown, userPublicKey: string, maxPriorityLamports: number) {
    const raw = await getJson(
      `${this.baseUrl}/swap/v1/swap`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.headers() },
        body: JSON.stringify({
          quoteResponse: quoteRaw,
          userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: { maxLamports: maxPriorityLamports, priorityLevel: 'veryHigh' },
          },
        }),
      },
      this.fetchImpl,
      20_000,
    );
    return SwapSchema.parse(raw);
  }
}

export interface Broker {
  /** Comisión en USD que se descuenta del saldo en cada operación (solo en simulación). */
  readonly swapFeeUsd: number;
  cashUsd(): Promise<number>;
  quoteBuy(mint: string, usd: number, slippageBps: number): Promise<Quote>;
  quoteSell(mint: string, amountRaw: bigint, slippageBps: number): Promise<Quote>;
  buy(mint: string, quote: Quote): Promise<{ amountRaw: bigint; usdSpent: number; signature?: string }>;
  sell(mint: string, amountRaw: bigint, slippageBps: number): Promise<{ usdReceived: number; signature?: string }>;
  /** `false` si no queda SOL para pagar las comisiones de red. */
  canPayFees(): Promise<boolean>;
}

/** Simulación: precios y cotizaciones reales, dinero virtual. Descuenta comisión y un slippage fijo. */
export class PaperBroker implements Broker {
  constructor(
    private quoter: Quoter,
    private wallet: { cashUsd: number },
    readonly swapFeeUsd: number,
    private slippagePct: number,
  ) {}

  async cashUsd(): Promise<number> {
    return this.wallet.cashUsd;
  }

  quoteBuy(mint: string, usd: number, slippageBps: number): Promise<Quote> {
    return this.quoter.quote(USDC_MINT, mint, usdToRaw(usd), slippageBps);
  }

  quoteSell(mint: string, amountRaw: bigint, slippageBps: number): Promise<Quote> {
    return this.quoter.quote(mint, USDC_MINT, amountRaw, slippageBps);
  }

  async buy(_mint: string, quote: Quote) {
    const usdSpent = rawToUsd(quote.inAmount) + this.swapFeeUsd;
    if (usdSpent > this.wallet.cashUsd + 1e-9) throw new Error('saldo insuficiente');
    this.wallet.cashUsd -= usdSpent;
    return { amountRaw: this.haircut(quote.outAmount), usdSpent };
  }

  async sell(mint: string, amountRaw: bigint, slippageBps: number) {
    const q = await this.quoteSell(mint, amountRaw, slippageBps);
    const usdReceived = Math.max(0, rawToUsd(this.haircut(q.outAmount)) - this.swapFeeUsd);
    this.wallet.cashUsd += usdReceived;
    return { usdReceived };
  }

  async canPayFees(): Promise<boolean> {
    return true;
  }

  private haircut(x: bigint): bigint {
    return (x * BigInt(Math.round((100 - this.slippagePct) * 100))) / 10_000n;
  }
}

/** Acepta la clave en base58 (Phantom, Solflare) o como arreglo JSON (solana-keygen). */
export function loadKeypair(secret: string): Keypair {
  const s = secret.trim();
  const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s) as number[]) : bs58.decode(s);
  return Keypair.fromSecretKey(bytes);
}

/** Operación real: firma las transacciones de Jupiter y registra lo que de verdad cambió en la billetera. */
export class LiveBroker implements Broker {
  readonly swapFeeUsd = 0;
  readonly owner: PublicKey;

  constructor(private jup: Jupiter, private conn: Connection, private kp: Keypair, private cfg: Config) {
    this.owner = kp.publicKey;
  }

  async tokenBalance(mint: string): Promise<bigint> {
    const res = await this.conn.getParsedTokenAccountsByOwner(this.owner, { mint: new PublicKey(mint) }, 'confirmed');
    let total = 0n;
    for (const { account } of res.value) total += BigInt(account.data.parsed.info.tokenAmount.amount);
    return total;
  }

  async cashUsd(): Promise<number> {
    return rawToUsd(await this.tokenBalance(USDC_MINT));
  }

  async solBalance(): Promise<number> {
    return (await this.conn.getBalance(this.owner, 'confirmed')) / LAMPORTS_PER_SOL;
  }

  async canPayFees(): Promise<boolean> {
    return (await this.solBalance()) >= this.cfg.SOL_FEE_RESERVE;
  }

  quoteBuy(mint: string, usd: number, slippageBps: number): Promise<Quote> {
    return this.jup.quote(USDC_MINT, mint, usdToRaw(usd), slippageBps);
  }

  quoteSell(mint: string, amountRaw: bigint, slippageBps: number): Promise<Quote> {
    return this.jup.quote(mint, USDC_MINT, amountRaw, slippageBps);
  }

  async buy(mint: string, quote: Quote) {
    const [tokenBefore, usdcBefore] = await Promise.all([this.tokenBalance(mint), this.tokenBalance(USDC_MINT)]);
    const signature = await this.execute(quote);
    const tokenAfter = await this.waitForChange(mint, tokenBefore);
    const usdcAfter = await this.tokenBalance(USDC_MINT);
    return { amountRaw: tokenAfter - tokenBefore, usdSpent: rawToUsd(usdcBefore - usdcAfter), signature };
  }

  async sell(mint: string, amountRaw: bigint, slippageBps: number) {
    const quote = await this.quoteSell(mint, amountRaw, slippageBps);
    const [tokenBefore, usdcBefore] = await Promise.all([this.tokenBalance(mint), this.tokenBalance(USDC_MINT)]);
    const signature = await this.execute(quote);
    await this.waitForChange(mint, tokenBefore);
    const usdcAfter = await this.tokenBalance(USDC_MINT);
    return { usdReceived: rawToUsd(usdcAfter - usdcBefore), signature };
  }

  /** Al arrancar: ajusta las posiciones guardadas a lo que realmente hay en la billetera. */
  async reconcile(state: BotState): Promise<void> {
    state.cashUsd = await this.cashUsd();
    for (const p of [...state.positions]) {
      const balance = await this.tokenBalance(p.mint);
      if (balance === 0n) {
        state.positions = state.positions.filter((x) => x !== p);
        log('warn', `${p.symbol} ya no está en la billetera: se quita de las posiciones`);
      } else if (balance.toString() !== p.amountRaw) {
        p.amountRaw = balance.toString();
      }
    }
  }

  private async execute(quote: Quote): Promise<string> {
    const { swapTransaction, lastValidBlockHeight } = await this.jup.swapTransaction(
      quote.raw,
      this.owner.toBase58(),
      this.cfg.MAX_PRIORITY_FEE_LAMPORTS,
    );
    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
    tx.sign([this.kp]);
    const signature = await this.conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
    let result;
    try {
      result = await this.conn.confirmTransaction(
        { signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight },
        'confirmed',
      );
    } catch (e) {
      // Puede haber entrado igual: lo decide el saldo en waitForChange.
      log('warn', `sin confirmación de ${signature}: ${errMsg(e)}`);
      return signature;
    }
    if (result.value.err) throw new Error(`la transacción ${signature} falló: ${JSON.stringify(result.value.err)}`);
    return signature;
  }

  private async waitForChange(mint: string, before: bigint): Promise<bigint> {
    for (let i = 0; i < 15; i++) {
      const now = await this.tokenBalance(mint);
      if (now !== before) return now;
      await sleep(2000);
    }
    throw new Error('la operación no se reflejó en la billetera');
  }
}

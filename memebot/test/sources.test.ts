import { describe, expect, it } from 'vitest';
import { LiveMarket, SOL_MINT, USDC_MINT, bestPairs, dexscreenerMints, geckoMints } from '../src/market';
import { evaluateMint, evaluateRugcheck } from '../src/safety';

/** Par con la forma de la respuesta de DexScreener /tokens/v1. */
const pair = (o: Record<string, unknown> = {}) => ({
  chainId: 'solana',
  dexId: 'raydium',
  pairAddress: 'PAIR1',
  baseToken: { address: 'MEME', name: 'Meme', symbol: 'MEME' },
  quoteToken: { address: SOL_MINT, name: 'Wrapped SOL', symbol: 'SOL' },
  priceNative: '0.00001',
  priceUsd: '0.0015',
  txns: { m5: { buys: 30, sells: 10 }, h1: { buys: 300, sells: 150 }, h24: { buys: 5000, sells: 4000 } },
  volume: { h24: 1_000_000, h6: 500_000, h1: 100_000, m5: 20_000 },
  priceChange: { m5: 3.2, h1: 45, h6: 120, h24: 300 },
  liquidity: { usd: 80_000, base: 1, quote: 2 },
  fdv: 1_500_000,
  marketCap: 1_400_000,
  pairCreatedAt: 1_758_800_000_000,
  ...o,
});

describe('DexScreener', () => {
  it('se queda con el par contra SOL/USDC de más liquidez y descarta los incompletos', () => {
    const payload = [
      pair(),
      pair({ pairAddress: 'PAIR2', quoteToken: { address: USDC_MINT }, liquidity: { usd: 120_000 }, priceUsd: '0.0016' }),
      pair({ pairAddress: 'PAIR3', quoteToken: { address: 'OTRA' }, liquidity: { usd: 999_999 } }),
      pair({ pairAddress: 'PAIR4', chainId: 'base', liquidity: { usd: 999_999 } }),
      pair({ baseToken: { address: 'ROTA' }, priceUsd: undefined }),
    ];
    const out = bestPairs(payload);
    expect([...out.keys()]).toEqual(['MEME']);
    expect(out.get('MEME')).toMatchObject({ priceUsd: 0.0016, liquidityUsd: 120_000, buysM5: 30, volumeH1: 100_000 });
  });

  it('acepta también la forma { pairs: [...] }', () => {
    expect(bestPairs({ pairs: [pair()] }).size).toBe(1);
    expect(bestPairs(null).size).toBe(0);
  });

  it('extrae las monedas de Solana de las listas de promocionadas', () => {
    const payload = [
      { chainId: 'solana', tokenAddress: 'A', amount: 100 },
      { chainId: 'ethereum', tokenAddress: '0xB' },
      { basura: true },
    ];
    expect(dexscreenerMints(payload)).toEqual(['A']);
  });

  it('consulta de a 30 monedas', async () => {
    const urls: string[] = [];
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      return new Response('[]');
    }) as unknown as typeof fetch;
    const mints = Array.from({ length: 31 }, (_, i) => `M${i}`);
    await new LiveMarket(fakeFetch).metrics(mints);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toMatch(/\/tokens\/v1\/solana\/M30$/);
  });

  it('si una fuente falla, usa las demás', async () => {
    const fakeFetch = (async (url: string) =>
      url.includes('geckoterminal')
        ? new Response('caído', { status: 503 })
        : new Response(JSON.stringify([{ chainId: 'solana', tokenAddress: 'A' }, { chainId: 'solana', tokenAddress: SOL_MINT }]))) as unknown as typeof fetch;
    expect(await new LiveMarket(fakeFetch).discover()).toEqual(['A']);
  });
});

describe('GeckoTerminal', () => {
  it('extrae la moneda base de los pools en tendencia', () => {
    const payload = {
      data: [
        { id: 'solana_P1', type: 'pool', relationships: { base_token: { data: { id: 'solana_MEME', type: 'token' } } } },
        { id: 'raro', type: 'pool' },
      ],
    };
    expect(geckoMints(payload)).toEqual(['MEME']);
    expect(geckoMints({})).toEqual([]);
  });
});

describe('controles anti-estafa', () => {
  const mint = (info: Record<string, unknown>, program = 'spl-token') => ({
    program,
    parsed: { type: 'mint', info: { decimals: 6, supply: '1000', isInitialized: true, mintAuthority: null, freezeAuthority: null, ...info } },
  });

  it('acepta un token sin autoridades', () => {
    expect(evaluateMint(mint({}))).toEqual({ ok: true, decimals: 6 });
  });

  it.each([
    [mint({ mintAuthority: 'X' }), 'alguien puede emitir más monedas'],
    [mint({ freezeAuthority: 'X' }), 'alguien puede congelar monedas'],
    [mint({ extensions: [{ extension: 'transferFeeConfig', state: {} }] }, 'spl-token-2022'), 'extensión peligrosa: transferFeeConfig'],
    [mint({ extensions: [{ extension: 'defaultAccountState', state: { accountState: 'frozen' } }] }, 'spl-token-2022'), 'extensión peligrosa: defaultAccountState'],
    [{ program: 'spl-token', parsed: { type: 'account', info: {} } }, 'no es un token'],
    [{ program: 'spl-token', parsed: { type: 'mint', info: { decimals: 6 } } }, 'datos del token ilegibles'],
    [null, 'no es un token'],
  ])('rechaza %#', (data, reason) => {
    expect(evaluateMint(data)).toEqual({ ok: false, reason });
  });

  it('acepta Token-2022 con extensiones inofensivas', () => {
    const data = mint({ extensions: [{ extension: 'metadataPointer', state: {} }, { extension: 'tokenMetadata', state: {} }] }, 'spl-token-2022');
    expect(evaluateMint(data).ok).toBe(true);
  });

  it('RugCheck: rechaza riesgos "danger" y respuestas raras', () => {
    expect(evaluateRugcheck({ score: 1, risks: [] }).ok).toBe(true);
    expect(evaluateRugcheck({ risks: [{ name: 'Low Liquidity', level: 'warn' }] }).ok).toBe(true);
    expect(evaluateRugcheck({ risks: [{ name: 'Freeze Authority still enabled', level: 'danger' }] })).toEqual({
      ok: false,
      reason: 'RugCheck: Freeze Authority still enabled',
    });
    expect(evaluateRugcheck({}).ok).toBe(false);
  });
});

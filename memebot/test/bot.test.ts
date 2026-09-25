import { describe, expect, it } from 'vitest';
import { Bot } from '../src/bot';
import { NOW, setup } from './helpers';

const TICK = 15_000;
const SCAN = 60_000;

describe('bot en simulación', () => {
  it('compra la mejor candidata con el 25% del capital', async () => {
    const { market, bot, state, store } = setup();
    market.set('aaa');
    market.set('bbb', { buysM5: 70, sellsM5: 50 });
    await bot.tick();
    expect(state.positions.map((p) => p.mint)).toEqual(['aaa']);
    expect(state.positions[0].costUsd).toBeCloseTo(250);
    expect(state.positions[0].entryPrice).toBeCloseTo(0.01);
    expect(state.cashUsd).toBeCloseTo(750);
    expect(store.load()).toEqual(state);
  });

  it('descarta la moneda que no pasa los controles y prueba la siguiente', async () => {
    const { market, safety, bot, state } = setup();
    market.set('aaa');
    market.set('bbb', { buysM5: 70, sellsM5: 50 });
    safety.reports.set('aaa', { ok: false, reason: 'alguien puede emitir más monedas' });
    await bot.tick();
    expect(state.positions.map((p) => p.mint)).toEqual(['bbb']);
  });

  it('no compra si el impacto en el precio es alto', async () => {
    const { market, bot, state } = setup();
    market.set('aaa');
    market.impact.set('aaa', 0.1);
    await bot.tick();
    expect(state.positions).toHaveLength(0);
    expect(state.cashUsd).toBe(1000);
  });

  it('stop-loss: vende todo al caer 25% y no vuelve a entrar en esa moneda por un tiempo', async () => {
    const { market, bot, state, advance } = setup();
    market.set('aaa');
    await bot.tick();
    market.price('aaa', 0.007);
    advance(TICK);
    await bot.tick();
    expect(state.positions).toHaveLength(0);
    expect(state.cashUsd).toBeCloseTo(925);
    expect(state.lossStreak).toBe(1);
    market.price('aaa', 0.01);
    advance(SCAN);
    await bot.tick();
    expect(state.positions).toHaveLength(0);
  });

  it('toma ganancia a +50% y el resto sale con el stop dinámico', async () => {
    const { market, bot, state, advance } = setup();
    market.set('aaa');
    await bot.tick();
    market.price('aaa', 0.016);
    advance(TICK);
    await bot.tick();
    expect(state.positions[0].tookProfit).toBe(true);
    expect(state.positions[0].amountRaw).toBe('12500000000');
    market.price('aaa', 0.02);
    advance(TICK);
    await bot.tick();
    expect(state.positions).toHaveLength(1);
    market.price('aaa', 0.0145);
    advance(TICK);
    await bot.tick();
    expect(state.positions).toHaveLength(0);
    expect(state.cashUsd).toBeCloseTo(750 + 200 + 181.25);
    expect(state.lossStreak).toBe(0);
  });

  it('al llegar al objetivo vende todo, queda "won" y no vuelve a operar', async () => {
    const { market, bot, state, store, deps, notes, advance } = setup({ TARGET_USD: 2000 });
    market.set('aaa');
    await bot.tick();
    market.price('aaa', 0.1);
    advance(TICK);
    expect(await bot.tick()).toBe('stopped');
    expect(state.status).toBe('won');
    expect(state.positions).toHaveLength(0);
    expect(state.cashUsd).toBeCloseTo(3250);
    expect(notes.some((n) => n.includes('OBJETIVO CUMPLIDO'))).toBe(true);

    const reloaded = new Bot(deps, store.load()!);
    market.set('bbb');
    advance(SCAN);
    expect(await reloaded.tick()).toBe('stopped');
    expect(reloaded.state.positions).toHaveLength(0);
  });

  it('quiebra: si el capital cae bajo el mínimo vende lo que queda y se apaga', async () => {
    const { market, bot, state, advance } = setup({ POSITION_FRACTION: 1, BUST_USD: 50 });
    market.set('aaa');
    await bot.tick();
    expect(state.cashUsd).toBeCloseTo(0);
    market.price('aaa', 0.0001);
    advance(TICK);
    expect(await bot.tick()).toBe('stopped');
    expect(state.status).toBe('busted');
    expect(state.positions).toHaveLength(0);
    expect(state.endedAt).toBe(NOW + TICK);
  });

  it('una moneda sin ruta de venta vale cero', async () => {
    const { market, bot, state, advance } = setup({ POSITION_FRACTION: 1, BUST_USD: 50 });
    market.set('aaa');
    await bot.tick();
    market.set('aaa', { priceUsd: 0 });
    advance(TICK);
    await bot.tick();
    expect(state.status).toBe('busted');
  });

  it('nunca declara quiebra si la billetera todavía no tuvo capital', async () => {
    const { bot, state } = setup({}, 0);
    expect(await bot.tick()).toBe('running');
    expect(state.status).toBe('running');
  });

  it('botón de pánico: vende todo y no compra mientras esté activo', async () => {
    const { market, bot, state, store, advance } = setup();
    market.set('aaa');
    await bot.tick();
    store.setPanic(true);
    market.set('bbb');
    advance(SCAN);
    await bot.tick();
    expect(state.positions).toHaveLength(0);
    advance(SCAN);
    await bot.tick();
    expect(state.positions).toHaveLength(0);
    store.setPanic(false);
    advance(SCAN);
    await bot.tick();
    expect(state.positions.map((p) => p.mint)).toEqual(['bbb']);
  });

  it('pausa las compras después de una racha de pérdidas', async () => {
    const { market, bot, state, advance } = setup({ LOSS_STREAK_PAUSE: 1, PAUSE_MINUTES: 60 });
    market.set('aaa');
    await bot.tick();
    market.price('aaa', 0.007);
    advance(TICK);
    await bot.tick();
    market.set('bbb');
    advance(SCAN);
    await bot.tick();
    expect(state.positions).toHaveLength(0);
    advance(60 * 60_000);
    await bot.tick();
    expect(state.positions.map((p) => p.mint)).toEqual(['bbb']);
  });

  it('no abre más posiciones que MAX_POSITIONS', async () => {
    const { market, bot, state, advance } = setup({ MAX_POSITIONS: 2 });
    for (const m of ['aaa', 'bbb', 'ccc']) market.set(m);
    for (let i = 0; i < 3; i++) {
      await bot.tick();
      advance(SCAN);
    }
    expect(state.positions).toHaveLength(2);
  });

  it('la simulación descuenta comisión y slippage', async () => {
    const { market, bot, state } = setup({ PAPER_FEE_USD: 0.05, PAPER_SLIPPAGE_PCT: 1 });
    market.set('aaa');
    await bot.tick();
    expect(state.positions[0].costUsd).toBeCloseTo(250.05);
    expect(state.positions[0].amountRaw).toBe('24750000000');
  });
});

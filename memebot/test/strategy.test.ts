import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config';
import { exitDecision, positionSizeUsd, rejectReason, score } from '../src/strategy';
import type { Position } from '../src/types';
import { NOW, cfgWith, metrics } from './helpers';

const cfg = cfgWith();

describe('filtros de entrada', () => {
  it('acepta una moneda con impulso y liquidez', () => {
    expect(rejectReason(metrics('a'), cfg, NOW)).toBeNull();
  });

  it.each([
    [{ liquidityUsd: 10_000 }, 'liquidez baja'],
    [{ volumeH1: 20_000 }, 'poco volumen'],
    [{ pairCreatedAt: NOW - 10 * 60_000 }, 'demasiado nueva'],
    [{ pairCreatedAt: NOW - 100 * 3_600_000 }, 'demasiado vieja'],
    [{ marketCapUsd: 50_000_000 }, 'capitalización fuera de rango'],
    [{ sellsM5: 200 }, 'no dominan las compras'],
    [{ priceChangeM5: -1 }, 'sin impulso a 5 min'],
    [{ priceChangeH1: 300 }, 'suba de 1 h fuera de rango'],
  ])('rechaza %o', (o, reason) => {
    expect(rejectReason(metrics('a', o), cfg, NOW)).toBe(reason);
  });
});

describe('puntaje', () => {
  it('queda entre 0 y 1 y premia la presión compradora', () => {
    const strong = score(metrics('a'), cfg);
    const weak = score(metrics('b', { buysM5: 70, sellsM5: 50, volumeM5: 10_000 }), cfg);
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeLessThanOrEqual(1);
    expect(weak).toBeGreaterThanOrEqual(0);
  });
});

describe('tamaño de la posición', () => {
  it('toma el menor entre fracción del capital, fracción del pool y efectivo', () => {
    expect(positionSizeUsd(1000, 1000, 200_000, cfg)).toBe(250);
    expect(positionSizeUsd(1000, 1000, 5_000, cfg)).toBe(100);
    expect(positionSizeUsd(1000, 50, 200_000, cfg)).toBe(50);
    expect(positionSizeUsd(1000, 4, 200_000, cfg)).toBe(0);
  });
});

describe('salidas', () => {
  const pos = (o: Partial<Position> = {}): Position => ({
    mint: 'a',
    symbol: 'A',
    decimals: 6,
    amountRaw: '1000000000',
    costUsd: 10,
    entryPrice: 0.01,
    entryLiquidityUsd: 200_000,
    peakPrice: 0.01,
    openedAt: NOW,
    tookProfit: false,
    realizedPnlUsd: 0,
    ...o,
  });

  it('mantiene si no pasa nada', () => {
    expect(exitDecision(pos(), metrics('a', { priceUsd: 0.011 }), cfg, NOW).sellFraction).toBe(0);
  });

  it('stop-loss', () => {
    expect(exitDecision(pos(), metrics('a', { priceUsd: 0.0074 }), cfg, NOW)).toMatchObject({ sellFraction: 1, reason: 'stop-loss' });
  });

  it('toma de ganancia vende la mitad', () => {
    expect(exitDecision(pos(), metrics('a', { priceUsd: 0.0155 }), cfg, NOW)).toMatchObject({ sellFraction: 0.5, takeProfit: true });
  });

  it('stop dinámico después de tomar ganancia', () => {
    const p = pos({ tookProfit: true, peakPrice: 0.02 });
    expect(exitDecision(p, metrics('a', { priceUsd: 0.016 }), cfg, NOW).sellFraction).toBe(0);
    expect(exitDecision(p, metrics('a', { priceUsd: 0.0149 }), cfg, NOW)).toMatchObject({ sellFraction: 1, reason: 'stop dinámico' });
  });

  it('salida de emergencia si se va la liquidez', () => {
    expect(exitDecision(pos(), metrics('a', { liquidityUsd: 90_000 }), cfg, NOW)).toMatchObject({ sellFraction: 1, emergency: true });
  });

  it('corte por tiempo si no despega', () => {
    const later = NOW + 91 * 60_000;
    expect(exitDecision(pos(), metrics('a', { priceUsd: 0.0105 }), cfg, later)).toMatchObject({ reason: 'sin impulso (tiempo)' });
  });

  it('sale si dominan las ventas y va perdiendo', () => {
    const m = metrics('a', { priceUsd: 0.0095, buysM5: 10, sellsM5: 40 });
    expect(exitDecision(pos(), m, cfg, NOW)).toMatchObject({ reason: 'dominan las ventas' });
  });
});

describe('configuración', () => {
  it('usa valores por defecto y trata las variables vacías como no definidas', () => {
    const c = parseConfig({ MODE: '', TARGET_USD: '', MAX_POSITIONS: '5' });
    expect(c.MODE).toBe('paper');
    expect(c.TARGET_USD).toBe(100_000);
    expect(c.MAX_POSITIONS).toBe(5);
  });

  it('rechaza valores inválidos', () => {
    expect(() => parseConfig({ MODE: 'yolo' })).toThrow();
    expect(() => parseConfig({ POSITION_FRACTION: '2' })).toThrow();
  });
});

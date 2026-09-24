import { describe, expect, it } from 'vitest';
import { allocateFefo } from '../src/domain/fefo';
import { bulkPrice, marginPrice, roundPrice } from '../src/domain/pricing';
import { dateOnly, localYMD, startOfLocalDay } from '../src/domain/dates';

const lot = (id: string, expires: string | null, qty: number, cost = 10, received = '2026-01-01') => ({
  id,
  expiresAt: expires ? dateOnly(expires) : null,
  receivedAt: new Date(received),
  qtyRemaining: qty,
  unitCost: cost,
});
const today = dateOnly('2026-09-24');

describe('FEFO', () => {
  it('descuenta primero del lote que vence antes y reparte entre lotes', () => {
    const res = allocateFefo([lot('b', '2026-12-01', 10, 12), lot('a', '2026-10-01', 3, 10)], 5, today, 11);
    expect(res).toEqual([
      { lotId: 'a', qty: 3, unitCost: 10 },
      { lotId: 'b', qty: 2, unitCost: 12 },
    ]);
  });
  it('los lotes sin vencimiento van al final y los vencidos solo si no queda otra', () => {
    const lots = [lot('sin', null, 5), lot('venc', '2026-09-01', 5), lot('ok', '2026-10-10', 1)];
    expect(allocateFefo(lots, 1, today, 0).map((a) => a.lotId)).toEqual(['ok']);
    expect(allocateFefo(lots, 7, today, 0).map((a) => [a.lotId, a.qty])).toEqual([['ok', 1], ['sin', 5], ['venc', 1]]);
  });
  it('si no alcanza, el resto queda como vendido sin stock', () => {
    expect(allocateFefo([lot('a', null, 1.5)], 2, today, 9)).toEqual([
      { lotId: 'a', qty: 1.5, unitCost: 10 },
      { lotId: null, qty: 0.5, unitCost: 9 },
    ]);
  });
  it('a igual vencimiento usa el lote más viejo', () => {
    const res = allocateFefo([lot('nuevo', '2026-10-01', 5, 10, '2026-09-01'), lot('viejo', '2026-10-01', 5, 10, '2026-08-01')], 1, today, 0);
    expect(res[0].lotId).toBe('viejo');
  });
});

describe('precios', () => {
  it('redondea según el paso configurado', () => {
    expect(roundPrice(1234, 10, 'up')).toBe(1240);
    expect(roundPrice(1234, 10, 'down')).toBe(1230);
    expect(roundPrice(1234.567, 0)).toBe(1234.57);
  });
  it('precio por margen objetivo', () => {
    expect(marginPrice(1000, 40, 10)).toBe(1400);
    expect(marginPrice(999, 40, 50)).toBe(1400);
  });
  it('suba masiva redondea para arriba y baja masiva para abajo', () => {
    expect(bulkPrice(1000, 10, 10)).toBe(1100);
    expect(bulkPrice(1005, 10, 10)).toBe(1110);
    expect(bulkPrice(1005, -10, 10)).toBe(900);
    expect(bulkPrice(5, -50, 10)).toBe(2.5);
  });
});

describe('fechas del local', () => {
  it('usa la zona horaria del negocio', () => {
    const at = new Date('2026-09-24T02:00:00Z'); // 23:00 del 23 en Buenos Aires
    expect(localYMD('America/Argentina/Buenos_Aires', at)).toBe('2026-09-23');
    expect(startOfLocalDay('America/Argentina/Buenos_Aires', at).toISOString()).toBe('2026-09-23T03:00:00.000Z');
  });
});

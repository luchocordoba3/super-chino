import { describe, expect, it } from 'vitest';
import { allocateFefo } from '../src/domain/fefo';
import { bulkPrice, marginPrice, roundPrice } from '../src/domain/pricing';
import { dateOnly, localYMD, startOfLocalDay } from '../src/domain/dates';
import { stockLevel } from '../src/domain/stockLevel';

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

import { parseContent, unitPrice } from '@almacen/shared';

describe('precio por unidad de medida (etiquetas)', () => {
  it('lee el contenido en el nombre', () => {
    expect(parseContent('Puré de tomate 520g')).toEqual({ qty: 520, unit: 'g' });
    expect(parseContent('Aceite de girasol 1,5L')).toEqual({ qty: 1.5, unit: 'l' });
    expect(parseContent('Cerveza lata 473 ml')).toEqual({ qty: 473, unit: 'ml' });
    expect(parseContent('Yerba mate 1 KG')).toEqual({ qty: 1, unit: 'kg' });
    expect(parseContent('Galletitas x 3 un')).toEqual({ qty: 3, unit: 'u' });
    expect(parseContent('Lavandina')).toBeNull();
    expect(parseContent('Leche 1L entera light')).toEqual({ qty: 1, unit: 'l' });
  });
  it('calcula por kilo o litro, y cada 10 g/ml en envases de 50 o menos', () => {
    expect(unitPrice(1200, { qty: 520, unit: 'g' })).toEqual({ value: 2307.69, per: 'kg' });
    expect(unitPrice(3900, { qty: 1.5, unit: 'l' })).toEqual({ value: 2600, per: 'l' });
    expect(unitPrice(500, { qty: 40, unit: 'g' })).toEqual({ value: 125, per: '10 g' });
    expect(unitPrice(9800, null, 'KG')).toEqual({ value: 9800, per: 'kg' });
    expect(unitPrice(1000, null)).toBeNull();
  });
});

describe('stock en %', () => {
  const base = { idealStock: null, refStock: null, minStock: 0, perDay: 0, lowPct: 25 };
  it('usa el stock ideal si está; si no, lo que quedó al reponer', () => {
    expect(stockLevel({ ...base, stock: 30, refStock: 40 })).toMatchObject({ pct: 75, ref: 40, level: 'ok' });
    expect(stockLevel({ ...base, stock: 30, refStock: 40, idealStock: 60 })).toMatchObject({ pct: 50, ref: 60, level: 'mid' });
  });
  it('rojo en el % bajo, en el mínimo o sin stock; nunca más de 100%', () => {
    expect(stockLevel({ ...base, stock: 10, refStock: 40 }).level).toBe('low');
    expect(stockLevel({ ...base, stock: 30, refStock: 40, minStock: 30 }).level).toBe('low');
    expect(stockLevel({ ...base, stock: 0 })).toMatchObject({ pct: null, level: 'low' });
    expect(stockLevel({ ...base, stock: 5 })).toMatchObject({ pct: null, level: 'none' });
    expect(stockLevel({ ...base, stock: 80, refStock: 40 }).pct).toBe(100);
  });
  it('días que alcanza al ritmo de venta', () => {
    expect(stockLevel({ ...base, stock: 10, refStock: 40, perDay: 4 }).daysLeft).toBe(2);
    expect(stockLevel({ ...base, stock: 10, refStock: 40 }).daysLeft).toBeNull();
  });
});

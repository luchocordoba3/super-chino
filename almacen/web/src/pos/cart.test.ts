import { describe, expect, it } from 'vitest';
import { addItem, cartTotal, parseScan, priceCart, settlePayments } from './cart';

const yogur = { id: 'y', name: 'Yogur', unit: 'UNIT' as const, price: 1000 };

describe('carrito', () => {
  it('escanear dos veces suma cantidad', () => {
    const items = addItem(addItem([], yogur, 1), yogur, 2);
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(3);
  });

  it('la oferta se aplica solo hasta agotar el lote y el resto va a precio normal', () => {
    const items = addItem([], yogur, 5);
    const lines = priceCart(items, new Map([['y', { id: 'o1', offerPrice: 600, remaining: 3 }]]));
    expect(lines.map((l) => [l.qty, l.unitPrice, l.offerId])).toEqual([
      [3, 600, 'o1'],
      [2, 1000, null],
    ]);
    expect(cartTotal(lines)).toBe(3800);
  });

  it('precio cambiado a mano queda marcado', () => {
    const items = [{ ...addItem([], yogur, 1)[0], overridePrice: 500 }];
    const [line] = priceCart(items, new Map());
    expect(line).toMatchObject({ unitPrice: 500, priceOverride: true, lineTotal: 500 });
  });

  it('interpreta cantidad con asterisco', () => {
    expect(parseScan('3*7790001')).toEqual({ qty: 3, code: '7790001' });
    expect(parseScan('0,5 x 123')).toEqual({ qty: 0.5, code: '123' });
    expect(parseScan('7790001')).toEqual({ qty: null, code: '7790001' });
  });

  it('pago en efectivo con vuelto y pago mixto', () => {
    expect(settlePayments(3800, [{ method: 'CASH', amount: 5000 }])).toEqual({ payments: [{ method: 'CASH', amount: 3800 }], change: 1200, missing: 0 });
    expect(settlePayments(3800, [{ method: 'DEBIT', amount: 3000 }, { method: 'CASH', amount: 1000 }])).toEqual({
      payments: [
        { method: 'DEBIT', amount: 3000 },
        { method: 'CASH', amount: 800 },
      ],
      change: 200,
      missing: 0,
    });
    expect(settlePayments(3800, [{ method: 'CASH', amount: 1000 }]).missing).toBe(2800);
  });
});

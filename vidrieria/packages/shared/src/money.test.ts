import { describe, expect, it } from 'vitest';
import { MONOTRIBUTO_CAPS, installments, netOf } from './money';

describe('plata', () => {
  it('neto después de la comisión', () => {
    expect(netOf(100_000, 5.99)).toBe(94_010);
    expect(netOf(100_000, 0)).toBe(100_000);
  });
  it('cuotas con recargo, ordenadas', () => {
    expect(installments(300_000, { '6': 18, '3': 10, '1': 0 })).toEqual([
      { n: 3, pct: 10, total: 330_000, each: 110_000 },
      { n: 6, pct: 18, total: 354_000, each: 59_000 },
    ]);
  });
  it('topes del monotributo de agosto 2026', () => {
    expect(MONOTRIBUTO_CAPS.K).toBe(126_610_838.75);
    expect(Object.keys(MONOTRIBUTO_CAPS)).toHaveLength(11);
  });
});

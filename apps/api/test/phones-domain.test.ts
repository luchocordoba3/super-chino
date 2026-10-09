import { describe, expect, it } from 'vitest';
import { addMonthsYMD, agingBucket, effectiveRate, isValidImei, parseSettings, planPrice, toArs, toUsd, waNumber, warrantyMonths } from '@super-chino/shared';

const s = parseSettings({});
const quotes = [
  { casa: 'blue', compra: 1180, venta: 1200, fetchedAt: '2026-10-09T12:00:00Z' },
  { casa: 'oficial', compra: 950, venta: 1000, fetchedAt: '2026-10-09T12:00:00Z' },
];

describe('cuentas de la casa de celulares', () => {
  it('cotización: la elegida + ajuste; si no hay de internet, la propia', () => {
    expect(effectiveRate(s, quotes)).toBe(1200);
    expect(effectiveRate({ ...s, fxSource: 'oficial', fxSide: 'compra', fxMarkup: 15 }, quotes)).toBe(965);
    expect(effectiveRate({ ...s, fxSource: 'bolsa', fxManual: 1150 }, quotes)).toBe(1150);
    expect(effectiveRate({ ...s, fxSource: 'manual', fxManual: 0 }, quotes)).toBeNull();
    expect(toArs(500, 'USD', 1200)).toBe(600000);
    expect(toArs(500, 'ARS', 1200)).toBe(500);
    expect(toUsd(600000, 1200)).toBe(500);
  });

  it('cuotas: recargo sobre el contado y valor de cada cuota', () => {
    expect(planPrice(100000, { installments: 3, pct: 15 })).toEqual({ total: 115000, surcharge: 15000, perInstallment: 38333.33 });
  });

  it('garantía: nunca menos que la ley (6 meses nuevo, 3 usado)', () => {
    expect(warrantyMonths(s, 'NEW')).toBe(6);
    expect(warrantyMonths(s, 'USED')).toBe(3);
    expect(warrantyMonths(s, 'NEW', 12)).toBe(12);
    expect(warrantyMonths(s, 'USED', 1)).toBe(3);
    expect(addMonthsYMD('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsYMD('2026-08-15', 6)).toBe('2027-02-15');
  });

  it('IMEI con dígito verificador y números de WhatsApp argentinos', () => {
    expect(isValidImei('490154203237518')).toBe(true);
    expect(isValidImei('490154203237519')).toBe(false);
    expect(isValidImei('4901542032375')).toBe(false);
    expect(waNumber('011 15-2345-6789')).toBe('5491123456789');
    expect(waNumber('+54 9 11 2345 6789')).toBe('5491123456789');
    expect(waNumber('351 15 456 7890')).toBe('5493514567890');
    expect(waNumber('1123456789')).toBe('5491123456789');
  });

  it('antigüedad del stock por rangos', () => {
    expect([0, 30, 31, 60, 61, 90, 91].map(agingBucket)).toEqual(['0-30', '0-30', '31-60', '31-60', '61-90', '61-90', '90+']);
  });
});

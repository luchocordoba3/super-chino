import { describe, expect, it } from 'vitest';
import { TWO_PEOPLE_KG, glassMm, pieceWeightKg } from './weights';

describe('peso del vidrio', () => {
  it('saca el espesor del nombre', () => {
    expect(glassMm('Templado 8 mm')).toBe(8);
    expect(glassMm('Laminado 4+4')).toBe(8);
    expect(glassMm('DVH 4 / 12 / 4')).toBe(8);
    expect(glassMm('Espejo 4 mm')).toBe(4);
    expect(glassMm('Kit mampara')).toBeNull();
  });
  it('mampara de 1200 × 1800 en templado 8 pesa unos 43 kg: van 2', () => {
    const kg = pieceWeightKg('Templado 8 mm', 1200, 1800)!;
    expect(kg).toBe(43.2);
    expect(kg >= TWO_PEOPLE_KG).toBe(true);
    expect(pieceWeightKg('Float incoloro 4 mm', 500, 700)).toBe(3.5);
  });
});

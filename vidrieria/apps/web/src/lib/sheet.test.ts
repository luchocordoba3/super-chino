import { describe, expect, it } from 'vitest';
import { buildRows, guessCategory, guessMapping, parseCsv, parseNumber } from './sheet';

describe('lista del proveedor', () => {
  it('lee números argentinos', () => {
    expect(parseNumber('$ 1.234,50')).toBe(1234.5);
    expect(parseNumber('US$ 60')).toBe(60);
    expect(parseNumber('1.450')).toBe(1450);
    expect(parseNumber('2,5')).toBe(2.5);
  });

  it('adivina columnas, categoría, unidad, moneda y espesor', () => {
    const table = parseCsv('Descripción;Precio m2;Moneda\nTemplado incoloro 8 mm;75;USD\nKit mampara corrediza;95;u$s\nSilicona neutra;9.000;$\n;;\n');
    const mapping = guessMapping(table[0]);
    expect(mapping.name).toBe(0);
    expect(mapping.price).toBe(1);
    expect(mapping.currency).toBe(2);
    const { rows } = buildRows(table, mapping, 'ARS');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ category: 'VIDRIO', unit: 'M2', currency: 'USD', thicknessMm: 8, price: 75 });
    expect(rows[1]).toMatchObject({ category: 'HERRAJE', unit: 'UNIT', currency: 'USD' });
    expect(rows[2]).toMatchObject({ category: 'HERRAJE', currency: 'ARS', price: 9000 });
  });

  it('categorías por nombre', () => {
    expect(guessCategory('Espejo 4 mm')).toBe('VIDRIO');
    expect(guessCategory('Pulido de cantos')).toBe('PROCESO');
    expect(guessCategory('Colocación de mampara')).toBe('SERVICIO');
    expect(guessCategory('Perfil U aluminio')).toBe('PERFIL');
  });
});

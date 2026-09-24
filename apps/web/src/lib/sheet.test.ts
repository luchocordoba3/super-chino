import { describe, expect, it } from 'vitest';
import { eanModules } from './ean13';
import { buildRows, guessMapping, parseBarcode, parseCsv, parseDate, parseNumber } from './sheet';

describe('importar planillas', () => {
  it('lee CSV con ; comillas y acentos', () => {
    expect(parseCsv('﻿codigo;nombre;precio\r\n779;"Puré; ""extra""";1.234,50\r\n')).toEqual([
      ['codigo', 'nombre', 'precio'],
      ['779', 'Puré; "extra"', '1.234,50'],
    ]);
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
  it('entiende números argentinos e internacionales', () => {
    expect(parseNumber('$ 1.234,50')).toBe(1234.5);
    expect(parseNumber('1234.5')).toBe(1234.5);
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('12.000')).toBe(12000);
    expect(parseNumber('1,234,567')).toBe(1234567);
    expect(parseNumber(99)).toBe(99);
    expect(parseNumber('')).toBeNull();
  });
  it('códigos de barras y fechas de Excel', () => {
    expect(parseBarcode(7790000000010)).toEqual({ code: '7790000000010', broken: false });
    expect(parseBarcode('7,79E+12')).toEqual({ code: null, broken: true });
    expect(parseDate('01/03/2027')).toBe('2027-03-01');
    expect(parseDate('5/1/27')).toBe('2027-01-05');
    expect(parseDate(46082)).toBe('2026-03-01');
    expect(parseDate(new Date(Date.UTC(2027, 2, 1)))).toBe('2027-03-01');
  });
  it('adivina las columnas por los títulos y arma las filas', () => {
    const table = [
      ['Código de barras', 'Descripción', 'Precio Venta', 'Costo', 'Stock', 'Rubro', 'Unidad'],
      ['7790000000010', 'Puré de tomate', '1.200', '800', '24', 'Almacén', 'unidad'],
      ['', 'Queso cremoso', '9800', '7000', '4,5', 'Lácteos', 'kg'],
      ['', '', '', '', '', '', ''],
    ];
    const m = guessMapping(table[0]);
    expect(m).toMatchObject({ barcode: 0, name: 1, price: 2, cost: 3, stock: 4, category: 5, unit: 6, supplier: -1 });
    const { rows } = buildRows(table, m);
    expect(rows).toEqual([
      expect.objectContaining({ row: 2, barcode: '7790000000010', name: 'Puré de tomate', price: 1200, cost: 800, stock: 24, category: 'Almacén', unit: 'UNIT' }),
      expect.objectContaining({ row: 3, barcode: null, name: 'Queso cremoso', price: 9800, stock: 4.5, unit: 'KG' }),
    ]);
  });
});

describe('código de barras de las etiquetas', () => {
  it('dibuja EAN-13 válidos (95 módulos) y rechaza los inválidos', () => {
    const m = eanModules('4006381333931')!;
    expect(m).toHaveLength(95);
    expect(m.slice(0, 3)).toBe('101');
    expect(m.slice(45, 50)).toBe('01010');
    expect(m.slice(-3)).toBe('101');
    expect(eanModules('4006381333932')).toBeNull();
    expect(eanModules('12345')).toBeNull();
    expect(eanModules('96385074')).toHaveLength(67);
  });
});

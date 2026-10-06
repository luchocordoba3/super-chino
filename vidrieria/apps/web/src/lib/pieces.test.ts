import { describe, expect, it } from 'vitest';
import { parsePieces } from '@vidrieria/shared';
import { itemFromSpec } from './pieces';
import type { CatalogItem, Template } from './types';

const cat = (id: string, name: string, thicknessMm: number | null, isGlass = true): CatalogItem => ({
  id,
  category: isGlass ? 'VIDRIO' : 'SERVICIO',
  name,
  thicknessMm,
  unit: isGlass ? 'M2' : 'FIXED',
  price: 10,
  currency: 'USD',
  cost: 6,
  isGlass,
  stockQty: null,
  stockMin: null,
  active: true,
  updatedAt: '',
});
const catalog = [
  cat('f4', 'Float incoloro 4 mm', 4),
  cat('f6', 'Float incoloro 6 mm', 6),
  cat('l44', 'Laminado 4+4', 8),
  cat('t8', 'Templado 8 mm', 8),
  cat('t10', 'Templado 10 mm', 10),
  cat('l55', 'Laminado 5+5', 10),
  cat('e4', 'Espejo 4 mm', 4),
  cat('col', 'Colocación', null, false),
];
const tpl = (id: string, name: string, glass: string): Template => ({
  id,
  name,
  description: '',
  defaultWidthMm: 1000,
  defaultHeightMm: 1000,
  sort: 0,
  lines: [
    { catalogItemId: glass, basis: 'm2', factor: 1 },
    { catalogItemId: 'col', basis: 'fijo', factor: 1 },
  ],
});
const templates = [tpl('m', 'Mampara corrediza', 't8'), tpl('c', 'Cambio de vidrio', 'f4'), tpl('b', 'Baranda / escalera de vidrio', 'l55'), tpl('e', 'Espejo a medida', 'e4')];
const glassOf = (text: string) => itemFromSpec({ ...parsePieces(text)[0], title: '' }, templates, catalog).lines[0];

describe('itemFromSpec', () => {
  it('usa la plantilla del tipo y copia el costo', () => {
    const it = itemFromSpec({ ...parsePieces('mampara 120x180')[0], title: 'Mampara' }, templates, catalog);
    expect(it).toMatchObject({ title: 'Mampara', widthMm: 1200, heightMm: 1800 });
    expect(it.lines.map((l) => l.catalogItemId)).toEqual(['t8', 'col']);
    expect(it.lines[0].unitCost).toBe(6);
  });

  it('cambia el vidrio por el pedido, manteniendo el tipo de la plantilla si no lo dice', () => {
    expect(glassOf('vidrio 50x70 de 6mm').catalogItemId).toBe('f6');
    expect(glassOf('mampara 120x180 10mm').catalogItemId).toBe('t10');
    expect(glassOf('baranda 200x100 laminado 4+4').catalogItemId).toBe('l44');
    expect(glassOf('baranda 200x100').catalogItemId).toBe('l55');
    expect(glassOf('espejo 60x90').catalogItemId).toBe('e4');
  });
});

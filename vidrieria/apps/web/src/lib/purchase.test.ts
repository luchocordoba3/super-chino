import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, calcQuote, type LineInput } from '@vidrieria/shared';
import { buildPurchase, purchaseMessage } from './purchase';
import type { CatalogItem } from './types';

const c = (id: string, category: CatalogItem['category']) => ({ id, category }) as CatalogItem;
const catalog = [c('t8', 'VIDRIO'), c('kit', 'HERRAJE'), c('sil', 'HERRAJE'), c('pul', 'PROCESO'), c('col', 'SERVICIO')];
const L = (catalogItemId: string, name: string, basis: LineInput['basis'], applyWaste = false): LineInput => ({
  catalogItemId,
  name,
  basis,
  factor: 1,
  unitPrice: 1,
  currency: 'ARS',
  applyWaste,
});
const mampara = (w: number, h: number, quantity = 1) => ({
  title: 'Mampara',
  widthMm: w,
  heightMm: h,
  quantity,
  lines: [L('t8', 'Templado 8 mm', 'm2', true), L('pul', 'Pulido', 'perimetro'), L('kit', 'Kit mampara', 'unidad'), L('sil', 'Silicona', 'unidad'), L('col', 'Colocación', 'fijo')],
});
const q = (number: number, items: ReturnType<typeof mampara>[], extras: LineInput[] = []) => ({
  number,
  result: calcQuote({ items, extras, freightKm: 0, urgent: false, adjustPct: 0, discount: 0 }, DEFAULT_SETTINGS),
});

describe('buildPurchase', () => {
  it('vidrios por pieza, herrajes sumados y sin servicios ni procesos', () => {
    const o = buildPurchase([q(3, [mampara(1200, 1800)]), q(5, [mampara(900, 1800, 2)], [L('sil', 'Silicona', 'fijo')])], catalog);
    expect(o.glass).toEqual([
      {
        name: 'Templado 8 mm',
        m2: 2.16 + 3.24,
        pieces: [
          { widthMm: 1200, heightMm: 1800, quantity: 1, quote: 3 },
          { widthMm: 900, heightMm: 1800, quantity: 2, quote: 5 },
        ],
      },
    ]);
    expect(o.others).toEqual([
      { name: 'Kit mampara', qty: 3, unit: 'u' },
      { name: 'Silicona', qty: 4, unit: 'u' },
    ]);
    const msg = purchaseMessage(o, 'Cristales Ariel', 'Elasic Ventas');
    expect(msg).toContain('¡Hola Elasic! Te paso un pedido de Cristales Ariel:');
    expect(msg).toContain('   - 2 × 900 × 1.800 mm');
    expect(msg).toContain('• Kit mampara: 3 u');
    expect(msg).not.toMatch(/Pulido|Colocación/);
  });
});

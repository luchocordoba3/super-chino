import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, calcQuote, linesFromTemplate, roundedMeters, type LineInput, type QuoteInput } from './quote';
import { waLink, waNumber } from './phone';

const s = { ...DEFAULT_SETTINGS, dollarRate: 1000, wastePct: 15, depositPct: 50, urgencyPct: 20, freightPerKm: 500 };

const vidrio: LineInput = { name: 'Templado 8 mm', basis: 'm2', factor: 1, unitPrice: 60, currency: 'USD', applyWaste: true };
const cantos: LineInput = { name: 'Pulido de cantos', basis: 'perimetro', factor: 1, unitPrice: 2000, currency: 'ARS', applyWaste: false };
const kit: LineInput = { name: 'Kit mampara', basis: 'unidad', factor: 1, unitPrice: 85, currency: 'USD', applyWaste: false };
const colocacion: LineInput = { name: 'Colocación', basis: 'fijo', factor: 1, unitPrice: 60000, currency: 'ARS', applyWaste: false };

const mampara = (over: Partial<QuoteInput> = {}): QuoteInput => ({
  items: [{ title: 'Mampara corrediza', widthMm: 1200, heightMm: 1800, quantity: 1, lines: [vidrio, cantos, kit, colocacion] }],
  extras: [],
  freightKm: 0,
  urgent: false,
  adjustPct: 0,
  discount: 0,
  ...over,
});

describe('calcQuote', () => {
  it('mampara 1200 × 1800 en templado 8 mm con dólar a 1000', () => {
    const r = calcQuote(mampara(), s);
    const [it] = r.items;
    expect(it.areaM2).toBe(2.16);
    expect(it.perimeterMl).toBe(6);
    // Vidrio: 2,16 m² + 15 % = 2,484 m² × US$60 × 1000
    expect(it.lines[0]).toMatchObject({ qty: 2.484, unitPriceArs: 60000, total: 149040 });
    expect(it.lines[1]).toMatchObject({ qty: 6, total: 12000 });
    expect(it.lines[2]).toMatchObject({ qty: 1, unitPriceArs: 85000, total: 85000 });
    expect(it.lines[3]).toMatchObject({ qty: 1, total: 60000 });
    expect(r.total).toBe(306040);
    expect(r.deposit).toBe(153020);
    expect(r.balance).toBe(153020);
    expect(r.totalUsd).toBe(306.04);
    // IVA contenido (precios con IVA)
    expect(r.vat).toBeCloseTo(306040 - 306040 / 1.21, 2);
  });

  it('cantidad de piezas multiplica m², perímetro y unidades, pero no lo fijo', () => {
    const r = calcQuote(mampara({ items: [{ ...mampara().items[0], quantity: 2 }] }), s);
    const l = r.items[0].lines;
    expect(l[0].qty).toBe(4.968);
    expect(l[1].qty).toBe(12);
    expect(l[2].qty).toBe(2);
    expect(l[3].qty).toBe(1);
  });

  it('flete por km, urgencia, ajuste por cliente y descuento', () => {
    const base = calcQuote(mampara(), s).subtotal; // 306040
    const r = calcQuote(mampara({ freightKm: 20, urgent: true, adjustPct: -10, discount: 1040 }), s);
    expect(r.adjust).toBe(-30604);
    expect(r.urgency).toBe(Math.round((base - 30604) * 0.2 * 100) / 100);
    expect(r.freight).toBe(10000);
    expect(r.total).toBe(Math.round(base - 30604 + r.urgency + 10000 - 1040));
  });

  it('sin IVA incluido lo suma al total', () => {
    const r = calcQuote(mampara(), { ...s, pricesIncludeVat: false });
    expect(r.total).toBe(Math.round(306040 * 1.21));
    expect(r.vat).toBeCloseTo(r.total - 306040, 2);
  });

  it('respeta cantidades y precios puestos a mano', () => {
    const r = calcQuote(mampara({ items: [{ ...mampara().items[0], lines: [{ ...vidrio, qtyOverride: 3, priceOverride: 50000 }] }] }), s);
    expect(r.items[0].lines[0]).toMatchObject({ qty: 3, unitPriceArs: 50000, total: 150000 });
  });

  it('las líneas sueltas cuentan una vez (medición, retiro)', () => {
    const r = calcQuote(mampara({ items: [], extras: [{ ...colocacion, name: 'Medición', unitPrice: 15000, factor: 1 }] }), s);
    expect(r.extras[0]).toMatchObject({ qty: 1, total: 15000 });
    expect(r.total).toBe(15000);
  });

  it('redondeo de medidas y mínimo por pieza', () => {
    expect(roundedMeters(1203, 5)).toBe(1.25);
    expect(roundedMeters(1200, 5)).toBe(1.2);
    expect(roundedMeters(1203, 0)).toBe(1.203);
    const r = calcQuote(
      mampara({ items: [{ title: 'Vidrio chico', widthMm: 200, heightMm: 300, quantity: 2, lines: [{ ...vidrio, applyWaste: false }] }] }),
      { ...s, minAreaM2: 0.25 },
    );
    expect(r.items[0].areaM2).toBe(0.5);
  });
});

describe('linesFromTemplate', () => {
  it('toma precio y moneda del catálogo y marca el desperdicio en vidrios', () => {
    const lines = linesFromTemplate(
      [
        { catalogItemId: 'v', basis: 'm2', factor: 1 },
        { catalogItemId: 'borrado', basis: 'unidad', factor: 1 },
        { catalogItemId: 'a', basis: 'unidad', factor: 4 },
      ],
      [
        { id: 'v', name: 'Float 4 mm', price: 25, currency: 'USD', isGlass: true },
        { id: 'a', name: 'Agujero', price: 3000, currency: 'ARS', isGlass: false },
      ],
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ name: 'Float 4 mm', applyWaste: true, currency: 'USD' });
    expect(lines[1]).toMatchObject({ factor: 4, applyWaste: false });
  });
});

describe('waNumber', () => {
  it.each([
    ['11 3364-0560', '5491133640560'],
    ['011 15 3364-0560', '5491133640560'],
    ['+54 9 11 3364-0560', '5491133640560'],
    ['5491133640560', '5491133640560'],
    ['0351 15 612-3456', '5493516123456'],
    ['113364056', null],
    ['', null],
  ])('%s -> %s', (raw, want) => expect(waNumber(raw)).toBe(want));

  it('sin número deja elegir el contacto', () => {
    expect(waLink('', 'hola')).toBe('https://wa.me/?text=hola');
  });
});

/**
 * Motor de presupuestos. Funciones puras: las usan la web (cálculo al instante) y la API (guarda lo mismo).
 * Medidas en mm, precios en la moneda de cada ítem del catálogo, totales en pesos.
 */

export const UNITS = ['M2', 'ML', 'UNIT', 'FIXED'] as const;
export type Unit = (typeof UNITS)[number];

export const CURRENCIES = ['ARS', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** De dónde sale la cantidad de una línea: de las medidas de la pieza o fija. */
export const BASES = ['m2', 'perimetro', 'ancho', 'alto', 'unidad', 'fijo'] as const;
export type Basis = (typeof BASES)[number];

export const BASIS_LABEL: Record<Basis, string> = {
  m2: 'm² de la pieza',
  perimetro: 'perímetro (ml)',
  ancho: 'ancho (ml)',
  alto: 'alto (ml)',
  unidad: 'por pieza',
  fijo: 'fijo por trabajo',
};

/** Unidad que corresponde a cada base, para mostrar "4,2 m²" o "3 u". */
export const BASIS_UNIT: Record<Basis, string> = { m2: 'm²', perimetro: 'ml', ancho: 'ml', alto: 'ml', unidad: 'u', fijo: 'u' };

export interface QuoteSettings {
  /** Pesos por dólar. */
  dollarRate: number;
  /** % que se suma a las líneas marcadas como vidrio (cortes y roturas). */
  wastePct: number;
  /** % de seña. */
  depositPct: number;
  /** % de recargo si el trabajo es urgente o fuera de horario. */
  urgencyPct: number;
  /** Pesos por km de traslado. */
  freightPerKm: number;
  /** true: los precios del catálogo ya incluyen IVA. */
  pricesIncludeVat: boolean;
  vatPct: number;
  /** Redondeo de medidas hacia arriba, en cm (0 = medida exacta). */
  roundToCm: number;
  /** Superficie mínima que se cobra por pieza, en m² (0 = sin mínimo). */
  minAreaM2: number;
}

export const DEFAULT_SETTINGS: QuoteSettings = {
  dollarRate: 1000,
  wastePct: 15,
  depositPct: 50,
  urgencyPct: 20,
  freightPerKm: 0,
  pricesIncludeVat: true,
  vatPct: 21,
  roundToCm: 0,
  minAreaM2: 0,
};

export interface LineInput {
  catalogItemId?: string | null;
  name: string;
  basis: Basis;
  /** Multiplica la cantidad: 2 agujeros por pieza, 1,5 ml, etc. */
  factor: number;
  unitPrice: number;
  currency: Currency;
  /** Suma el % de desperdicio (vidrios). */
  applyWaste: boolean;
  /** Cantidad puesta a mano (reemplaza la calculada). */
  qtyOverride?: number | null;
  /** Precio unitario en pesos puesto a mano (reemplaza el del catálogo). */
  priceOverride?: number | null;
  /** Costo unitario, en la misma moneda que unitPrice (para calcular la ganancia; el cliente no lo ve). */
  unitCost?: number | null;
}

export interface ItemInput {
  title: string;
  widthMm: number;
  heightMm: number;
  quantity: number;
  lines: LineInput[];
  /** Zona de riesgo marcada a mano: puerta, paño bajo, techo (va vidrio de seguridad). */
  riskZone?: boolean;
}

export interface QuoteInput {
  items: ItemInput[];
  /** Líneas sueltas del presupuesto (medición, retiro del vidrio viejo...). Su base se toma como fija. */
  extras: LineInput[];
  freightKm: number;
  urgent: boolean;
  /** Ajuste por tipo de cliente, en % (ej. -10 para otras vidrierías). */
  adjustPct: number;
  /** Descuento en pesos. */
  discount: number;
}

export interface LineResult extends LineInput {
  qty: number;
  unit: string;
  unitPriceArs: number;
  total: number;
  /** Costo de la línea en pesos (null si no tiene costo cargado). */
  costArs: number | null;
}

export interface ItemResult {
  title: string;
  riskZone?: boolean;
  widthMm: number;
  heightMm: number;
  quantity: number;
  areaM2: number;
  perimeterMl: number;
  lines: LineResult[];
  total: number;
}

export interface QuoteResult {
  items: ItemResult[];
  extras: LineResult[];
  subtotal: number;
  adjust: number;
  urgency: number;
  freight: number;
  discount: number;
  /** Lo que paga el cliente. */
  total: number;
  /** IVA contenido en el total (o sumado, si los precios no lo incluyen). */
  vat: number;
  deposit: number;
  balance: number;
  totalUsd: number;
  /** Costo de las líneas que tienen costo cargado, en pesos. */
  cost: number;
  costedLines: number;
  totalLines: number;
  /** Ganancia estimada: lo que cobra (sin el IVA que se suma aparte) menos el costo cargado. */
  profit: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** Medida en mm redondeada hacia arriba al múltiplo de `cm` (0 = sin redondeo), en metros. */
export function roundedMeters(mm: number, cm: number) {
  const v = pos(mm);
  if (!cm) return v / 1000;
  const step = cm * 10;
  return (Math.ceil(v / step - 1e-9) * step) / 1000;
}

export function pieceGeometry(item: Pick<ItemInput, 'widthMm' | 'heightMm' | 'quantity'>, s: Pick<QuoteSettings, 'roundToCm' | 'minAreaM2'>) {
  const w = roundedMeters(item.widthMm, s.roundToCm);
  const h = roundedMeters(item.heightMm, s.roundToCm);
  const q = pos(item.quantity);
  const area = Math.max(w * h, pos(s.minAreaM2));
  return { w, h, q, areaM2: round3(area * q), perimeterMl: round3(2 * (w + h) * q) };
}

function basisQty(basis: Basis, g: ReturnType<typeof pieceGeometry>) {
  switch (basis) {
    case 'm2':
      return g.areaM2;
    case 'perimetro':
      return g.perimeterMl;
    case 'ancho':
      return g.w * g.q;
    case 'alto':
      return g.h * g.q;
    case 'unidad':
      return g.q;
    case 'fijo':
      return 1;
  }
}

export function unitPriceArs(line: Pick<LineInput, 'unitPrice' | 'currency' | 'priceOverride'>, dollarRate: number) {
  if (line.priceOverride != null) return round2(line.priceOverride);
  return round2(line.currency === 'USD' ? line.unitPrice * dollarRate : line.unitPrice);
}

function calcLine(line: LineInput, s: QuoteSettings, g: ReturnType<typeof pieceGeometry> | null): LineResult {
  const basis = g ? line.basis : 'fijo';
  let qty = g ? basisQty(basis, g) * pos(line.factor) : pos(line.factor);
  if (line.applyWaste) qty *= 1 + pos(s.wastePct) / 100;
  if (line.qtyOverride != null) qty = pos(line.qtyOverride);
  qty = round3(qty);
  const price = unitPriceArs(line, s.dollarRate);
  const unitCost = line.unitCost != null ? (line.currency === 'USD' ? line.unitCost * s.dollarRate : line.unitCost) : null;
  return {
    ...line,
    qty,
    unit: BASIS_UNIT[basis],
    unitPriceArs: price,
    total: round2(qty * price),
    costArs: unitCost != null ? round2(qty * unitCost) : null,
  };
}

export function calcQuote(input: QuoteInput, s: QuoteSettings): QuoteResult {
  const items = input.items.map((it) => {
    const g = pieceGeometry(it, s);
    const lines = it.lines.map((l) => calcLine(l, s, g));
    return {
      title: it.title,
      ...(it.riskZone ? { riskZone: true } : {}),
      widthMm: it.widthMm,
      heightMm: it.heightMm,
      quantity: it.quantity,
      areaM2: g.areaM2,
      perimeterMl: g.perimeterMl,
      lines,
      total: round2(lines.reduce((a, l) => a + l.total, 0)),
    };
  });
  const extras = input.extras.map((l) => calcLine(l, s, null));
  const subtotal = round2(items.reduce((a, i) => a + i.total, 0) + extras.reduce((a, l) => a + l.total, 0));
  const adjust = round2((subtotal * (input.adjustPct || 0)) / 100);
  const urgency = input.urgent ? round2(((subtotal + adjust) * pos(s.urgencyPct)) / 100) : 0;
  const freight = round2(pos(input.freightKm) * pos(s.freightPerKm));
  const discount = round2(pos(input.discount));
  const net = Math.max(0, subtotal + adjust + urgency + freight - discount);
  const vatRate = pos(s.vatPct) / 100;
  const total = Math.round(s.pricesIncludeVat ? net : net * (1 + vatRate));
  const vat = round2(s.pricesIncludeVat ? total - total / (1 + vatRate) : total - net);
  const deposit = Math.round((total * pos(s.depositPct)) / 100);
  const all = [...items.flatMap((i) => i.lines), ...extras];
  const costed = all.filter((l) => l.costArs != null);
  const cost = round2(costed.reduce((a, l) => a + (l.costArs ?? 0), 0));
  return {
    items,
    extras,
    subtotal,
    adjust,
    urgency,
    freight,
    discount,
    total,
    vat,
    deposit,
    balance: total - deposit,
    totalUsd: s.dollarRate > 0 ? round2(total / s.dollarRate) : 0,
    cost,
    costedLines: costed.length,
    totalLines: all.length,
    profit: round2(total - (s.pricesIncludeVat ? 0 : vat) - cost),
  };
}

/** Línea de plantilla: qué ítem del catálogo lleva y cómo se calcula su cantidad. */
export interface TemplateLine {
  catalogItemId: string;
  basis: Basis;
  factor: number;
}

export interface CatalogLike {
  id: string;
  name: string;
  price: number;
  currency: Currency;
  isGlass: boolean;
  cost?: number | null;
}

/** Arma las líneas de un trabajo a partir de una plantilla y el catálogo actual (ignora ítems borrados). */
export function linesFromTemplate(lines: TemplateLine[], catalog: CatalogLike[]): LineInput[] {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  return lines.flatMap((tl) => {
    const c = byId.get(tl.catalogItemId);
    if (!c) return [];
    return [
      { catalogItemId: c.id, name: c.name, basis: tl.basis, factor: tl.factor, unitPrice: c.price, currency: c.currency, applyWaste: c.isGlass, unitCost: c.cost ?? null },
    ];
  });
}

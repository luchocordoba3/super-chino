/** Lectura de la lista del proveedor (Excel o CSV) para importar al catálogo. Todo corre en el navegador. */
import type { Category, Currency, Unit } from '@vidrieria/shared';

export type Cell = string | number | boolean | Date | null;

export const IMPORT_FIELDS = ['name', 'price', 'currency', 'unit', 'category', 'thickness', 'cost'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type Mapping = Record<ImportField, number>;

export interface ImportRow {
  row: number;
  name: string;
  price: number;
  currency: Currency;
  unit: Unit;
  category: Category;
  thicknessMm: number | null;
  cost: number | null;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** CSV con separador ; , o tabulación, comillas y saltos de línea dentro de comillas. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', '\t', ','].map((c) => ({ c, n: firstLine.split(c).length })).sort((a, b) => b.n - a.n)[0].c;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export async function readTable(file: File): Promise<Cell[][]> {
  if (/\.xls[xm]$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    return (await readSheet(file)) as Cell[][];
  }
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
  return parseCsv(text);
}

/** Números en formato argentino o internacional: "$ 1.234,50", "1234.5", "1,5", "US$ 60". */
export function parseNumber(v: Cell | string): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const SYNONYMS: Record<ImportField, string[]> = {
  name: ['descripcion', 'nombre', 'producto', 'articulo', 'detalle', 'item'],
  price: ['precio', 'precio venta', 'precio de venta', 'precio m2', 'precio x m2', 'valor', 'lista', 'precio lista', 'pvp'],
  currency: ['moneda', 'divisa'],
  unit: ['unidad', 'unidad de medida', 'um', 'medida'],
  category: ['categoria', 'rubro', 'familia', 'tipo'],
  thickness: ['espesor', 'mm', 'espesor mm'],
  cost: ['costo', 'precio costo', 'precio de costo', 'compra'],
};

export function guessMapping(headers: Cell[]): Mapping {
  const hs = headers.map((h) => norm(String(h ?? '')));
  const used = new Set<number>();
  const mapping = {} as Mapping;
  for (const field of IMPORT_FIELDS) {
    const syn = SYNONYMS[field];
    let idx = hs.findIndex((h, i) => !used.has(i) && syn.includes(h));
    if (idx < 0) idx = hs.findIndex((h, i) => !used.has(i) && h !== '' && syn.some((s) => h.startsWith(s)));
    mapping[field] = idx;
    if (idx >= 0) used.add(idx);
  }
  return mapping;
}

/** Adivina categoría por el nombre: "Templado 8 mm" -> VIDRIO, "Kit mampara" -> HERRAJE. */
export function guessCategory(name: string, text?: string | null): Category {
  const s = norm(`${text ?? ''} ${name}`);
  if (/\b(vidrio|float|templado|laminado|espejo|dvh|cristal|incoloro|bronce|gris|esmerilado|satinado|policarbonato)\b/.test(s)) return 'VIDRIO';
  if (/\b(perfil|perfileria|aluminio|barra)\b/.test(s)) return 'PERFIL';
  if (/\b(pulido|bisel|biselado|agujero|perforacion|calado|recorte|canto)\b/.test(s)) return 'PROCESO';
  if (/\b(colocacion|medicion|flete|instalacion|mano de obra|retiro)\b/.test(s)) return 'SERVICIO';
  if (/\b(kit|herraje|bisagra|zocalo|pasamanos|silicona|burlete|tornillo|manija|tirador|rueda|guia)\b/.test(s)) return 'HERRAJE';
  return 'OTRO';
}

export function guessUnit(category: Category, text?: string | null): Unit {
  const s = norm(text ?? '');
  if (/m2|metro cuadrado|mts2/.test(s)) return 'M2';
  if (/\bml\b|metro lineal|metro|mts/.test(s)) return 'ML';
  if (/fijo|trabajo|global/.test(s)) return 'FIXED';
  if (/\bu\b|unidad|un|c u|pieza/.test(s)) return 'UNIT';
  return category === 'VIDRIO' ? 'M2' : 'UNIT';
}

export function guessCurrency(text: string | null, fallback: Currency): Currency {
  const s = norm(text ?? '');
  if (/usd|us|dolar|u s/.test(s)) return 'USD';
  if (/ars|peso|\$/.test(text ?? '') || /pesos/.test(s)) return 'ARS';
  return fallback;
}

/** Filas de la planilla (la primera es de títulos) -> filas para importar. */
export function buildRows(table: Cell[][], mapping: Mapping, defaultCurrency: Currency) {
  const rows: ImportRow[] = [];
  const skipped: number[] = [];
  table.slice(1).forEach((cells, i) => {
    const get = (f: ImportField) => (mapping[f] >= 0 ? (cells[mapping[f]] ?? null) : null);
    const text = (f: ImportField) => {
      const v = get(f);
      return v == null || v === '' ? null : String(v).trim() || null;
    };
    const name = text('name');
    const priceCell = get('price');
    const price = parseNumber(priceCell);
    if (!name || price == null || price < 0) {
      if (name || priceCell != null) skipped.push(i + 2);
      return;
    }
    const category = guessCategory(name, text('category'));
    const priceText = typeof priceCell === 'string' ? priceCell : null;
    rows.push({
      row: i + 2,
      name: name.slice(0, 200),
      price,
      currency: guessCurrency(text('currency') ?? priceText, defaultCurrency),
      unit: guessUnit(category, text('unit')),
      category,
      thicknessMm: parseNumber(get('thickness')) ?? (Number(name.match(/(\d+(?:[.,]\d+)?)\s*mm/i)?.[1]?.replace(',', '.')) || null),
      cost: parseNumber(get('cost')),
    });
  });
  return { rows, skipped };
}

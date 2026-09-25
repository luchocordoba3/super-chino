/** Lectura de planillas (Excel o CSV) para importar el catálogo. Todo corre en el navegador. */

export type Cell = string | number | boolean | Date | null;

export const IMPORT_FIELDS = ['barcode', 'name', 'price', 'cost', 'stock', 'minStock', 'idealStock', 'category', 'supplier', 'unit', 'expiresAt'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type Mapping = Record<ImportField, number>;

export interface ImportRow {
  row: number;
  barcode?: string | null;
  name?: string | null;
  price?: number | null;
  cost?: number | null;
  stock?: number | null;
  minStock?: number | null;
  idealStock?: number | null;
  category?: string | null;
  supplier?: string | null;
  unit?: 'UNIT' | 'KG' | null;
  expiresAt?: string | null;
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

/** Lee el archivo: .xlsx con read-excel-file; CSV en UTF-8 o, si hace falta, en la codificación de Excel en Windows. */
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

/** Números en formato argentino o internacional: "$ 1.234,50", "1234.5", "1,5". */
export function parseNumber(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // El último separador es el decimal.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Código de barras: los números grandes de Excel se pasan a texto; la notación científica no sirve. */
export function parseBarcode(v: Cell): { code: string | null; broken: boolean } {
  if (typeof v === 'number') return v > 0 && v < 1e15 ? { code: String(Math.round(v)), broken: false } : { code: null, broken: true };
  if (typeof v !== 'string') return { code: null, broken: false };
  const s = v.trim().replace(/\s/g, '');
  if (!s) return { code: null, broken: false };
  if (/^\d+([.,]\d+)?e\+?\d+$/i.test(s)) return { code: null, broken: true };
  return { code: s.slice(0, 32), broken: false };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Fechas: celda de fecha de Excel, número de serie de Excel, "dd/mm/aaaa", "dd/mm/aa" o "aaaa-mm-dd". */
export function parseDate(v: Cell): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const [d, mo] = [Number(m[1]), Number(m[2])];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  return null;
}

const SYNONYMS: Record<ImportField, string[]> = {
  barcode: ['codigo de barras', 'cod barras', 'codigo barra', 'ean', 'barcode', 'codigo', 'cod', 'plu', 'sku'],
  name: ['nombre', 'descripcion', 'producto', 'articulo', 'detalle', 'nombre producto'],
  price: ['precio venta', 'precio de venta', 'precio final', 'pvp', 'precio', 'venta', 'precio publico'],
  cost: ['costo', 'precio costo', 'precio de costo', 'costo unitario', 'precio compra', 'compra'],
  stock: ['stock', 'cantidad', 'existencia', 'cant', 'stock actual'],
  minStock: ['stock minimo', 'minimo', 'stock min', 'punto de pedido'],
  idealStock: ['stock ideal', 'ideal', 'stock maximo', 'maximo', 'stock lleno'],
  category: ['categoria', 'rubro', 'familia', 'seccion', 'departamento'],
  supplier: ['proveedor', 'distribuidor'],
  unit: ['unidad', 'se vende por', 'unidad de venta', 'medida'],
  expiresAt: ['vencimiento', 'vto', 'fecha vencimiento', 'fecha de vencimiento', 'vence'],
};

/** Adivina qué columna es cada dato mirando los títulos (-1 = no está). */
export function guessMapping(headers: Cell[]): Mapping {
  const hs = headers.map((h) => norm(String(h ?? '')));
  const used = new Set<number>();
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, -1])) as Mapping;
  for (const field of IMPORT_FIELDS) {
    const idx = hs.findIndex((h, i) => !used.has(i) && SYNONYMS[field].includes(h));
    mapping[field] = idx;
    if (idx >= 0) used.add(idx);
  }
  // Los títulos que empiezan con un sinónimo van al dato del sinónimo más largo ("stock ideal" no es "stock").
  hs.forEach((h, i) => {
    if (used.has(i) || h === '') return;
    let best: ImportField | null = null;
    let len = 0;
    for (const f of IMPORT_FIELDS) {
      if (mapping[f] >= 0) continue;
      for (const s of SYNONYMS[f]) if (h.startsWith(s) && s.length > len) [best, len] = [f, s.length];
    }
    if (best) {
      mapping[best] = i;
      used.add(i);
    }
  });
  return mapping;
}

/** Convierte las filas de la planilla (la primera es de títulos) en filas para importar. */
export function buildRows(table: Cell[][], mapping: Mapping) {
  const rows: ImportRow[] = [];
  const brokenBarcodes: number[] = [];
  table.slice(1).forEach((cells, i) => {
    const get = (f: ImportField) => (mapping[f] >= 0 ? (cells[mapping[f]] ?? null) : null);
    const text = (f: ImportField) => {
      const v = get(f);
      return v == null || v === '' ? null : String(v).trim() || null;
    };
    const bc = parseBarcode(get('barcode'));
    if (bc.broken) brokenBarcodes.push(i + 2);
    const unitText = text('unit');
    const row: ImportRow = {
      row: i + 2,
      barcode: bc.code,
      name: text('name'),
      price: parseNumber(get('price')),
      cost: parseNumber(get('cost')),
      stock: parseNumber(get('stock')),
      minStock: parseNumber(get('minStock')),
      idealStock: parseNumber(get('idealStock')),
      category: text('category'),
      supplier: text('supplier'),
      unit: unitText ? (/kg|kilo|peso|granel/i.test(unitText) ? 'KG' : 'UNIT') : null,
      expiresAt: parseDate(get('expiresAt')),
    };
    if (row.name || row.barcode) rows.push(row);
  });
  return { rows, brokenBarcodes };
}

/** Planilla de ejemplo (CSV con ; y BOM para que Excel respete los acentos). */
export function templateCsv() {
  const lines = [
    'codigo;nombre;precio;costo;stock;stock_minimo;categoria;proveedor;unidad;vencimiento',
    '7790000000010;Puré de tomate 520g;1200;800;24;6;Almacén;Distribuidora Norte;unidad;01/03/2027',
    ';Queso cremoso;9800;7000;4,5;2;Lácteos;Lácteos del Sur;kg;',
  ];
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

/**
 * Lee un mensaje de WhatsApp o lo que se dicta en la obra ("2 vidrios de 50x70 de 4mm y un espejo de 1x1.5")
 * y saca las piezas: tipo, medidas en mm, cantidad, espesor y tipo de vidrio. Sin IA: reglas simples.
 */

export const PIECE_KINDS = ['mampara', 'box', 'espejo', 'baranda', 'dvh', 'vidrio'] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];
export type GlassType = 'templado' | 'laminado' | 'float';

export interface ParsedPiece {
  kind: PieceKind;
  /** Nombre para mostrar: "Vidrio templado 8 mm". */
  label: string;
  widthMm: number;
  heightMm: number;
  quantity: number;
  thicknessMm: number | null;
  glass: GlassType | null;
  /** Laminado: "3+3". */
  laminate: string | null;
  /** Parte del texto de donde salió. */
  source: string;
}

const KIND_LABEL: Record<PieceKind, string> = {
  mampara: 'Mampara',
  box: 'Box de ducha',
  espejo: 'Espejo',
  baranda: 'Baranda',
  dvh: 'DVH',
  vidrio: 'Vidrio',
};

const WORD_NUM: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const UNIT = String.raw`(mm|cm|mts?|metros?|m)?`;
const DIMS = new RegExp(String.raw`${NUM}\s*${UNIT}\s*(?:x|por)\s*${NUM}\s*${UNIT}(?![a-z])`, 'g');
const SPLIT_BEFORE = /\s(?:y|e)\s|[,;\n]|\.\s/;
const SPLIT_AFTER = /\s(?:y|e|mas)\s|[,;\n]|\.\s/;
const PIECE_WORDS = String.raw`(?:vidrios?|espejos?|mamparas?|box|panos?|piezas?|hojas?|barandas?|dvh|cristales?|templados?|laminados?|unidades|placas?)`;

const normalize = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[×*]/g, 'x');

const toNum = (s: string) => Number(s.replace(',', '.'));

function unitFactor(unit: string | undefined, a: number, b: number) {
  if (unit === 'mm') return 1;
  if (unit === 'cm') return 10;
  if (unit) return 1000;
  // Sin unidad: hasta 6 son metros, más de 360 son milímetros; si no, centímetros.
  const max = Math.max(a, b);
  if (max <= 6) return 1000;
  if (max > 360) return 1;
  return 10;
}

function kindOf(t: string): PieceKind | null {
  if (/mampara/.test(t)) return 'mampara';
  if (/\bbox\b/.test(t)) return 'box';
  if (/espejo/.test(t)) return 'espejo';
  if (/baranda|escalera/.test(t)) return 'baranda';
  if (/\bdvh\b|doble vidriado|termopanel/.test(t)) return 'dvh';
  if (/vidrio|cristal|templado|laminado|float|pano|hoja/.test(t)) return 'vidrio';
  return null;
}

function glassOf(t: string): { glass: GlassType | null; laminate: string | null; thicknessMm: number | null } {
  const lam = t.match(/(\d)\s*\+\s*(\d)/);
  if (lam) return { glass: 'laminado', laminate: `${lam[1]}+${lam[2]}`, thicknessMm: Number(lam[1]) + Number(lam[2]) };
  const glass: GlassType | null = /templad/.test(t) ? 'templado' : /laminad/.test(t) ? 'laminado' : /float|comun|crudo/.test(t) ? 'float' : null;
  const mm = t.match(/(\d+(?:[.,]\d+)?)\s*mm\b/) ?? t.match(/\bde\s+(\d{1,2})\b(?!\s*(?:x|por|cm|m\b|mts|metros|\d))/);
  const n = mm ? toNum(mm[1]) : null;
  return { glass, laminate: null, thicknessMm: n != null && n >= 2 && n <= 25 ? n : null };
}

function quantityOf(before: string, after: string) {
  const b = before.match(new RegExp(String.raw`\b(\d{1,3}|una?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:[a-z]+\s+){0,2}?${PIECE_WORDS}`));
  const a = after.match(/^\s*(?:x|por)\s*(\d{1,3})\b(?!\s*(?:cm|mm|m\b|mts|metros|[.,]\d))/) ?? after.match(/\b(\d{1,3})\s*(?:u\b|unidades|piezas)|\((\d{1,3})\)/);
  const raw = a ? (a[1] ?? a[2]) : b?.[1];
  if (!raw) return 1;
  const n = WORD_NUM[raw] ?? Number(raw);
  return n >= 1 && n <= 999 ? n : 1;
}

function labelOf(kind: PieceKind, g: ReturnType<typeof glassOf>) {
  const parts = [KIND_LABEL[kind]];
  if (kind === 'vidrio' && g.glass) parts.push(g.glass);
  if (g.laminate) parts.push(g.laminate);
  else if (g.thicknessMm) parts.push(`${String(g.thicknessMm).replace('.', ',')} mm`);
  return parts.join(' ');
}

export function parsePieces(text: string): ParsedPiece[] {
  const t = normalize(text);
  const matches = [...t.matchAll(DIMS)];
  const pieces: ParsedPiece[] = [];
  matches.forEach((m, i) => {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const prevEnd = i > 0 ? (matches[i - 1].index ?? 0) + matches[i - 1][0].length : 0;
    const nextStart = i < matches.length - 1 ? (matches[i + 1].index ?? t.length) : t.length;
    const before = t.slice(prevEnd, start).split(SPLIT_BEFORE).pop() ?? '';
    const after = t.slice(end, nextStart).split(SPLIT_AFTER)[0] ?? '';

    const a = toNum(m[1]);
    const b = toNum(m[3]);
    const f = unitFactor(m[2] || m[4], a, b);
    const widthMm = Math.round(a * f);
    const heightMm = Math.round(b * f);
    if (!widthMm || !heightMm) return;

    const ctx = `${before} ${after}`;
    const prev = pieces[pieces.length - 1];
    let kind = kindOf(before) ?? kindOf(after);
    let g = glassOf(ctx);
    // "2 mamparas de 120x180 y 90x180": la segunda hereda lo de la anterior.
    if (!kind && prev) {
      kind = prev.kind;
      if (!g.glass && !g.thicknessMm) g = { glass: prev.glass, laminate: prev.laminate, thicknessMm: prev.thicknessMm };
    }
    kind ??= 'vidrio';
    pieces.push({
      kind,
      label: labelOf(kind, g),
      widthMm,
      heightMm,
      quantity: quantityOf(before, after),
      thicknessMm: g.thicknessMm,
      glass: g.glass,
      laminate: g.laminate,
      source: text.slice(Math.max(0, prevEnd), Math.min(text.length, end + after.length)).trim(),
    });
  });
  return pieces;
}

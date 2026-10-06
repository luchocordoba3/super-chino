import { linesFromTemplate, type Basis, type GlassType, type ItemInput, type LineInput, type PieceKind, type Unit } from '@vidrieria/shared';
import type { CatalogItem, Template } from './types';

const DEFAULT_BASIS: Record<Unit, Basis> = { M2: 'm2', ML: 'perimetro', UNIT: 'unidad', FIXED: 'fijo' };

export function lineFromCatalog(c: CatalogItem, fixed = false): LineInput {
  return {
    catalogItemId: c.id,
    name: c.name,
    basis: fixed ? 'fijo' : DEFAULT_BASIS[c.unit],
    factor: 1,
    unitPrice: c.price,
    currency: c.currency,
    applyWaste: c.isGlass,
    unitCost: c.cost ?? null,
  };
}

/** Plantilla que mejor corresponde a un tipo de trabajo ("Mampara de baño", "vidrio roto", "box"...). */
export function templateForKind(kind: string, templates: Template[]) {
  const k = kind.toLowerCase();
  const pick = (re: RegExp) => templates.find((t) => re.test(t.name.toLowerCase()));
  if (/box/.test(k)) return pick(/box/);
  if (/mampara/.test(k)) return pick(/mampara/);
  if (/espejo/.test(k)) return pick(/espejo/);
  if (/cambio|roto|vidrio/.test(k)) return pick(/cambio/);
  if (/baranda|escalera/.test(k)) return pick(/baranda|escalera/);
  if (/dvh|doble/.test(k)) return pick(/dvh/);
  return undefined;
}

/** Una pieza leída de un mensaje o cargada en la obra. */
export interface PieceSpec {
  title: string;
  kind?: PieceKind | null;
  templateId?: string | null;
  widthMm: number;
  heightMm: number;
  quantity: number;
  thicknessMm?: number | null;
  glass?: GlassType | null;
  laminate?: string | null;
}

/** Vidrio del catálogo que coincide con lo pedido (tipo, espesor o laminado). */
export function matchGlass(catalog: CatalogItem[], p: PieceSpec) {
  if (!p.thicknessMm && !p.glass && !p.laminate) return undefined;
  return catalog.find((c) => {
    if (!c.isGlass || !c.active) return false;
    const n = c.name.toLowerCase();
    if ((p.kind === 'espejo') !== /espejo/.test(n)) return false;
    if (p.kind !== 'dvh' && /dvh/.test(n)) return false;
    if (p.glass === 'templado' && !/templad/.test(n)) return false;
    if (p.glass === 'laminado' && !/laminad/.test(n)) return false;
    if (p.glass === 'float' && /templad|laminad/.test(n)) return false;
    if (p.laminate) return n.replace(/\s/g, '').includes(p.laminate);
    return p.thicknessMm == null || c.thicknessMm == null || Number(c.thicknessMm) === p.thicknessMm;
  });
}

/** Arma el trabajo con la plantilla del tipo y, si se pidió un vidrio puntual, lo cambia por ese. */
export function itemFromSpec(p: PieceSpec, templates: Template[], catalog: CatalogItem[]): ItemInput {
  const t = (p.templateId && templates.find((x) => x.id === p.templateId)) || (p.kind ? templateForKind(p.kind, templates) : undefined);
  const lines = t ? linesFromTemplate(t.lines, catalog) : [];
  // Si no dijo el tipo de vidrio, se mantiene el de la plantilla (mampara 8 mm = templado 8 mm).
  const base = lines.find((l) => l.applyWaste)?.name.toLowerCase() ?? '';
  const inferred = /templad/.test(base) ? 'templado' : /laminad/.test(base) ? 'laminado' : /float/.test(base) ? 'float' : null;
  const asked = !!(p.thicknessMm || p.glass || p.laminate);
  const glass = asked ? matchGlass(catalog, { ...p, glass: p.glass ?? (p.laminate ? null : inferred) }) : undefined;
  if (glass) {
    const i = lines.findIndex((l) => l.applyWaste);
    const g = lineFromCatalog(glass);
    if (i >= 0) lines[i] = { ...g, basis: lines[i].basis, factor: lines[i].factor };
    else lines.unshift(g);
  }
  return { title: p.title || t?.name || 'Trabajo', widthMm: p.widthMm, heightMm: p.heightMm, quantity: Math.max(1, p.quantity), lines };
}

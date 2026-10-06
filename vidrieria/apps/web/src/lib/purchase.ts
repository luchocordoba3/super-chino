import type { Category, QuoteResult } from '@vidrieria/shared';
import { firstName, qty } from './format';
import type { CatalogItem } from './types';

export interface GlassGroup {
  name: string;
  /** m² de las piezas cortadas (sin desperdicio). */
  m2: number;
  pieces: { widthMm: number; heightMm: number; quantity: number; quote: number }[];
}

export interface PurchaseOrder {
  glass: GlassGroup[];
  others: { name: string; qty: number; unit: string }[];
}

/** Servicios y procesos (colocación, pulido, medición) los hace la vidriería: no se compran. */
const NOT_BOUGHT: Category[] = ['PROCESO', 'SERVICIO'];
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Junta los materiales de los presupuestos aceptados: vidrios por pieza cortada y el resto sumado. */
export function buildPurchase(quotes: { number: number; result: QuoteResult }[], catalog: CatalogItem[]): PurchaseOrder {
  const cat = new Map(catalog.map((c) => [c.id, c.category]));
  const glass = new Map<string, GlassGroup>();
  const others = new Map<string, { name: string; qty: number; unit: string }>();
  const categoryOf = (l: { catalogItemId?: string | null; applyWaste: boolean }): Category =>
    (l.catalogItemId && cat.get(l.catalogItemId)) || (l.applyWaste ? 'VIDRIO' : 'OTRO');
  const addOther = (name: string, q: number, unit: string) => {
    const k = `${name}|${unit}`;
    const o = others.get(k) ?? { name, qty: 0, unit };
    o.qty = r3(o.qty + q);
    others.set(k, o);
  };

  for (const { number, result } of quotes) {
    for (const it of result.items) {
      for (const l of it.lines) {
        const c = categoryOf(l);
        if (NOT_BOUGHT.includes(c)) continue;
        if (c === 'VIDRIO' && l.basis === 'm2') {
          const g = glass.get(l.name) ?? { name: l.name, m2: 0, pieces: [] };
          g.pieces.push({ widthMm: it.widthMm, heightMm: it.heightMm, quantity: it.quantity, quote: number });
          g.m2 = r3(g.m2 + (it.widthMm * it.heightMm * it.quantity) / 1e6);
          glass.set(l.name, g);
        } else addOther(l.name, l.qty, l.unit);
      }
    }
    for (const l of result.extras) if (!NOT_BOUGHT.includes(categoryOf(l))) addOther(l.name, l.qty, l.unit);
  }
  return { glass: [...glass.values()], others: [...others.values()] };
}

/** Mensaje de WhatsApp para el proveedor. */
export function purchaseMessage(o: PurchaseOrder, businessName: string, supplierName: string) {
  const out = [`¡Hola${supplierName ? ` ${firstName(supplierName)}` : ''}! Te paso un pedido de ${businessName}:`];
  if (o.glass.length) {
    out.push('', 'VIDRIOS CORTADOS A MEDIDA (ancho × alto)');
    for (const g of o.glass) {
      out.push(`• ${g.name} (${qty(g.m2)} m²):`);
      for (const p of g.pieces) out.push(`   - ${p.quantity} × ${qty(p.widthMm)} × ${qty(p.heightMm)} mm`);
    }
  }
  if (o.others.length) {
    out.push('', 'HERRAJES Y OTROS');
    for (const x of o.others) out.push(`• ${x.name}: ${qty(x.qty)} ${x.unit}`);
  }
  out.push('', '¿Me confirmás precio y cuándo lo tenés? ¡Gracias!');
  return out.join('\n');
}

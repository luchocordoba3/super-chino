/** Contenido neto de un producto: 520 g, 1,5 l, 750 ml, 6 u... */
export const CONTENT_UNITS = ['g', 'kg', 'ml', 'l', 'u'] as const;
export type ContentUnit = (typeof CONTENT_UNITS)[number];

const ALIASES: Record<string, ContentUnit> = {
  g: 'g', gr: 'g', grs: 'g', gramo: 'g', gramos: 'g',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg',
  ml: 'ml', cc: 'ml', cm3: 'ml',
  l: 'l', lt: 'l', lts: 'l', litro: 'l', litros: 'l',
  u: 'u', un: 'u', unid: 'u', unidades: 'u',
};

/** Detecta el contenido en el nombre: "Aceite de girasol 1,5L" -> { qty: 1.5, unit: 'l' }. */
export function parseContent(name: string): { qty: number; unit: ContentUnit } | null {
  const re = /(\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|grs?|gramos?|g|ml|cc|cm3|lts?|litros?|l|unid(?:ades)?|un|u)(?![a-z])/gi;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(name); m; m = re.exec(name)) last = m;
  if (!last) return null;
  const qty = Number(last[1].replace(',', '.'));
  const unit = ALIASES[last[2].toLowerCase()];
  return qty > 0 && unit ? { qty, unit } : null;
}

/**
 * Precio por unidad de medida (Res. 55/2002 y 4/2025): por kilo o litro; si el envase tiene 50 g/ml o menos,
 * cada 10 g/ml. Los productos que se venden por kilo ya tienen el precio por kilo.
 */
export function unitPrice(
  price: number,
  content: { qty: number; unit: ContentUnit } | null,
  soldBy: 'UNIT' | 'KG' = 'UNIT',
): { value: number; per: 'kg' | 'l' | '10 g' | '10 ml' | 'u' } | null {
  if (soldBy === 'KG') return { value: price, per: 'kg' };
  if (!content || content.qty <= 0 || price <= 0) return null;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  switch (content.unit) {
    case 'kg':
      return { value: r2(price / content.qty), per: 'kg' };
    case 'l':
      return { value: r2(price / content.qty), per: 'l' };
    case 'g':
      return content.qty <= 50 ? { value: r2((price / content.qty) * 10), per: '10 g' } : { value: r2((price / content.qty) * 1000), per: 'kg' };
    case 'ml':
      return content.qty <= 50 ? { value: r2((price / content.qty) * 10), per: '10 ml' } : { value: r2((price / content.qty) * 1000), per: 'l' };
    case 'u':
      return content.qty > 1 ? { value: r2(price / content.qty), per: 'u' } : null;
  }
}

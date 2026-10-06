/**
 * Peso del vidrio para la ficha del colocador: 2,5 kg por m² por cada mm de vidrio (densidad 2.500 kg/m³).
 * El espesor sale del nombre: "Templado 8 mm" = 8, "Laminado 4+4" = 8, "DVH 4/12/4" = 8 (la cámara no pesa).
 */
export function glassMm(name: string): number | null {
  const n = name.toLowerCase();
  const dvh = n.match(/(\d+(?:[.,]\d+)?)\s*\/\s*\d+\s*\/\s*(\d+(?:[.,]\d+)?)/);
  if (dvh) return Number(dvh[1].replace(',', '.')) + Number(dvh[2].replace(',', '.'));
  const lam = n.match(/(\d+)\s*\+\s*(\d+)/);
  if (lam) return Number(lam[1]) + Number(lam[2]);
  const mm = n.match(/(\d+(?:[.,]\d+)?)\s*mm/);
  return mm ? Number(mm[1].replace(',', '.')) : null;
}

/** Kilos de una pieza (sin redondear medidas). */
export function pieceWeightKg(glassName: string, widthMm: number, heightMm: number) {
  const mm = glassMm(glassName);
  if (!mm) return null;
  return Math.round(((widthMm * heightMm) / 1e6) * mm * 2.5 * 10) / 10;
}

/** A partir de esto conviene que vayan 2 personas (o con ventosas). */
export const TWO_PEOPLE_KG = 40;

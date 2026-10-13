// Stock y ofertas: reglas compartidas por la web, el pedido y el panel (sin datos, para que pese poco).
export type Estado = "sin-stock" | "a-pedido";
export type OfertaDatos = { porcentaje: number; hasta: string };

export const ESTADOS: Record<Estado, string> = { "sin-stock": "Sin stock", "a-pedido": "A pedido" };

// Fecha de hoy en Buenos Aires, como AAAA-MM-DD.
export const hoyAR = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(d);
export const fechaCorta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const redondear10 = (n: number) => Math.max(10, Math.round(n / 10) * 10);

// Precios con la oferta aplicada, o null si no hay oferta o ya venció (vale hasta el día "hasta" inclusive).
export function preciosOferta(mayorista: number, minorista: number, o: OfertaDatos | undefined | null, hoy = hoyAR()) {
  if (!o || !(o.porcentaje > 0) || !o.hasta || o.hasta < hoy) return null;
  const f = 1 - o.porcentaje / 100;
  return { mayorista: redondear10(mayorista * f), minorista: redondear10(minorista * f) };
}

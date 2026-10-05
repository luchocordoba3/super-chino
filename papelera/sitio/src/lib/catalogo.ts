import productosCrudos from "../datos/productos.json";
import negocio from "../datos/negocio.json";

export type Producto = {
  codigo: string;
  nombre: string;
  rubro: string;
  mayorista: number;
  minorista: number;
};

export type Ficha = Producto & {
  titulo: string;
  icono: string;
  medida: string;
  unidades: string;
  rubroId: string;
};

export const NEGOCIO = negocio;

export const RUBROS = [
  { id: "quimicos", nombre: "QUÍMICOS Y LIMPIEZA", corto: "Químicos", icono: "botella", ej: "Lavandina, detergente y desengrasante en bidón de 5 L" },
  { id: "articulos", nombre: "ARTÍCULOS DE LIMPIEZA", corto: "Artículos de limpieza", icono: "escoba", ej: "Escobillones, secadores, mopas, baldes y trapos" },
  { id: "bolsas", nombre: "BOLSAS", corto: "Bolsas", icono: "bolsa", ej: "Consorcio, residuos, camisetas y bobinas" },
  { id: "papel", nombre: "PAPEL HIGIÉNICO, TOALLAS Y SERVILLETAS", corto: "Papel y servilletas", icono: "rollo", ej: "Higiénico institucional, toallas intercaladas y servilletas" },
  { id: "descartables", nombre: "DESCARTABLES GASTRONÓMICOS", corto: "Descartables", icono: "vaso", ej: "Vasos, bandejas, cubiertos, envases y blondas" },
  { id: "embalaje", nombre: "EMBALAJE, PAPELES Y LIBRERÍA", corto: "Embalaje", icono: "caja", ej: "Film, cintas, papel kraft, sobres y resmas" },
] as const;

const rubroPorNombre = new Map(RUBROS.map((r) => [r.nombre as string, r]));

// Orden importa: la primera regla que coincide define el pictograma.
const REGLAS: [RegExp, string][] = [
  [/AEROSOL|\bAERO\b|MOSQUITRAP|MOBILI|LUSTRAMUEBLE/, "aerosol"],
  [/DOYPACK|REPUESTO/, "doypack"],
  [/LIMPIAVIDRIOS|WC REIN/, "gatillo"],
  [/JABON EN PAN/, "pan"],
  [/JABON EN POLVO/, "caja"],
  [/\b\d\s?X\s?5\s?KG|X\s?5\s?LTS?\b|X\s?5LT|\b5\s?(LT|LTS|LITROS)\b|SERVIDOR X 5|X 5 LT/, "bidon"],
  [/CAMISETA/, "camiseta"],
  [/BOBINA|ARRANQUE/, "bobina"],
  [/BOLSA|CONSORCIO|RESIDUO/, "bolsa"],
  [/TOALLA INTERC|INTERC/, "toalla"],
  [/PAPEL H|PAP HIG|HIGI|TOALLA ROLLO|ROLLO/, "rollo"],
  [/SERVILLETA/, "servilleta"],
  [/VASO|COPA/, "vaso"],
  [/PLATO|BANDEJA|BLONDA/, "bandeja"],
  [/CUBIERTO|CUCHARA|CUCHILLO|TENEDOR|AGITADOR|ESCARBADIENTE/, "cubiertos"],
  [/CAJA DE PIZZA|CAJA CARTON/, "caja"],
  [/ESTUCHE|ENSALADERA|ENVASE|POTE|TAPA|CONTAINER|CONO/, "estuche"],
  [/MOPA|MOPIN/, "mopa"],
  [/ESCOBILLON|ESCOBA|CEPILLO|ESCOBILLA/, "escoba"],
  [/SECADOR/, "secador"],
  [/BALDE|RECIPIENTE/, "balde"],
  [/GUANTE/, "guante"],
  [/ESPONJA|FIBRA/, "esponja"],
  [/TRAPO|REPASADOR|PAÑO|BALLERINA|REJILLA/, "trapo"],
  [/PLUMERO/, "plumero"],
  [/PALA\b/, "pala"],
  [/PALO|CABO|VENTOSA/, "palo"],
  [/CINTA/, "cinta"],
  [/FILM|FOLEX|ECOMAX|STRETCH/, "film"],
  [/RESMA/, "resma"],
  [/SOBRE|PAPEL|MANTECA|KRAFT|COFIA/, "papel"],
];

export function iconoDe(p: Producto): string {
  const n = p.nombre.toUpperCase();
  for (const [re, icono] of REGLAS) if (re.test(n)) return icono;
  return rubroPorNombre.get(p.rubro)?.icono ?? "caja";
}

const num = (s: string) => s.replace(",", ".").replace(/\.0+$/, "").replace(".", ",");

// Nombre en minúsculas prolijas, con siglas y unidades bien escritas.
export function nombreLindo(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s(/.-])([a-záéíóúñ])/g, (_m, a, b) => a + b.toUpperCase())
    .replace(/\b(X|Cc|Ml|Lt|Lts|Mm|Cm|Mts|Kg|Gr|Grs|Und|Unid|Uni|Un|U|De|Del|Con|Para|P|Y|En|A)\b/g, (m) => m.toLowerCase())
    .replace(/\b(Pp|Pet|Pvc|P\.v\.c|Wc|Fsc|Tbe|Cs|Sf|Mmm|Sh|Bn|Pl|Bca|Aa)\b/gi, (m) => m.toUpperCase())
    .replace(/\b([sc])\/([hg])\b/gi, (_m, a, b) => `${a.toUpperCase()}/${b.toUpperCase()}`)
    .replace(/^(.)/, (m) => m.toUpperCase());
}

export const PRODUCTOS: Ficha[] = (productosCrudos as Producto[]).map((p) => {
  const { medida, unidades } = medidaDe(p.nombre);
  return {
    ...p,
    titulo: nombreLindo(p.nombre),
    icono: iconoDe(p),
    medida,
    unidades,
    rubroId: rubroPorNombre.get(p.rubro)?.id ?? "otros",
  };
});

// Saca del nombre la medida principal ("5 L", "60×90", "750 cc") y la cantidad por bulto ("×50").
export function medidaDe(nombre: string): { medida: string; unidades: string } {
  let n = nombre.toUpperCase().replace(/\s+/g, " ");
  if (/RESMA/.test(n)) return { medida: /LEGAL/.test(n) ? "Oficio" : /LETTER/.test(n) ? "Carta" : "A4", unidades: "" };
  let unidades = "";
  const u = n.match(/X\s?(\d{1,4})\s?(?:UNIDADES|UNID|UNI|UND|UN|U)\b\.?/);
  if (u) { unidades = `×${u[1]}`; n = n.replace(u[0], " "); }
  else {
    const caja = n.match(/(?:CAJA|PAQUETE)\s?X\s?(\d{1,4})/);
    if (caja) { unidades = `×${caja[1]}`; n = n.replace(caja[0], " "); }
  }
  const reglas: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/(\d+(?:[.,]\d+)?)\s?(?:LTS|LT|LITROS|L)\b\.?/, (m) => `${num(m[1])} L`],
    [/(\d+)\s?(?:CC|ML)\b/, (m) => `${m[1]} cc`],
    [/(\d+(?:[.,]\d+)?)\s?(?:KG|KILO)\b/, (m) => `${num(m[1])} kg`],
    [/(\d+)\s?(?:GRS|GR)\b/, (m) => `${m[1]} g`],
    [/\b(\d{2,4}(?:[.,]\d+)?)\s?X\s?(\d{2,4}(?:[.,]\d+)?)/, (m) => `${num(m[1])}×${num(m[2])}`],
    [/(\d+)\s?MTS?\b\.?/, (m) => `${m[1]} m`],
    [/(\d+(?:[.,]\d+)?)\s?CM\b\.?/, (m) => `${num(m[1])} cm`],
    [/(\d+)\s?MM\b\.?/, (m) => `${m[1]} mm`],
    [/N[º°]\s?(\d+)/, (m) => `N.º ${m[1]}`],
  ];
  for (const [re, f] of reglas) {
    const m = n.match(re);
    if (m) return { medida: f(m), unidades };
  }
  if (!unidades) {
    const x = n.match(/\bX\s?(\d{2,4})\b/);
    if (x) return { medida: `×${x[1]}`, unidades: "" };
  }
  return { medida: unidades, unidades: "" };
}

export const porCodigo = new Map(PRODUCTOS.map((p) => [p.codigo, p]));
export const rubroDe = (p: Ficha) => RUBROS.find((r) => r.id === p.rubroId)!;

const plata = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
export const pesos = (n: number) => plata.format(n);

// Enlaces internos. En la vista previa se generan como archivos .html.
const VISTA = import.meta.env.PUBLIC_VISTA === "1";
export function ruta(p = ""): string {
  const limpio = p.replace(/^\/+|\/+$/g, "");
  if (!limpio) return VISTA ? "/index.html" : "/";
  return VISTA ? `/${limpio}.html` : `/${limpio}/`;
}
export const rutaProducto = (codigo: string) => ruta(`producto/${codigo.toLowerCase()}`);

// Datos mínimos que necesita el pedido en el navegador.
export const DATOS_PEDIDO = {
  productos: Object.fromEntries(PRODUCTOS.map((p) => [p.codigo, [p.titulo, p.mayorista, p.minorista, p.icono, p.medida]])),
  kits: negocio.kits.map((k) => ({ id: k.id, rubro: k.rubro, items: k.items })),
  minimoMayorista: negocio.minimoMayorista,
  envioSinCargoDesde: negocio.envioSinCargoDesde,
  whatsapp: negocio.whatsapp,
  nombre: negocio.nombre,
};

export function totalKit(items: (string | number)[][]) {
  const lista = items.filter(([c]) => porCodigo.has(c as string)) as [string, number][];
  const mayor = lista.reduce((s, [c, n]) => s + porCodigo.get(c)!.mayorista * n, 0);
  const suelto = lista.reduce((s, [c, n]) => s + porCodigo.get(c)!.minorista * n, 0);
  const esMayor = mayor >= negocio.minimoMayorista;
  return { lista, mayor, suelto, esMayor, total: esMayor ? mayor : suelto };
}

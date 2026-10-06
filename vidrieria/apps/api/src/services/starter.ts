import type { Category, Currency, Prisma, Unit } from '@prisma/client';
import type { Basis } from '@vidrieria/shared';
import type { SiteContent } from './site';

/**
 * Catálogo y plantillas de arranque para una vidriería nueva. Los precios son DE EJEMPLO:
 * cada vidriería los reemplaza por los suyos (o importa la lista del proveedor).
 */
type Item = [key: string, category: Category, name: string, unit: Unit, price: number, currency: Currency, thicknessMm?: number];

const ITEMS: Item[] = [
  ['float3', 'VIDRIO', 'Float incoloro 3 mm', 'M2', 18, 'USD', 3],
  ['float4', 'VIDRIO', 'Float incoloro 4 mm', 'M2', 22, 'USD', 4],
  ['float5', 'VIDRIO', 'Float incoloro 5 mm', 'M2', 28, 'USD', 5],
  ['float6', 'VIDRIO', 'Float incoloro 6 mm', 'M2', 34, 'USD', 6],
  ['temp8', 'VIDRIO', 'Templado 8 mm', 'M2', 75, 'USD', 8],
  ['temp10', 'VIDRIO', 'Templado 10 mm', 'M2', 90, 'USD', 10],
  ['temp12', 'VIDRIO', 'Templado 12 mm', 'M2', 120, 'USD', 12],
  ['lam33', 'VIDRIO', 'Laminado 3+3', 'M2', 45, 'USD', 6],
  ['lam44', 'VIDRIO', 'Laminado 4+4', 'M2', 55, 'USD', 8],
  ['lam55', 'VIDRIO', 'Laminado 5+5', 'M2', 65, 'USD', 10],
  ['espejo4', 'VIDRIO', 'Espejo 4 mm', 'M2', 30, 'USD', 4],
  ['dvh', 'VIDRIO', 'DVH 4 / 12 / 4', 'M2', 80, 'USD', 20],
  ['pulido', 'PROCESO', 'Pulido de cantos', 'ML', 2500, 'ARS'],
  ['bisel', 'PROCESO', 'Biselado', 'ML', 6000, 'ARS'],
  ['agujero', 'PROCESO', 'Agujero o perforación', 'UNIT', 4000, 'ARS'],
  ['calado', 'PROCESO', 'Recorte o calado', 'UNIT', 8000, 'ARS'],
  ['kitMampara', 'HERRAJE', 'Kit mampara corrediza', 'UNIT', 95, 'USD'],
  ['kitBox', 'HERRAJE', 'Kit box de ducha', 'UNIT', 140, 'USD'],
  ['bisagras', 'HERRAJE', 'Bisagras vidrio-pared (par)', 'UNIT', 45, 'USD'],
  ['zocalo', 'HERRAJE', 'Zócalo de aluminio para baranda', 'ML', 70, 'USD'],
  ['pasamanos', 'HERRAJE', 'Pasamanos de acero', 'ML', 35, 'USD'],
  ['silicona', 'HERRAJE', 'Silicona (cartucho)', 'UNIT', 9000, 'ARS'],
  ['burlete', 'HERRAJE', 'Burlete', 'ML', 1500, 'ARS'],
  ['tornilleria', 'HERRAJE', 'Tornillería y tarugos', 'UNIT', 3000, 'ARS'],
  ['medicion', 'SERVICIO', 'Medición', 'FIXED', 15000, 'ARS'],
  ['colMampara', 'SERVICIO', 'Colocación de mampara', 'FIXED', 60000, 'ARS'],
  ['colBox', 'SERVICIO', 'Colocación de box de ducha', 'FIXED', 80000, 'ARS'],
  ['colEspejo', 'SERVICIO', 'Colocación de espejo', 'FIXED', 30000, 'ARS'],
  ['colVidrio', 'SERVICIO', 'Colocación de vidrio', 'FIXED', 25000, 'ARS'],
  ['colBaranda', 'SERVICIO', 'Colocación de baranda', 'ML', 40000, 'ARS'],
  ['retiro', 'SERVICIO', 'Retiro del vidrio viejo', 'FIXED', 10000, 'ARS'],
];

type TLine = [key: string, basis: Basis, factor: number];
const TEMPLATES: { name: string; description: string; w: number; h: number; lines: TLine[] }[] = [
  {
    name: 'Mampara corrediza',
    description: 'Templado 8 mm con kit corredizo y colocación',
    w: 1200,
    h: 1800,
    lines: [['temp8', 'm2', 1], ['pulido', 'perimetro', 1], ['kitMampara', 'unidad', 1], ['silicona', 'unidad', 1], ['colMampara', 'fijo', 1]],
  },
  {
    name: 'Box de ducha',
    description: 'Ancho = frente + lateral. Templado 8 mm',
    w: 1700,
    h: 1900,
    lines: [['temp8', 'm2', 1], ['pulido', 'perimetro', 1], ['kitBox', 'unidad', 1], ['agujero', 'unidad', 4], ['silicona', 'unidad', 2], ['colBox', 'fijo', 1]],
  },
  {
    name: 'Espejo a medida',
    description: 'Espejo 4 mm con cantos pulidos',
    w: 800,
    h: 1000,
    lines: [['espejo4', 'm2', 1], ['pulido', 'perimetro', 1], ['tornilleria', 'unidad', 1], ['colEspejo', 'fijo', 1]],
  },
  {
    name: 'Cambio de vidrio',
    description: 'Float 4 mm con burlete, retiro del roto y colocación',
    w: 600,
    h: 900,
    lines: [['float4', 'm2', 1], ['burlete', 'perimetro', 1], ['retiro', 'fijo', 1], ['colVidrio', 'fijo', 1]],
  },
  {
    name: 'Baranda / escalera de vidrio',
    description: 'Por tramo. Laminado 5+5 con zócalo y pasamanos',
    w: 2000,
    h: 1000,
    lines: [['lam55', 'm2', 1], ['pulido', 'perimetro', 1], ['zocalo', 'ancho', 1], ['pasamanos', 'ancho', 1], ['colBaranda', 'ancho', 1]],
  },
  {
    name: 'DVH a medida',
    description: 'Doble vidriado hermético 4 / 12 / 4',
    w: 1000,
    h: 1200,
    lines: [['dvh', 'm2', 1], ['colVidrio', 'fijo', 1]],
  },
];

export function defaultSite(name: string, zones: string): SiteContent {
  return {
    headline: 'Vidrios, mamparas y espejos a medida',
    subheadline: `Medimos, fabricamos e instalamos${zones ? ` en ${zones}` : ''}. Pedí tu presupuesto y te respondemos por WhatsApp.`,
    primaryColor: '#1d4ed8',
    accentColor: '#dc2626',
    heroImage: null,
    services: [
      { title: 'Mamparas y boxes de baño', text: 'Templado de 8 mm, corredizas o batientes, con herrajes de primera.', image: null },
      { title: 'Barandas y escaleras de vidrio', text: 'Laminado de seguridad con zócalo o pasamanos de acero.', image: null },
      { title: 'Cambio de vidrios rotos', text: 'Reponemos vidrios de ventanas, puertas y frentes, también urgencias.', image: null },
      { title: 'Espejos a medida', text: 'Con cantos pulidos o biselados, listos para colgar.', image: null },
      { title: 'Templados, laminados y DVH', text: 'Vidrio de seguridad y doble vidriado hermético para ahorrar energía.', image: null },
      { title: 'Frentes y cerramientos', text: 'Frentes vidriados de locales, cerramientos de balcón y divisiones de oficina.', image: null },
    ],
    gallery: [],
    steps: [
      { title: 'Pedís el presupuesto', text: 'Contanos qué necesitás, con medidas aproximadas y una foto si podés.' },
      { title: 'Medimos', text: 'Coordinamos una visita para tomar las medidas exactas.' },
      { title: 'Fabricamos', text: 'Cortamos, pulimos y templamos el vidrio a medida.' },
      { title: 'Instalamos', text: 'Lo colocamos y dejamos todo limpio.' },
    ],
    faqs: [],
    illustrativeImages: false,
  };
}

/** Carga catálogo y plantillas de ejemplo en una vidriería. */
export async function loadStarterKit(tx: Prisma.TransactionClient, businessId: string) {
  const ids = new Map<string, string>();
  for (const [key, category, name, unit, price, currency, thicknessMm] of ITEMS) {
    const c = await tx.catalogItem.create({
      data: { businessId, category, name, unit, price, currency, thicknessMm: thicknessMm ?? null, isGlass: category === 'VIDRIO' },
    });
    ids.set(key, c.id);
  }
  let sort = 0;
  for (const t of TEMPLATES) {
    await tx.template.create({
      data: {
        businessId,
        name: t.name,
        description: t.description,
        defaultWidthMm: t.w,
        defaultHeightMm: t.h,
        sort: sort++,
        lines: t.lines.map(([key, basis, factor]) => ({ catalogItemId: ids.get(key)!, basis, factor })),
      },
    });
  }
}

export const starterCounts = { items: ITEMS.length, templates: TEMPLATES.length };

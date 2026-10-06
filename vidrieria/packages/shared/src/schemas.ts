import { z } from 'zod';
import { BASES, CURRENCIES, UNITS } from './quote';

export const CATEGORIES = ['VIDRIO', 'HERRAJE', 'PERFIL', 'PROCESO', 'SERVICIO', 'OTRO'] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  VIDRIO: 'Vidrios y espejos',
  HERRAJE: 'Herrajes y accesorios',
  PERFIL: 'Perfiles',
  PROCESO: 'Procesos (cantos, agujeros, templado)',
  SERVICIO: 'Servicios (medición, colocación)',
  OTRO: 'Otros',
};

export const CUSTOMER_TYPES = ['PARTICULAR', 'CONSTRUCTORA', 'ARQUITECTO', 'CONSORCIO', 'VIDRIERIA', 'OTRO'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];
export const CUSTOMER_TYPE_LABEL: Record<CustomerType, string> = {
  PARTICULAR: 'Particular',
  CONSTRUCTORA: 'Constructora',
  ARQUITECTO: 'Arquitecto/a',
  CONSORCIO: 'Administración de consorcios',
  VIDRIERIA: 'Otra vidriería',
  OTRO: 'Otro',
};

/** De dónde llegó el cliente. */
export const LEAD_SOURCES = ['WEB', 'GOOGLE', 'INSTAGRAM', 'CARTEL', 'RECOMENDACION', 'WHATSAPP', 'OTRO'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  WEB: 'Web',
  GOOGLE: 'Google',
  INSTAGRAM: 'Instagram / Facebook',
  CARTEL: 'Cartel de obra',
  RECOMENDACION: 'Recomendación',
  WHATSAPP: 'WhatsApp directo',
  OTRO: 'Otro',
};

export const QUOTE_STATUSES = ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: 'Borrador',
  SENT: 'Enviado',
  VIEWED: 'Visto',
  ACCEPTED: 'Aceptado',
  REJECTED: 'Rechazado',
  EXPIRED: 'Vencido',
};

export const LEAD_STATUSES = ['NEW', 'QUOTED', 'CLOSED'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Tipos de trabajo que el visitante elige en el formulario de la web. */
export const JOB_KINDS = [
  'Mampara de baño',
  'Box de ducha',
  'Espejo',
  'Cambio de vidrio roto',
  'Baranda o escalera de vidrio',
  'Ventana o puerta de aluminio',
  'Frente vidriado',
  'Cerramiento de balcón',
  'DVH (doble vidrio)',
  'Vidrio para mueble o mesa',
  'Otro',
] as const;

const money = z.number().finite().min(0).max(1e12);
const mm = z.number().finite().min(0).max(100_000);

export const lineSchema = z.object({
  catalogItemId: z.string().nullish(),
  name: z.string().trim().min(1).max(200),
  basis: z.enum(BASES),
  factor: z.number().finite().min(0).max(100_000),
  unitPrice: money,
  currency: z.enum(CURRENCIES),
  applyWaste: z.boolean(),
  qtyOverride: z.number().finite().min(0).max(1e6).nullish(),
  priceOverride: money.nullish(),
  unitCost: money.nullish(),
});

export const itemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  widthMm: mm,
  heightMm: mm,
  quantity: z.number().int().min(1).max(10_000),
  lines: z.array(lineSchema).max(100),
  /** Zona de riesgo marcada a mano: puerta, paño bajo (menos de 80 cm del piso), techo. */
  riskZone: z.boolean().optional(),
});

export const quoteOptionSchema = z.object({
  label: z.string().trim().max(80).default(''),
  items: z.array(itemSchema).max(100),
  extras: z.array(lineSchema).max(100),
  discount: money.default(0),
});
export type QuoteOptionBody = z.infer<typeof quoteOptionSchema>;

export const quoteBodySchema = z.object({
  customerId: z.string().nullish(),
  leadId: z.string().nullish(),
  title: z.string().trim().max(200).default(''),
  notes: z.string().trim().max(4000).default(''),
  items: z.array(itemSchema).max(100),
  extras: z.array(lineSchema).max(100),
  freightKm: z.number().finite().min(0).max(10_000).default(0),
  urgent: z.boolean().default(false),
  adjustPct: z.number().finite().min(-100).max(500).default(0),
  discount: money.default(0),
  validDays: z.number().int().min(1).max(365).optional(),
  /** 2 o 3 opciones para que el cliente elija (simple / mejor / premium). Si vienen, mandan sobre items/extras/discount. */
  options: z.array(quoteOptionSchema).min(2).max(3).nullish(),
});
export type QuoteBody = z.infer<typeof quoteBodySchema>;

export const catalogItemSchema = z.object({
  category: z.enum(CATEGORIES),
  name: z.string().trim().min(1).max(200),
  thicknessMm: z.number().finite().min(0).max(200).nullish(),
  unit: z.enum(UNITS),
  price: money,
  currency: z.enum(CURRENCIES),
  cost: money.nullish(),
  stockQty: z.number().finite().min(-1e6).max(1e9).nullish(),
  stockMin: z.number().finite().min(0).max(1e9).nullish(),
  isGlass: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const templateLineSchema = z.object({ catalogItemId: z.string(), basis: z.enum(BASES), factor: z.number().finite().min(0).max(100_000) });
export const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  defaultWidthMm: mm.default(1000),
  defaultHeightMm: mm.default(1000),
  lines: z.array(templateLineSchema).max(50),
  sort: z.number().int().default(0),
});

export const customerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).default(''),
  email: z.string().trim().max(120).default(''),
  address: z.string().trim().max(200).default(''),
  type: z.enum(CUSTOMER_TYPES).default('PARTICULAR'),
  source: z.enum(LEAD_SOURCES).nullish(),
  notes: z.string().trim().max(2000).default(''),
});

export const leadPublicSchema = z.object({
  kind: z.string().trim().min(1).max(80),
  widthCm: z.number().finite().min(0).max(10_000).nullish(),
  heightCm: z.number().finite().min(0).max(10_000).nullish(),
  quantity: z.number().int().min(1).max(1000).nullish(),
  details: z.string().trim().max(2000).default(''),
  zone: z.string().trim().max(120).default(''),
  name: z.string().trim().min(1, 'Escribí tu nombre').max(120),
  phone: z.string().trim().min(6, 'Escribí un WhatsApp para responderte').max(40),
  when: z.string().trim().max(60).default(''),
  /** Origen: link de recomendación (?ref=), cartel de obra (?c=) o de dónde vino (referrer). */
  ref: z.string().trim().max(40).nullish(),
  sign: z.string().trim().max(40).nullish(),
  referrer: z.string().trim().max(300).nullish(),
  /** Campo trampa para bots: debe venir vacío. */
  website: z.string().max(0).optional(),
});

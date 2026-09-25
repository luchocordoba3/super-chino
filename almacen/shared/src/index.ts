import { z } from 'zod';

export const LANGS = ['es', 'zh'] as const;
export type Lang = (typeof LANGS)[number];

/** Permisos que el dueño le puede dar a cada empleado (el dueño los tiene todos). */
export const PERMS = ['sell', 'stock', 'prices', 'adjust', 'reports'] as const;
export type Perm = (typeof PERMS)[number];

export const PAYMENT_METHODS = ['CASH', 'DEBIT', 'CREDIT', 'QR', 'TRANSFER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Plata que sale o entra de la caja fuera de las ventas: pago a proveedor, gasto, retiro del dueño, ingreso de cambio. */
export const CASH_MOVE_KINDS = ['SUPPLIER', 'EXPENSE', 'WITHDRAWAL', 'DEPOSIT'] as const;
export type CashMoveKind = (typeof CASH_MOVE_KINDS)[number];
/** +1 si la plata entra a la caja, -1 si sale. */
export const cashMoveSign = (kind: CashMoveKind) => (kind === 'DEPOSIT' ? 1 : -1);

// ---------- Horario de cada empleado ----------

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** "08:30" -> 510 */
export const hhmmToMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
/** Semana de 7 días (0 = domingo); null = franco. Un tramo por día. */
export const WeekScheduleSchema = z
  .array(
    z
      .object({ start: HHMM, end: HHMM })
      .refine((d) => hhmmToMin(d.end) > hhmmToMin(d.start), 'end_before_start')
      .nullable(),
  )
  .length(7);
export type WeekSchedule = z.infer<typeof WeekScheduleSchema>;
/** Horario guardado -> semana válida, o null si no tiene. */
export const parseSchedule = (raw: unknown): WeekSchedule | null => {
  const r = WeekScheduleSchema.safeParse(raw);
  return r.success ? r.data : null;
};

export const StoreSettingsSchema = z.object({
  /** Días antes del vencimiento para avisar. */
  expiryAlertDays: z.number().int().min(1).max(90).default(7),
  /** Margen objetivo sobre el costo (%), usado para sugerir precios. */
  targetMargin: z.number().min(0).max(500).default(40),
  /** Redondeo de precios (ej. 10 = a los $10). 0 = sin redondeo. */
  priceRounding: z.number().min(0).max(10000).default(10),
  /** Descuento escalonado para lotes por vencer: a X días o menos, Y% de descuento. */
  offerTiers: z
    .array(z.object({ days: z.number().int().min(0).max(90), pct: z.number().int().min(1).max(90) }))
    .default([
      { days: 7, pct: 20 },
      { days: 3, pct: 35 },
      { days: 1, pct: 50 },
    ]),
  /** En los últimos N días antes de vencer se permite vender por debajo del costo. */
  offerAllowBelowCostDays: z.number().int().min(0).max(30).default(1),
  offerAutoApprove: z.boolean().default(false),
  /** Anulaciones/borrados por cajero y turno que disparan un aviso. */
  voidAlertThreshold: z.number().int().min(1).max(100).default(5),
  /** Diferencia de caja ($) que dispara un aviso. */
  cashDiffThreshold: z.number().min(0).default(500),
  /** Productos por día en el conteo sorpresa (0 = desactivado). */
  countItemsPerDay: z.number().int().min(0).max(30).default(5),
  /** Pedidos por WhatsApp: número del local (con código de país y área, ej. 5493415551234). */
  shopWhatsapp: z.string().max(20).default(''),
  /** Pedidos por WhatsApp: se ofrece envío a domicilio (si no, solo retiro). */
  shopDelivery: z.boolean().default(true),
  /** Pedidos por WhatsApp: aviso para el cliente (horarios, costo de envío...). */
  shopNote: z.string().max(200).default(''),
  /** Mesas del bar (0 = sin mesas). Se numeran del 1 en adelante. */
  tables: z.number().int().min(0).max(60).default(6),
  /** Stock en %: por debajo de este porcentaje el producto está bajo (rojo) y avisa. */
  lowStockPct: z.number().int().min(1).max(90).default(25),
  /** Diferencia de unidades en un conteo que dispara un aviso. */
  countDiffThreshold: z.number().min(0).default(1),
  /** Fotos por día que se pueden leer con IA. */
  aiDailyScanLimit: z.number().int().min(0).max(500).default(30),
  /** Minutos de tolerancia antes de avisar que alguien llegó tarde. */
  lateToleranceMin: z.number().int().min(0).max(120).default(10),
  /** Minutos después de la hora de entrada para avisar que alguien no vino. */
  absentAfterMin: z.number().int().min(10).max(240).default(30),
});
export type StoreSettings = z.infer<typeof StoreSettingsSchema>;
export const parseSettings = (raw: unknown): StoreSettings =>
  StoreSettingsSchema.parse(raw && typeof raw === 'object' ? raw : {});

// ---------- Eventos de la caja (se generan offline y se sincronizan) ----------

const Money = z.number().finite();
const base = {
  id: z.uuid(),
  userId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  cashSessionId: z.string().nullish(),
};

export const SaleItemSchema = z.object({
  productId: z.string().min(1),
  qty: z.number().positive(),
  unitPrice: Money.min(0),
  listPrice: Money.min(0),
  offerId: z.string().nullish(),
  priceOverride: z.boolean().default(false),
});
export type SaleItemInput = z.infer<typeof SaleItemSchema>;

export const PaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: Money.min(0),
  /** Referencia del cobro (ej. orden de Mercado Pago). */
  ref: z.string().max(80).optional(),
});
export type Payment = z.infer<typeof PaymentSchema>;

export const PosEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('SALE'),
    items: z.array(SaleItemSchema).min(1).max(300),
    payments: z.array(PaymentSchema).min(1).max(5),
    total: Money.min(0),
    /** Cuenta de mesa que se cobra con esta venta. */
    tabId: z.string().nullish(),
    /** Pedido por WhatsApp que se entrega y cobra con esta venta. */
    orderId: z.string().nullish(),
  }),
  /** Cuentas abiertas: se anota sin internet y se cobra al final con una venta (SALE con tabId). */
  z.object({ ...base, type: z.literal('TAB_OPEN'), tabId: z.string().min(1), label: z.string().trim().min(1).max(40), table: z.number().int().min(1).max(99).nullish() }),
  /** Cantidad total de un producto en la cuenta (0 = se saca). */
  z.object({ ...base, type: z.literal('TAB_ITEM'), tabId: z.string().min(1), productId: z.string().min(1), qty: z.number().min(0).max(1e5), unitPrice: Money.min(0) }),
  z.object({ ...base, type: z.literal('TAB_CANCEL'), tabId: z.string().min(1) }),
  /** Lo que el cliente pidió desde la carta (menú QR): el vendedor lo acepta o lo rechaza. */
  z.object({ ...base, type: z.literal('TAB_ACCEPT'), tabId: z.string().min(1), itemId: z.string().min(1) }),
  z.object({ ...base, type: z.literal('TAB_REJECT'), tabId: z.string().min(1), itemId: z.string().min(1) }),
  z.object({ ...base, type: z.literal('ITEM_REMOVED'), productId: z.string(), qty: z.number().positive(), amount: Money }),
  z.object({ ...base, type: z.literal('SALE_VOIDED'), saleId: z.string(), reason: z.string().max(200).optional() }),
  z.object({ ...base, type: z.literal('CASH_OPEN'), cashSessionId: z.string().min(1), openingAmount: Money.min(0) }),
  z.object({
    ...base,
    type: z.literal('CASH_CLOSE'),
    cashSessionId: z.string().min(1),
    countedAmount: Money.min(0),
    notes: z.string().max(500).optional(),
  }),
  /** El cliente pidió factura de una venta: se manda después de la venta (anda sin internet). */
  z.object({
    ...base,
    type: z.literal('INVOICE_REQUEST'),
    saleId: z.string().min(1),
    /** 80 = CUIT, 96 = DNI, 99 = consumidor final sin identificar. */
    docType: z.union([z.literal(80), z.literal(96), z.literal(99)]),
    /** Con o sin guiones y puntos (se guardan solo los números). */
    docNumber: z.string().trim().max(15).default('0'),
    customerName: z.string().trim().max(80).optional(),
    /** Condición del cliente: 1 = responsable inscripto, 5 = consumidor final, 6 = monotributo. */
    customerVat: z.union([z.literal(1), z.literal(5), z.literal(6)]).default(5),
  }),
  /** "Se está terminando": el empleado avisa desde la caja que queda poco de un producto. */
  z.object({ ...base, type: z.literal('SHORTAGE'), productId: z.string().min(1) }),
  /** Fichaje de entrada o salida en la PC de la caja. */
  z.object({ ...base, type: z.literal('CLOCK'), action: z.enum(['in', 'out']) }),
  z.object({
    ...base,
    type: z.literal('CASH_MOVE'),
    cashSessionId: z.string().min(1),
    kind: z.enum(CASH_MOVE_KINDS),
    amount: Money.positive(),
    reason: z.string().trim().max(200).optional(),
    supplierId: z.string().nullish(),
  }),
]);
export type PosEvent = z.infer<typeof PosEventSchema>;
export type PosEventType = PosEvent['type'];

export type SyncResult = { id: string; status: 'ok' | 'duplicate' | 'rejected'; error?: string };

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
export * from './measure';

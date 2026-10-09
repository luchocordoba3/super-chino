import { z } from 'zod';

export const LANGS = ['es', 'zh'] as const;
export type Lang = (typeof LANGS)[number];

/** Permisos que el dueño le puede dar a cada empleado (el dueño los tiene todos). */
// Los últimos cuatro son de la casa de celulares (el supermercado no los muestra).
export const PERMS = ['sell', 'stock', 'prices', 'adjust', 'reports', 'repairs', 'tradeins', 'orders', 'deliveries'] as const;
export type Perm = (typeof PERMS)[number];
export const PHONE_PERMS: readonly Perm[] = ['repairs', 'tradeins', 'orders', 'deliveries'];

export const BUSINESS_TYPES = ['SUPERMARKET', 'PHONES'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** Medios de pago que se eligen en la caja. */
export const BASIC_PAYMENT_METHODS = ['CASH', 'DEBIT', 'CREDIT', 'QR', 'TRANSFER'] as const;
/** TRADE_IN = crédito de un usado tomado; DEPOSIT = seña ya cobrada. */
export const PAYMENT_METHODS = [...BASIC_PAYMENT_METHODS, 'TRADE_IN', 'DEPOSIT'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CURRENCIES = ['ARS', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Plata que sale o entra de la caja fuera de las ventas: pago a proveedor, gasto, retiro del dueño, ingreso de cambio. */
export const CASH_MOVE_KINDS = ['SUPPLIER', 'EXPENSE', 'WITHDRAWAL', 'DEPOSIT'] as const;
/** Además: compra de un usado a un particular y rendición de un cadete (casa de celulares). */
export const ALL_CASH_MOVE_KINDS = [...CASH_MOVE_KINDS, 'PURCHASE', 'COURIER'] as const;
export type CashMoveKind = (typeof ALL_CASH_MOVE_KINDS)[number];
/** +1 si la plata entra a la caja, -1 si sale. */
export const cashMoveSign = (kind: CashMoveKind) => (kind === 'DEPOSIT' || kind === 'COURIER' ? 1 : -1);

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
  /** Diferencia de unidades en un conteo que dispara un aviso. */
  countDiffThreshold: z.number().min(0).default(1),
  /** Fotos por día que se pueden leer con IA. */
  aiDailyScanLimit: z.number().int().min(0).max(500).default(30),
  /** Minutos de tolerancia antes de avisar que alguien llegó tarde. */
  lateToleranceMin: z.number().int().min(0).max(120).default(10),
  /** Minutos después de la hora de entrada para avisar que alguien no vino. */
  absentAfterMin: z.number().int().min(10).max(240).default(30),

  // ---------- Casa de celulares ----------
  /** De dónde sale el dólar: cotización de internet (blue, oficial, MEP, tarjeta) o una propia. */
  fxSource: z.enum(['blue', 'oficial', 'bolsa', 'tarjeta', 'manual']).default('blue'),
  fxSide: z.enum(['venta', 'compra']).default('venta'),
  /** Cotización propia (si fxSource = manual) y respaldo si no hay internet. */
  fxManual: z.number().min(0).max(1e7).default(0),
  /** Pesos que se suman (o restan) a la cotización de internet. */
  fxMarkup: z.number().min(-1e5).max(1e5).default(0),
  /** Planes de cuotas con tarjeta: recargo % sobre el precio de contado. */
  cardPlans: z
    .array(z.object({ id: z.string().min(1).max(20), name: z.string().trim().min(1).max(40), installments: z.number().int().min(1).max(36), pct: z.number().min(0).max(300) }))
    .max(20)
    .default([
      { id: 'c1', name: '1 pago', installments: 1, pct: 0 },
      { id: 'c3', name: '3 cuotas', installments: 3, pct: 15 },
      { id: 'c6', name: '6 cuotas', installments: 6, pct: 30 },
      { id: 'c12', name: '12 cuotas', installments: 12, pct: 60 },
    ]),
  /** Garantía en meses (Ley 24.240: mínimo 6 para nuevos y 3 para usados). */
  warrantyNewMonths: z.number().int().min(6).max(60).default(6),
  warrantyUsedMonths: z.number().int().min(3).max(60).default(3),
  repairWarrantyDays: z.number().int().min(0).max(365).default(90),
  /** Días que dura una seña antes de liberar el equipo. */
  depositDays: z.number().int().min(1).max(60).default(3),
  /** Aviso de equipo parado en stock. */
  agingDays: z.number().int().min(7).max(365).default(60),
  repairStuckDays: z.number().int().min(1).max(60).default(5),
  repairPickupDays: z.number().int().min(1).max(180).default(15),
  /** Diferencia (en pesos) en la rendición de un cadete que dispara un aviso. */
  courierDiffThreshold: z.number().min(0).default(1000),
  /** Comisión de los vendedores (% de la venta), general y por categoría. */
  commissionPct: z.number().min(0).max(50).default(0),
  commissionByCategory: z.record(z.string(), z.number().min(0).max(50)).default({}),
  /** Tareas de seguimiento por WhatsApp después de vender (días). */
  followUpDays: z.array(z.number().int().min(1).max(365)).max(5).default([3, 30]),
  /** Ofrecer cambio de equipo a los N meses (0 = no). */
  upgradeMonths: z.number().int().min(0).max(60).default(12),
  /** Texto al pie del certificado de garantía. */
  warrantyTerms: z.string().max(1500).default(''),
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
  /** Equipo puntual (IMEI) que se vende. */
  serialItemId: z.string().nullish(),
  /** Reparación que se cobra. */
  repairOrderId: z.string().nullish(),
});
export type SaleItemInput = z.infer<typeof SaleItemSchema>;

/**
 * amount = lo que se aplica al total, siempre en pesos.
 * Pago en dólares: currency USD y fx = dólares aplicados. Cuotas: installments y el recargo cobrado aparte.
 * TRADE_IN / DEPOSIT: ref = id de la toma o de la seña.
 */
export const PaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: Money.min(0),
  currency: z.enum(CURRENCIES).optional(),
  fx: Money.min(0).optional(),
  installments: z.number().int().min(1).max(36).optional(),
  surcharge: Money.min(0).optional(),
  ref: z.string().max(60).optional(),
});
export type Payment = z.infer<typeof PaymentSchema>;

/** Cliente nuevo cargado en la caja (el id lo genera la caja). */
const NewCustomerSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).optional(),
  dni: z.string().trim().max(20).optional(),
});

export const PosEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('SALE'),
    items: z.array(SaleItemSchema).min(1).max(300),
    payments: z.array(PaymentSchema).min(1).max(6),
    total: Money.min(0),
    customerId: z.string().nullish(),
    newCustomer: NewCustomerSchema.optional(),
    /** Pesos por dólar usados. */
    rate: z.number().positive().optional(),
    /** Efectivo neto (cobrado menos vuelto) que entró a cada cajón. */
    cashArs: Money.optional(),
    cashUsd: Money.optional(),
  }),
  /** Seña cobrada en la caja (reserva un equipo, una reparación o un pedido). */
  z.object({
    ...base,
    type: z.literal('DEPOSIT_IN'),
    depositId: z.uuid(),
    customerId: z.string().nullish(),
    newCustomer: NewCustomerSchema.optional(),
    serialItemId: z.string().nullish(),
    repairOrderId: z.string().nullish(),
    orderId: z.string().nullish(),
    amount: Money.positive(),
    currency: z.enum(CURRENCIES).default('ARS'),
    fx: Money.positive().optional(),
    method: z.enum(BASIC_PAYMENT_METHODS),
    expiresAt: z.iso.datetime().optional(),
    note: z.string().trim().max(200).optional(),
  }),
  z.object({ ...base, type: z.literal('ITEM_REMOVED'), productId: z.string(), qty: z.number().positive(), amount: Money }),
  z.object({ ...base, type: z.literal('SALE_VOIDED'), saleId: z.string(), reason: z.string().max(200).optional() }),
  z.object({ ...base, type: z.literal('CASH_OPEN'), cashSessionId: z.string().min(1), openingAmount: Money.min(0), openingUsd: Money.min(0).optional() }),
  z.object({
    ...base,
    type: z.literal('CASH_CLOSE'),
    cashSessionId: z.string().min(1),
    countedAmount: Money.min(0),
    countedUsd: Money.min(0).optional(),
    notes: z.string().max(500).optional(),
  }),
  /** Fichaje de entrada o salida en la PC de la caja. */
  z.object({ ...base, type: z.literal('CLOCK'), action: z.enum(['in', 'out']) }),
  z.object({
    ...base,
    type: z.literal('CASH_MOVE'),
    cashSessionId: z.string().min(1),
    kind: z.enum(ALL_CASH_MOVE_KINDS),
    amount: Money.positive(),
    currency: z.enum(CURRENCIES).optional(),
    reason: z.string().trim().max(200).optional(),
    supplierId: z.string().nullish(),
    /** Toma que se paga (PURCHASE) o cadete que rinde (COURIER). */
    refId: z.string().max(60).nullish(),
  }),
]);
export type PosEvent = z.infer<typeof PosEventSchema>;
export type PosEventType = PosEvent['type'];

export type SyncResult = { id: string; status: 'ok' | 'duplicate' | 'rejected'; error?: string };

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
export * from './measure';
export * from './phones';

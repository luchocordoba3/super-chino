import { z } from 'zod';

export const LANGS = ['es', 'zh'] as const;
export type Lang = (typeof LANGS)[number];

/** Permisos que el dueño le puede dar a cada empleado (el dueño los tiene todos). */
export const PERMS = ['sell', 'stock', 'prices', 'adjust', 'reports'] as const;
export type Perm = (typeof PERMS)[number];

export const PAYMENT_METHODS = ['CASH', 'DEBIT', 'CREDIT', 'QR', 'TRANSFER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

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

export const PaymentSchema = z.object({ method: z.enum(PAYMENT_METHODS), amount: Money.min(0) });
export type Payment = z.infer<typeof PaymentSchema>;

export const PosEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('SALE'),
    items: z.array(SaleItemSchema).min(1).max(300),
    payments: z.array(PaymentSchema).min(1).max(5),
    total: Money.min(0),
  }),
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
]);
export type PosEvent = z.infer<typeof PosEventSchema>;
export type PosEventType = PosEvent['type'];

export type SyncResult = { id: string; status: 'ok' | 'duplicate' | 'rejected'; error?: string };

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
export * from './measure';

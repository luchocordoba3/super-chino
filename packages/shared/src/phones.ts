// Cuentas de la casa de celulares: dólar, cuotas, garantías, IMEI y WhatsApp.
import type { StoreSettings } from './index';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Cotización bajada de internet (dolarapi / bluelytics). */
export interface RateQuote {
  casa: string;
  compra: number;
  venta: number;
  fetchedAt: string;
}

type FxSettings = Pick<StoreSettings, 'fxSource' | 'fxSide' | 'fxManual' | 'fxMarkup'>;

/**
 * Pesos por dólar que usa el local: la cotización elegida (compra o venta) más el ajuste propio.
 * Si no hay cotización de internet se usa la propia; null = no hay ninguna cargada.
 */
export function effectiveRate(s: FxSettings, quotes: RateQuote[]): number | null {
  if (s.fxSource !== 'manual') {
    const q = quotes.find((x) => x.casa === s.fxSource);
    if (q) {
      const v = (s.fxSide === 'compra' ? q.compra : q.venta) + s.fxMarkup;
      if (v > 0) return r2(v);
    }
  }
  return s.fxManual > 0 ? r2(s.fxManual) : null;
}

/** Monto en su moneda -> pesos. */
export const toArs = (amount: number, currency: string, rate: number | null | undefined) =>
  currency === 'USD' ? r2(amount * (rate ?? 0)) : r2(amount);

/** Pesos -> dólares (para reportes). */
export const toUsd = (ars: number, rate: number | null | undefined) => (rate && rate > 0 ? r2(ars / rate) : 0);

export interface CardPlan {
  id: string;
  name: string;
  installments: number;
  pct: number;
}

/** Precio con el recargo del plan de cuotas y el valor de cada cuota. */
export function planPrice(base: number, plan: Pick<CardPlan, 'installments' | 'pct'>) {
  const total = r2(base * (1 + plan.pct / 100));
  return { total, surcharge: r2(total - base), perInstallment: r2(total / plan.installments) };
}

export type Condition = 'NEW' | 'USED' | 'REFURB';

/** Meses de garantía: la del producto o la del local, nunca menos que la ley (6 nuevo, 3 usado). */
export function warrantyMonths(s: Pick<StoreSettings, 'warrantyNewMonths' | 'warrantyUsedMonths'>, condition: Condition, productMonths?: number | null) {
  const legal = condition === 'NEW' ? 6 : 3;
  const base = productMonths ?? (condition === 'NEW' ? s.warrantyNewMonths : s.warrantyUsedMonths);
  return Math.max(legal, base);
}

/** AAAA-MM-DD + n meses (el 31/01 + 1 mes = 28 o 29/02). */
export function addMonthsYMD(ymd: string, n: number): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** IMEI de 15 dígitos con dígito verificador (Luhn) correcto. */
export function isValidImei(raw: string): boolean {
  const s = raw.replace(/\D/g, '');
  if (s.length !== 15) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(s[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Solo dígitos (para buscar IMEI escaneados con espacios o guiones). */
export const cleanImei = (raw: string) => raw.replace(/\D/g, '');

/**
 * Número de WhatsApp argentino para wa.me: 549 + código de área + número (sin 0 ni 15).
 * Acepta "011 15-2345-6789", "+54 9 11 2345 6789" o "1123456789".
 */
export function waNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('54')) {
    d = d.slice(2);
    if (d.startsWith('9')) d = d.slice(1);
  }
  if (d.startsWith('0')) d = d.slice(1);
  // "11 15 2345 6789" -> el 15 después del código de área sobra (áreas de 2 a 4 dígitos).
  if (d.length === 12) {
    for (const len of [2, 3, 4]) {
      if (d.slice(len, len + 2) === '15') {
        d = d.slice(0, len) + d.slice(len + 2);
        break;
      }
    }
  }
  if (d.length !== 10) return raw.replace(/\D/g, '') || null;
  return `549${d}`;
}

/** Link para abrir WhatsApp con el mensaje ya escrito (la persona solo aprieta enviar). */
export function waLink(phone: string | null | undefined, text: string): string {
  const n = waNumber(phone);
  return `https://wa.me/${n ?? ''}?text=${encodeURIComponent(text)}`;
}

/** Puntos del checklist de un usado (toma) y del ingreso a reparación. */
export const DEVICE_CHECKS = ['screen', 'touch', 'faceId', 'cameras', 'speaker', 'mic', 'buttons', 'charging', 'wifi', 'signal', 'housing', 'originalParts'] as const;
export type DeviceCheck = (typeof DEVICE_CHECKS)[number];
export const DEVICE_CHECK_LABELS: Record<DeviceCheck, string> = {
  screen: 'Pantalla sin rayas ni manchas',
  touch: 'Táctil responde en toda la pantalla',
  faceId: 'Face ID / huella',
  cameras: 'Cámaras (frontal y trasera)',
  speaker: 'Parlante y auricular',
  mic: 'Micrófono',
  buttons: 'Botones (volumen, encendido)',
  charging: 'Carga por cable',
  wifi: 'Wi-Fi y Bluetooth',
  signal: 'Señal / chip',
  housing: 'Carcasa sin golpes',
  originalParts: 'Repuestos originales (sin avisos de pieza desconocida)',
};

export const REPAIR_STATUSES = ['RECEIVED', 'DIAGNOSIS', 'QUOTE_SENT', 'APPROVED', 'REJECTED', 'WAITING_PART', 'IN_REPAIR', 'READY', 'DELIVERED', 'CANCELLED'] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];
export const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  RECEIVED: 'Recibido',
  DIAGNOSIS: 'En diagnóstico',
  QUOTE_SENT: 'Presupuesto enviado',
  APPROVED: 'Presupuesto aprobado',
  REJECTED: 'Presupuesto rechazado',
  WAITING_PART: 'Esperando repuesto',
  IN_REPAIR: 'En reparación',
  READY: 'Listo para retirar',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
};

export const ORDER_STATUSES = ['INQUIRY', 'RESERVED', 'PAID', 'PREPARING', 'ASSIGNED', 'ON_THE_WAY', 'DELIVERED', 'FAILED', 'RETURNED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  INQUIRY: 'Consulta',
  RESERVED: 'Reservado',
  PAID: 'Pagado',
  PREPARING: 'Preparando',
  ASSIGNED: 'Asignado a cadete',
  ON_THE_WAY: 'En camino',
  DELIVERED: 'Entregado',
  FAILED: 'No se pudo entregar',
  RETURNED: 'Devuelto',
  CANCELLED: 'Cancelado',
};
export const ORDER_CHANNELS = ['WHATSAPP', 'INSTAGRAM', 'LOCAL', 'OTHER'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];
export const ORDER_CHANNEL_LABELS: Record<OrderChannel, string> = { WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram', LOCAL: 'En el local', OTHER: 'Otro' };

export const SERIAL_STATUS_LABELS = {
  AVAILABLE: 'Disponible',
  RESERVED: 'Reservado',
  IN_REPAIR: 'En reparación',
  SOLD: 'Vendido',
  RMA: 'Garantía con proveedor',
  SCRAPPED: 'Baja',
} as const;
export type SerialStatus = keyof typeof SERIAL_STATUS_LABELS;
export const CONDITION_LABELS: Record<Condition, string> = { NEW: 'Nuevo', USED: 'Usado', REFURB: 'Reacondicionado' };

/** Rango de antigüedad en stock: 0–30, 31–60, 61–90, +90 días. */
export function agingBucket(days: number): '0-30' | '31-60' | '61-90' | '90+' {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

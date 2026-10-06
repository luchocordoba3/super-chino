/** Plata: monotributo, medios de pago y cuotas. */

/**
 * Topes anuales del monotributo vigentes desde agosto 2026 (actualización del 16,8 %, hasta enero 2027).
 * Fuente: https://www.iprofesional.com/impuestos/461293-monotributo-asi-quedan-las-escalas-topes-e-importes-a-pagar-desde-agosto-2026
 */
export const MONOTRIBUTO_CAPS: Record<string, number> = {
  A: 12_009_410.45,
  B: 17_595_182.74,
  C: 24_670_494.31,
  D: 30_628_651.43,
  E: 36_028_231.33,
  F: 45_151_659.41,
  G: 53_995_798.87,
  H: 81_924_660.37,
  I: 91_699_761.9,
  J: 105_012_519.2,
  K: 126_610_838.75,
};

export const PAY_METHODS = ['EFECTIVO', 'TRANSFERENCIA', 'MERCADOPAGO', 'DEBITO', 'CREDITO', 'CHEQUE', 'ECHEQ', 'OTRO'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  MERCADOPAGO: 'Mercado Pago',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  CHEQUE: 'Cheque',
  ECHEQ: 'Echeq',
  OTRO: 'Otro',
};
/** Cobros que pasan por bancos o billeteras (ARCA los cruza con lo facturado). */
export const BANKED_METHODS: PayMethod[] = ['TRANSFERENCIA', 'MERCADOPAGO', 'DEBITO', 'CREDITO', 'ECHEQ'];

export const EXPENSE_CATEGORIES = ['ALQUILER', 'SUELDOS', 'LUZ', 'VEHICULO', 'COMBUSTIBLE', 'IMPUESTOS', 'CONTADOR', 'MANTENIMIENTO', 'MATERIAL', 'OTRO'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_LABEL: Record<ExpenseCategory, string> = {
  ALQUILER: 'Alquiler',
  SUELDOS: 'Sueldos',
  LUZ: 'Luz y servicios',
  VEHICULO: 'Vehículo (seguro, VTV, service)',
  COMBUSTIBLE: 'Combustible',
  IMPUESTOS: 'Impuestos',
  CONTADOR: 'Contador',
  MANTENIMIENTO: 'Mantenimiento de máquinas',
  MATERIAL: 'Material',
  OTRO: 'Otro',
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Lo que queda después de la comisión del medio de pago. */
export const netOf = (amount: number, feePct: number) => r2(amount * (1 - (feePct || 0) / 100));

/** Cuotas: total con recargo y valor de cada cuota. rates = {"3": 10, "6": 18}. */
export function installments(total: number, rates: Record<string, number>) {
  return Object.entries(rates)
    .map(([n, pct]) => ({ n: Number(n), pct: Number(pct) }))
    .filter((x) => x.n > 1 && Number.isFinite(x.pct))
    .sort((a, b) => a.n - b.n)
    .map(({ n, pct }) => {
      const withFee = Math.round(total * (1 + pct / 100));
      return { n, pct, total: withFee, each: Math.ceil(withFee / n) };
    });
}

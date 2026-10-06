/** Planes de Lumina: qué partes del sistema tiene cada vidriería. */

export const PLANS = ['INICIAL', 'PROFESIONAL', 'COMPLETO'] as const;
export type PlanId = (typeof PLANS)[number];

/** Partes del sistema que dependen del plan. */
export const FEATURES = [
  // Inicial
  'quotes',
  'render',
  // Profesional
  'measure',
  'deposit',
  'installments',
  'jobs',
  'materials',
  'marketing',
  'postventa',
  // Completo
  'cash',
  'numbers',
  'mercadopago',
  'arca',
  'domain',
] as const;
export type Feature = (typeof FEATURES)[number];

export interface PlanInfo {
  name: string;
  tagline: string;
  /** Pago único de alta e implementación, en dólares. */
  setupUsd: number;
  monthlyUsd: number;
  /** Fotos "así quedaría" por mes. */
  renders: number;
  features: Feature[];
}

const INICIAL: Feature[] = ['quotes', 'render'];
const PROFESIONAL: Feature[] = [...INICIAL, 'measure', 'deposit', 'installments', 'jobs', 'materials', 'marketing', 'postventa'];
const COMPLETO: Feature[] = [...PROFESIONAL, 'cash', 'numbers', 'mercadopago', 'arca', 'domain'];

export const PLAN_INFO: Record<PlanId, PlanInfo> = {
  INICIAL: { name: 'Inicial', tagline: 'Presupuestá y vendé', setupUsd: 300, monthlyUsd: 35, renders: 10, features: INICIAL },
  PROFESIONAL: { name: 'Profesional', tagline: 'Organizá la obra', setupUsd: 800, monthlyUsd: 65, renders: 40, features: PROFESIONAL },
  COMPLETO: { name: 'Completo', tagline: 'Controlá la plata', setupUsd: 1800, monthlyUsd: 99, renders: 100, features: COMPLETO },
};

export const hasFeature = (plan: PlanId | null | undefined, f: Feature) => !!plan && PLAN_INFO[plan].features.includes(f);

/** El plan más barato que incluye esa parte. */
export const minPlanFor = (f: Feature): PlanId => PLANS.find((p) => PLAN_INFO[p].features.includes(f)) ?? 'COMPLETO';

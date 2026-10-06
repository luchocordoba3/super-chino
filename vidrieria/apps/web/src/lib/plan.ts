import { PLAN_INFO, hasFeature, minPlanFor, type Feature } from '@vidrieria/shared';
import { useMe } from './me';

/** ¿El plan de la vidriería incluye esta parte? (mientras carga, sí: el servidor igual la corta). */
export function useFeature(f: Feature) {
  const me = useMe();
  return !me.data || hasFeature(me.data.business.plan ?? 'COMPLETO', f);
}

export const planNameFor = (f: Feature) => PLAN_INFO[minPlanFor(f)].name;

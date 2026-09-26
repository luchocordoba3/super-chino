import type { CheckItem, CheckRun } from '../db/types';

export const DEFAULT_CHECKS = [
  'Nivel de aceite',
  'Agua / refrigerante',
  'Presión de cubiertas',
  'Luces y balizas',
  'Frenos',
  'Limpiaparabrisas',
  'Matafuego',
  'Rueda de auxilio y crique',
  'Botiquín',
  'Papeles del auto',
  'Limpieza interior',
];

export const defaultCheckItems = (newId: () => string): CheckItem[] =>
  DEFAULT_CHECKS.map((label, order) => ({ id: newId(), label, order, enabled: true }));

/** Ítems cuyo último control dio mal y todavía no se arreglaron. */
export function pendingProblems(items: CheckItem[], runs: CheckRun[]) {
  const sorted = [...runs].sort((a, b) => b.at.localeCompare(a.at));
  const out: { item: CheckItem; run: CheckRun; note?: string }[] = [];
  for (const item of items) {
    const run = sorted.find((r) => r.results[item.id]);
    if (run && run.results[item.id] === 'mal' && !run.fixed?.includes(item.id)) out.push({ item, run, note: run.notes?.[item.id] });
  }
  return out;
}

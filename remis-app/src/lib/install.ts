import type { Settings } from '../db/types';

// Copia del código del celular y del comienzo de la prueba fuera de la base, para que "Borrar todo" no reinicie
// la prueba. También guarda un código de activación que llegó antes de configurar la app.

const KEY = 'rinde-install';
const PENDING = 'rinde-pending-code';

/** Lee la copia guardada; si se le pasan los ajustes, la actualiza. */
export function localTrial(s?: Pick<Settings, 'installId' | 'trialStart'>): { installId?: string; trialStart?: string } {
  try {
    const prev = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { installId?: string; trialStart?: string };
    if (s?.installId && s.trialStart) {
      // La prueba más vieja manda: restaurar una copia no la alarga.
      const next = { installId: s.installId, trialStart: prev.trialStart && prev.trialStart < s.trialStart ? prev.trialStart : s.trialStart };
      if (next.installId !== prev.installId || next.trialStart !== prev.trialStart) localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    }
    return prev;
  } catch {
    return {};
  }
}

export function pendingCode(set?: string | null): string | undefined {
  try {
    if (set === null) localStorage.removeItem(PENDING);
    else if (set) localStorage.setItem(PENDING, set);
    return localStorage.getItem(PENDING) ?? undefined;
  } catch {
    return undefined;
  }
}

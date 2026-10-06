import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { Me } from './types';

const KEY = 'vd_me';

function cached(): Me | undefined {
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as Me) : undefined;
  } catch {
    return undefined;
  }
}

export const forgetMe = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // sin almacenamiento
  }
};

/** Sesión actual. Arranca con la última guardada para que el panel abra sin señal (en la obra). */
export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const me = await api<Me>('/auth/me');
      try {
        localStorage.setItem(KEY, JSON.stringify(me));
      } catch {
        // sin almacenamiento: sigue andando
      }
      return me;
    },
    staleTime: 60_000,
    initialData: cached,
    initialDataUpdatedAt: 0,
  });

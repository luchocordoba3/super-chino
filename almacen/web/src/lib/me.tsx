import { createContext, useContext } from 'react';
import type { Lang, Perm, StoreSettings } from '@almacen/shared';
import { api } from '../api';

export interface Me {
  user: { id: string; name: string; username: string; email: string | null; role: 'OWNER' | 'EMPLOYEE'; perms: Perm[]; lang: Lang; hasPin: boolean };
  store: { id: string; name: string; code: string; currency: string; timezone: string; settings: StoreSettings };
  vapidPublicKey: string | null;
  aiEnabled: boolean;
}

export const meQuery = { queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false, staleTime: 60_000 };

export const MeContext = createContext<Me | null>(null);
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe fuera de sesión');
  return me;
}

export const can = (me: Me, perm: Perm | 'owner') =>
  me.user.role === 'OWNER' || (perm !== 'owner' && me.user.perms.includes(perm));

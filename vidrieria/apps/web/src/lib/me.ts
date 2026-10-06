import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { Me } from './types';

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), staleTime: 60_000 });

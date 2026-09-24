import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { Category, Supplier } from './types';

export function useDebounce<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories'), staleTime: 60_000 });
export const useSuppliers = () => useQuery({ queryKey: ['suppliers'], queryFn: () => api<Supplier[]>('/suppliers'), staleTime: 60_000 });

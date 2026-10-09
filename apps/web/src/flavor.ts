// Dos sabores del mismo código: Super Chino (supermercado) y Celu Control (casa de celulares).
export const FLAVOR: 'super' | 'celulares' = import.meta.env.VITE_FLAVOR === 'celulares' ? 'celulares' : 'super';
export const APP_NAME = FLAVOR === 'celulares' ? 'Celu Control' : 'Super Chino';
export const APP_ICON = FLAVOR === 'celulares' ? '📱' : '🛒';

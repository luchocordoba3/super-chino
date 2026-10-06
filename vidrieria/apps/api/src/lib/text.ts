/** $ 491.885 (pesos, sin decimales), para los avisos. */
export const money = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`;

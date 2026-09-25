/**
 * Cuánto pedir: si el stock está en el mínimo o no alcanza para cubrir la demora del proveedor,
 * pedir lo necesario para `coverDays` días más el mínimo.
 */
export function reorderQty(a: { stock: number; minStock: number; perDay: number; leadTimeDays: number; coverDays?: number }) {
  const cover = a.coverDays ?? 7;
  const trigger = a.stock <= a.minStock || (a.perDay > 0 && a.stock / a.perDay <= a.leadTimeDays + 1);
  if (!trigger) return 0;
  return Math.max(0, Math.ceil(a.perDay * (a.leadTimeDays + cover) + a.minStock - a.stock));
}

/** Link de WhatsApp con el pedido ya escrito. */
export const whatsappLink = (phone: string | null, text: string) =>
  `https://wa.me/${phone ? phone.replace(/\D/g, '') : ''}?text=${encodeURIComponent(text)}`;

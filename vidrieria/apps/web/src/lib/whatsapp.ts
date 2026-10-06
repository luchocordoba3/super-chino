import { waLink } from '@vidrieria/shared';
import { dayMonth, firstName, money } from './format';

export const quoteUrl = (token: string) => `${location.origin}/p/${token}`;

type MsgQuote = { number: number; title: string; total: number; deposit: number; validUntil: string; publicToken: string; customer?: { name: string } | null };

export function quoteMessage(q: MsgQuote, businessName: string, options?: { label: string; total: number }[] | null) {
  const hola = q.customer?.name ? `¡Hola ${firstName(q.customer.name)}!` : '¡Hola!';
  if (options && options.length > 1)
    return [
      `${hola} Te paso el presupuesto N° ${q.number} de ${businessName}${q.title ? `: ${q.title}` : ''}, con ${options.length} opciones:`,
      ...options.map((o) => `• ${o.label}: ${money(o.total)}`),
      `Vale hasta el ${dayMonth(q.validUntil)}.`,
      `Mirá el detalle, elegí la que más te guste y aceptala acá: ${quoteUrl(q.publicToken)}`,
    ].join('\n');
  return [
    `${hola} Te paso el presupuesto N° ${q.number} de ${businessName}${q.title ? `: ${q.title}` : ''}.`,
    `Total: ${money(q.total)} (seña: ${money(q.deposit)}).`,
    `Vale hasta el ${dayMonth(q.validUntil)}.`,
    `Mirá el detalle y aceptalo acá: ${quoteUrl(q.publicToken)}`,
  ].join('\n');
}

/** Después de pasarlo al dólar de hoy. */
export function dollarUpdateMessage(q: Omit<MsgQuote, 'deposit'>) {
  const hola = q.customer?.name ? `¡Hola ${firstName(q.customer.name)}!` : '¡Hola!';
  return [
    `${hola} Como se movió el dólar, actualizamos el presupuesto N° ${q.number}${q.title ? ` (${q.title})` : ''}.`,
    `Nuevo total: ${money(q.total)}. Vale hasta el ${dayMonth(q.validUntil)}.`,
    `Lo ves y lo aceptás acá: ${quoteUrl(q.publicToken)}`,
  ].join('\n');
}

export function followUpMessage(q: { number: number; title: string; publicToken: string; customer?: { name: string } | null }) {
  const hola = q.customer?.name ? `¡Hola ${firstName(q.customer.name)}!` : '¡Hola!';
  return `${hola} ¿Pudiste ver el presupuesto N° ${q.number}${q.title ? ` (${q.title})` : ''}? Si tenés alguna duda te ayudo. Si querés avanzar, lo aceptás acá: ${quoteUrl(q.publicToken)}`;
}

export function leadReply(l: { name: string; kind: string }, me: string, businessName: string) {
  return `¡Hola ${firstName(l.name)}! Soy ${firstName(me)} de ${businessName}. Recibimos tu consulta por ${l.kind.toLowerCase()}. ¿Te puedo hacer unas preguntas para pasarte el presupuesto?`;
}

export { waLink };

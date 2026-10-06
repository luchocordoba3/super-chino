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

type JobMsg = { address: string; scheduledAt: string | null; promisedAt?: string | null; crewToken?: string; quote: { number: number; title: string; customer: { name: string } | null } };
const hola = (name?: string | null) => (name ? `¡Hola ${firstName(name)}!` : '¡Hola!');
const when = (d: string) => `${new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric' }).format(new Date(d))} a las ${new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d))} hs`;

export const crewUrl = (token: string) => `${location.origin}/o/${token}`;
export const warrantyUrl = (token: string) => `${location.origin}/g/${token}`;

export function confirmTurnMessage(j: JobMsg) {
  return `${hola(j.quote.customer?.name)} Te confirmamos la colocación${j.quote.title ? ` de ${j.quote.title.toLowerCase()}` : ''} para el ${j.scheduledAt ? when(j.scheduledAt) : '(fecha a confirmar)'}${j.address ? ` en ${j.address}` : ''}. ¿Te queda bien?`;
}

export function onTheWayMessage(j: JobMsg) {
  return `${hola(j.quote.customer?.name)} Ya salimos para colocar ${j.quote.title ? j.quote.title.toLowerCase() : 'tu trabajo'}. Llegamos en un rato.`;
}

export function delayMessage(j: JobMsg) {
  return `${hola(j.quote.customer?.name)} Te aviso que el vidrio de tu trabajo (N° ${j.quote.number}) se está demorando en fábrica. ${j.promisedAt ? `La nueva fecha estimada es el ${dayMonth(j.promisedAt)}.` : 'Apenas lo tengamos te confirmamos el día.'} Disculpá la demora.`;
}

/** Al equipo: el trabajo con el link a su ficha. */
export function crewMessage(j: JobMsg & { crewToken: string }) {
  return [
    `Trabajo N° ${j.quote.number}${j.quote.title ? `: ${j.quote.title}` : ''}`,
    j.scheduledAt ? `Día: ${when(j.scheduledAt)}` : '',
    j.address ? `Dirección: ${j.address}` : '',
    `Ficha con medidas, pesos y checklist: ${crewUrl(j.crewToken)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

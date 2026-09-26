import type { DocType, DocumentRec, FuelType } from '../db/types';
import { addDays, addMonths, diffDays, todayKey } from './dates';

export const DOC_TYPES: Record<DocType, { label: string; months?: number; gnc?: boolean; hint?: string }> = {
  vtv: { label: 'VTV / RTO', months: 12, hint: 'Según el municipio, para remis puede ser cada 6 meses.' },
  seguro: { label: 'Seguro', months: 12, hint: 'Vencimiento de la póliza.' },
  oblea_gnc: { label: 'Oblea de GNC', months: 12, gnc: true },
  ph_gnc: { label: 'Prueba hidráulica del tubo de GNC', months: 60, gnc: true, hint: 'Cada 5 años.' },
  licencia: { label: 'Licencia de conducir profesional' },
  habilitacion: { label: 'Habilitación del remis', months: 12, hint: 'La del municipio para trabajar de remis.' },
  matafuego: { label: 'Carga del matafuego', months: 12 },
  patente: { label: 'Patente (próxima cuota)' },
  otro: { label: 'Otro papel' },
};

/** Papeles que se proponen al empezar, según el auto. */
export const defaultDocTypes = (fuels: FuelType[]): DocType[] =>
  (Object.keys(DOC_TYPES) as DocType[]).filter((t) => t !== 'otro' && (!DOC_TYPES[t].gnc || fuels.includes('gnc')));

export type DocState = 'expired' | 'soon' | 'ok' | 'unknown';

export function docStatus(doc: DocumentRec, today = todayKey()): { state: DocState; daysLeft?: number } {
  if (!doc.expires) return { state: 'unknown' };
  const daysLeft = diffDays(today, doc.expires);
  return { state: daysLeft < 0 ? 'expired' : daysLeft <= doc.warnDays ? 'soon' : 'ok', daysLeft };
}

/** Fecha sugerida al renovar: desde el vencimiento anterior o desde hoy si ya venció. */
export function suggestRenewal(doc: DocumentRec, today = todayKey()): string | undefined {
  const months = DOC_TYPES[doc.type].months;
  if (!months) return undefined;
  const from = doc.expires && doc.expires >= today ? doc.expires : today;
  return addMonths(from, months);
}

// ---- Calendario: el celular avisa aunque no abras la app ----

export interface CalEvent {
  uid: string;
  date: string;
  title: string;
  details?: string;
  /** Aviso de la app de calendario, días antes. */
  alarmDays?: number;
}

const compact = (key: string) => key.replace(/-/g, '');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Archivo .ics (iPhone, Samsung, Outlook…) con eventos de día completo y alarmas. */
export function calendarFile(events: CalEvent[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mi Remis//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const ev of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.uid}@mi-remis`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(ev.date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(ev.date, 1))}`,
      `SUMMARY:${esc(ev.title)}`,
    );
    if (ev.details) lines.push(`DESCRIPTION:${esc(ev.details)}`);
    if (ev.alarmDays) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(ev.title)}`, `TRIGGER:-P${ev.alarmDays}D`, 'END:VALARM');
    // Y otro aviso el día anterior a las 9.
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(ev.title)}`, 'TRIGGER:-PT15H', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** Link para agregar el evento en Google Calendar (Android). */
export function googleCalendarUrl(ev: CalEvent): string {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${compact(ev.date)}/${compact(addDays(ev.date, 1))}`,
    details: ev.details ?? '',
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/** Eventos de un papel: el día que vence y, si falta, un recordatorio para renovarlo antes. */
export function docEvents(doc: DocumentRec, today = todayKey()): CalEvent[] {
  if (!doc.expires) return [];
  const [y, m, d] = doc.expires.split('-');
  const out: CalEvent[] = [
    { uid: `${doc.id}-vence`, date: doc.expires, title: `Vence: ${doc.name}`, details: doc.note, alarmDays: doc.warnDays || undefined },
  ];
  const warn = addDays(doc.expires, -doc.warnDays);
  if (doc.warnDays > 0 && warn > today)
    out.push({ uid: `${doc.id}-renovar`, date: warn, title: `Renovar ${doc.name} (vence el ${d}/${m}/${y})` });
  return out;
}

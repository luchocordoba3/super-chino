import type { CheckItem, CheckRun, DocumentRec, FuelLoad, FuelType, Incident, MaintItem, ServiceLog, Shift } from '../db/types';
import { pendingProblems } from './checks';
import { diffDays, dayKey } from './dates';
import { docStatus } from './documents';
import { FUEL_LABEL, FUEL_UNIT, consumptionDrop, segments } from './fuel';
import { gapsBetweenShifts } from './km';
import { maintStatus } from './maintenance';

export interface Alert {
  id: string;
  level: 'danger' | 'warn' | 'info';
  title: string;
  detail?: string;
  to?: string;
}

export interface AlertData {
  fuels: FuelType[];
  shared: boolean;
  shifts: Shift[];
  fuel: FuelLoad[];
  items: MaintItem[];
  services: ServiceLog[];
  docs: DocumentRec[];
  checkItems: CheckItem[];
  checks: CheckRun[];
  incidents: Incident[];
  currentKm: number;
  kmRate: number | null;
  lastBackupAt?: string;
  hasData: boolean;
}

const nf = new Intl.NumberFormat('es-AR');
const nf1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
const days = (n: number) => (n === 1 ? '1 día' : `${n} días`);

export function buildAlerts(d: AlertData, now = new Date()): Alert[] {
  const today = dayKey(now);
  const out: Alert[] = [];

  for (const item of d.items.filter((i) => i.enabled)) {
    const st = maintStatus(item, d.services, d.currentKm, d.kmRate, today);
    if (st.state !== 'due' && st.state !== 'soon') continue;
    // Solo lo que hace urgente al ítem: por km, por fecha o las dos.
    const byKm = st.kmLeft != null && st.kmLeft <= item.warnKm;
    const byDate = st.daysLeft != null && st.daysLeft <= item.warnDays;
    const parts: string[] = [];
    if (byKm) parts.push(st.kmLeft! <= 0 ? `te pasaste ${nf.format(-st.kmLeft!)} km` : `faltan ${nf.format(st.kmLeft!)} km`);
    if (byDate) parts.push(st.daysLeft! <= 0 ? `venció hace ${days(-st.daysLeft!)}` : `faltan ${days(st.daysLeft!)}`);
    if (byKm && st.state === 'soon' && st.etaDays != null) parts.push(`a tu ritmo, en unos ${days(st.etaDays)}`);
    out.push({
      id: `m-${item.id}`,
      level: st.state === 'due' ? 'danger' : 'warn',
      title: st.state === 'due' ? `Toca: ${item.name}` : `Se acerca: ${item.name}`,
      detail: parts.join(' · '),
      to: '/auto/mantenimiento',
    });
  }

  for (const doc of d.docs) {
    const st = docStatus(doc, today);
    if (st.state === 'expired')
      out.push({ id: `d-${doc.id}`, level: 'danger', title: `Venció: ${doc.name}`, detail: `hace ${days(-st.daysLeft!)}`, to: '/auto/papeles' });
    else if (st.state === 'soon')
      out.push({
        id: `d-${doc.id}`,
        level: 'warn',
        title: `Por vencer: ${doc.name}`,
        detail: st.daysLeft === 0 ? 'vence hoy' : `vence en ${days(st.daysLeft!)}`,
        to: '/auto/papeles',
      });
  }

  for (const p of pendingProblems(d.checkItems, d.checks))
    out.push({ id: `c-${p.item.id}`, level: 'warn', title: `Revisar: ${p.item.label}`, detail: p.note || 'Dio mal en el checklist', to: '/auto/checklist' });

  for (const inc of d.incidents.filter((i) => !i.insurerNotified && !i.closed)) {
    const since = diffDays(dayKey(inc.at), today);
    out.push({
      id: `s-${inc.id}`,
      level: 'danger',
      title: 'Avisá al seguro del siniestro',
      detail: since < 3 ? `Tenés 3 días para hacer la denuncia (van ${days(since)})` : `Pasaron ${days(since)}: hacé la denuncia cuanto antes`,
      to: '/auto/siniestros',
    });
  }

  const breaks = d.shared ? gapsBetweenShifts(d.shifts).map((g) => g.at) : [];
  for (const f of d.fuels) {
    const drop = consumptionDrop(segments(d.fuel, f, breaks));
    if (drop)
      out.push({
        id: `f-${f}`,
        level: 'warn',
        title: `Rinde menos el ${FUEL_LABEL[f]} (${drop.dropPct}% menos)`,
        detail: `${nf1.format(drop.last)} km/${FUEL_UNIT[f]} contra ${nf1.format(drop.avg)} de promedio. Revisá presión de cubiertas, filtro de aire o pérdidas.`,
        to: '/resumen',
      });
  }

  const open = d.shifts.find((s) => !s.endAt);
  if (open && now.getTime() - new Date(open.startAt).getTime() > 16 * 3_600_000)
    out.push({ id: 'shift-open', level: 'info', title: '¿Te olvidaste de terminar el turno?', detail: 'Está abierto hace más de 16 horas.', to: '/' });

  if (d.hasData) {
    const since = d.lastBackupAt ? diffDays(dayKey(d.lastBackupAt), today) : null;
    if (since == null || since > 7)
      out.push({
        id: 'backup',
        level: 'info',
        title: 'Guardá una copia de tus datos',
        detail: since == null ? 'Todavía no hiciste ninguna. Si perdés el celular, perdés todo.' : `La última fue hace ${days(since)}.`,
        to: '/ajustes',
      });
  }

  const rank = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

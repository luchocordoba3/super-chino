import type { Loaded } from '../db/repo';
import { buildAlerts } from '../domain/alerts';
import { currentKm, kmPerDay, openShift, readings } from '../domain/km';

/** Lo que se calcula a partir de los datos: km actual, ritmo, turno abierto y avisos. */
export function derive(raw: Loaded, now: Date) {
  const rs = readings(raw);
  const km = currentKm(raw.vehicle, rs);
  const kmRate = kmPerDay(rs, now);
  const hasData = raw.shifts.length + raw.fuel.length + raw.expenses.length + raw.incomes.length > 0;
  const alerts = buildAlerts(
    { ...raw, fuels: raw.vehicle.fuels, shared: raw.vehicle.shared, currentKm: km, kmRate, lastBackupAt: raw.settings.lastBackupAt, hasData },
    now,
  );
  return { ...raw, readings: rs, km, kmRate, alerts, open: openShift(raw.shifts), now };
}

export type AppData = ReturnType<typeof derive>;

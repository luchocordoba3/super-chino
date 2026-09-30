import type { Loaded, VehicleRows } from '../db/repo';
import { buildAlerts, sortAlerts } from '../domain/alerts';
import { dayKey } from '../domain/dates';
import { currentKm, kmPerDay, openShift, readings } from '../domain/km';
import { pendingPeriod } from '../domain/settlement';

const hasRows = (r: VehicleRows) => r.shifts.length + r.fuel.length + r.expenses.length + r.incomes.length + r.settlements.length > 0;

/** Km, ritmo y avisos de un auto. */
function vehicleState(r: VehicleRows, raw: Loaded, now: Date, hasData: boolean) {
  const rs = readings(r);
  const km = currentKm(r.vehicle, rs);
  const kmRate = kmPerDay(rs, now);
  const alerts = buildAlerts(
    {
      ...r,
      checkItems: raw.checkItems,
      fuels: r.vehicle.fuels,
      shared: r.vehicle.shared,
      currentKm: km,
      kmRate,
      lastBackupAt: raw.settings.lastBackupAt,
      hasData,
      pending: pendingPeriod(r.vehicle, r.settlements, dayKey(now)),
      choferName: r.vehicle.chofer?.name,
    },
    now,
  );
  return { readings: rs, km, kmRate, alerts };
}

/** Lo que se calcula a partir de los datos: km actual, ritmo, turno abierto y avisos (de todos los autos). */
export function derive(raw: Loaded, now: Date) {
  const main = vehicleState(raw, raw, now, [raw, ...raw.others].some(hasRows));
  const others = raw.others.map((r) => ({ vehicle: r.vehicle, ...vehicleState(r, raw, now, false) }));
  const tagged = others.flatMap((o) =>
    o.alerts.map((a) => ({ ...a, id: `${o.vehicle.id}-${a.id}`, title: `${o.vehicle.plate || o.vehicle.name}: ${a.title}`, vehicleId: o.vehicle.id })),
  );
  const kmOf = new Map([[raw.vehicle.id, main.km], ...others.map((o) => [o.vehicle.id, o.km] as const)]);
  return {
    ...raw,
    readings: main.readings,
    km: main.km,
    kmRate: main.kmRate,
    alerts: sortAlerts([...main.alerts, ...tagged]),
    open: openShift(raw.shifts),
    /** Todos los autos con su km, en el orden en que se cargaron. */
    fleet: raw.vehicles.map((v) => ({ vehicle: v, km: kmOf.get(v.id) ?? v.initialKm })),
    now,
  };
}

export type AppData = ReturnType<typeof derive>;

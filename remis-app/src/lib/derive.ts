import type { Loaded, VehicleRows } from '../db/repo';
import { CONFIG, licensing } from '../config';
import { type Alert, buildAlerts, sortAlerts } from '../domain/alerts';
import { dayKey } from '../domain/dates';
import { currentKm, kmPerDay, openShift, readings } from '../domain/km';
import { type Entitlement, type LicensePayload, canWrite, entitlement } from '../domain/license';
import { monoAlerts } from '../domain/monotributo';
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

const days = (n: number) => (n === 1 ? '1 día' : `${n} días`);

function accessAlerts(e: Entitlement): Alert[] {
  if (e.state === 'trial' && e.daysLeft <= 3)
    return [{ id: 'trial', level: 'info', title: e.daysLeft === 1 ? 'Hoy es el último día de prueba' : `Te quedan ${days(e.daysLeft)} de prueba`, detail: 'Mirá los planes en Ajustes → Tu plan.', to: '/ajustes' }];
  if (e.state === 'active' && e.plan !== 'promo' && e.daysLeft <= 7)
    return [{ id: 'plan', level: 'warn', title: e.daysLeft === 1 ? 'Tu plan vence hoy' : `Tu plan vence en ${days(e.daysLeft)}`, detail: 'Renovalo para seguir anotando.', to: '/ajustes' }];
  if (e.state === 'expired')
    return [{ id: 'plan', level: 'danger', title: e.wasTrial ? 'Se terminó la prueba gratis' : 'Venció tu plan', detail: 'Podés ver todo y hacer la copia. Para anotar cosas nuevas, activá un plan.', to: '/ajustes' }];
  return [];
}

/**
 * Lo que se calcula a partir de los datos: km actual, ritmo, turno abierto, avisos (de todos los autos) y qué
 * se puede hacer con el plan. `license` es el código ya verificado (undefined mientras se verifica).
 */
export function derive(raw: Loaded, now: Date, license?: LicensePayload | null) {
  const today = dayKey(now);
  const all = [raw, ...raw.others];
  const main = vehicleState(raw, raw, now, all.some(hasRows));
  const others = raw.others.map((r) => ({ vehicle: r.vehicle, ...vehicleState(r, raw, now, false) }));
  const tagged = others.flatMap((o) =>
    o.alerts.map((a) => ({ ...a, id: `${o.vehicle.id}-${a.id}`, title: `${o.vehicle.plate || o.vehicle.name}: ${a.title}`, vehicleId: o.vehicle.id })),
  );
  const access = entitlement({
    licensing: licensing(),
    license: license ?? null,
    installId: raw.settings.installId,
    trialStart: raw.settings.trialStart,
    trialDays: CONFIG.trialDays,
    today,
  });
  const mono = raw.settings.monotributo
    ? monoAlerts(raw.settings.monotributo, { incomes: all.flatMap((r) => r.incomes), expenses: all.flatMap((r) => r.expenses), settlements: all.flatMap((r) => r.settlements) }, today)
    : [];
  const kmOf = new Map([[raw.vehicle.id, main.km], ...others.map((o) => [o.vehicle.id, o.km] as const)]);
  return {
    ...raw,
    readings: main.readings,
    km: main.km,
    kmRate: main.kmRate,
    alerts: sortAlerts([...accessAlerts(access), ...main.alerts, ...mono, ...tagged]),
    open: openShift(raw.shifts),
    /** Todos los autos con su km, en el orden en que se cargaron. */
    fleet: raw.vehicles.map((v) => ({ vehicle: v, km: kmOf.get(v.id) ?? v.initialKm })),
    access,
    /** Mientras se verifica el código no se bloquea nada. */
    writable: license === undefined || canWrite(access),
    now,
  };
}

export type AppData = ReturnType<typeof derive>;

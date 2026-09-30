import { defaultCheckItems } from '../domain/checks';
import { addDays, addMonths, dayKey, startOfWeek } from '../domain/dates';
import { DOC_TYPES, defaultDocTypes } from '../domain/documents';
import { defaultItems } from '../domain/maintenance';
import { settlePeriod } from '../domain/settlement';
import { db, newId } from './db';
import type { CheckRun, DocumentRec, Expense, FuelLevel, FuelLoad, Income, Incident, ServiceLog, Settings, Settlement, Shift, Vehicle } from './types';

/** Datos de ejemplo (6 semanas de un remis compartido y un segundo auto con chofer) para ver la app funcionando. Reemplaza todo. */
export async function loadDemo(now = new Date()) {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const int = (a: number, b: number) => Math.round(a + rnd() * (b - a));
  const at = (daysAgo: number, h: number, m = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  const today = dayKey(now);
  const thisWeek = startOfWeek(today);

  const DAYS = 42;
  const vehicleId = newId();
  const initialKm = 182_400;
  const vehicle: Vehicle = { id: vehicleId, name: 'Chevrolet Prisma', plate: 'AB 123 CD', year: 2019, fuels: ['nafta', 'gnc'], initialKm, shared: true, createdAt: at(DAYS, 5) };
  const tolls = [
    { id: newId(), name: 'Autopista', amount: 1800 },
    { id: newId(), name: 'Puente', amount: 1200 },
  ];
  const shifts: Shift[] = [];
  const fuel: FuelLoad[] = [];
  const expenses: Expense[] = [];
  const incomes: Income[] = [];
  const GNC = 790;
  const NAFTA = 1780;

  let km = initialKm;
  for (let ago = DAYS; ago >= 1; ago--) {
    const day = new Date(now);
    day.setDate(day.getDate() - ago);
    const dow = day.getDay();
    km += int(110, 190); // turno noche del otro chofer
    if (dow === 0) continue; // los domingos no trabajás
    const sm = int(0, 40);
    const driven = int(170, 260);
    const hours = int(9, 11);
    const s: Shift = {
      id: newId(),
      vehicleId,
      startAt: at(ago, 6, sm),
      startKm: km,
      startFuel: int(1, 3) as FuelLevel,
      endAt: at(ago, 6 + hours, sm + int(0, 20)),
      endKm: km + driven,
      endFuel: int(1, 3) as FuelLevel,
    };
    shifts.push(s);
    if (ago === 30 || ago === 12)
      fuel.push({ id: newId(), vehicleId, at: at(ago, 6, sm + 3), km: km + 1, fuel: 'nafta', qty: 8, total: 8 * NAFTA, full: false, station: 'YPF' });
    // GNC al arrancar y antes de entregar el auto (tanque lleno): el tramo del medio es solo tuyo.
    const q1 = Math.round((int(80, 120) / 10) * 10) / 10;
    fuel.push({ id: newId(), vehicleId, at: at(ago, 6, sm + 10), km: km + 4, fuel: 'gnc', qty: q1, total: Math.round(q1 * GNC), full: true, station: 'GNC Centro' });
    const worse = ago === 1 ? 1.35 : 1; // el último día rindió menos: la app avisa
    const q2 = Math.round(((driven - 8) / (13.5 + rnd())) * worse * 10) / 10;
    fuel.push({ id: newId(), vehicleId, at: at(ago, 5 + hours, sm + 30), km: km + driven - 4, fuel: 'gnc', qty: q2, total: Math.round(q2 * GNC), full: true, station: 'GNC Centro' });
    for (let t = int(0, 3); t > 0; t--) {
      const p = tolls[int(0, 1)];
      expenses.push({ id: newId(), vehicleId, at: at(ago, 8 + t * 2, int(0, 59)), category: 'peaje', amount: p.amount, note: p.name });
    }
    if (dow === 6) expenses.push({ id: newId(), vehicleId, at: at(ago, 15, 10), category: 'lavado', amount: 6000 });
    if (rnd() < 0.5) expenses.push({ id: newId(), vehicleId, at: at(ago, 13, 0), category: 'comida', amount: int(70, 95) * 100 });
    if (dow === 1 && dayKey(day) < thisWeek) expenses.push({ id: newId(), vehicleId, at: at(ago, 7, 0), category: 'agencia', amount: 80_000, note: 'Base semanal' });
    if (ago === 30) expenses.push({ id: newId(), vehicleId, at: at(ago, 12, 0), category: 'celular', amount: 15_000 });
    const gross = int(1050, 1650) * 100;
    incomes.push({
      id: newId(),
      vehicleId,
      at: s.endAt!,
      shiftId: s.id,
      gross,
      trips: int(12, 21),
      cash: Math.round((gross * int(35, 60)) / 100 / 100) * 100,
      tips: rnd() < 0.3 ? int(1, 4) * 1000 : 0,
      agencyFee: 0,
    });
    km += driven;
  }
  const current = km;

  // Mantenimiento: service de hace un mes y otros datos cargados a mano.
  const items = defaultItems(vehicleId, vehicle.fuels, newId);
  const item = (name: string) => items.find((i) => i.name.startsWith(name))!;
  const target = current - 9350;
  const svcShift = shifts.reduce((best, s) => (Math.abs(s.endKm! - target) < Math.abs(best.endKm! - target) ? s : best));
  const services: ServiceLog[] = [
    {
      id: newId(),
      vehicleId,
      date: dayKey(svcShift.endAt!),
      km: svcShift.endKm!,
      itemIds: [item('Aceite').id, item('Filtro de aire').id, item('Filtro de habitáculo').id],
      cost: 95_000,
      shop: 'Lubricentro El Rápido',
    },
  ];
  const base: Record<string, { km?: number; months?: number }> = {
    'Rotación de cubiertas': { km: 10_300 },
    'Alineación y balanceo': { km: 4200 },
    'Filtro de combustible': { km: 12_000 },
    'Correa de distribución': { km: 31_000, months: 24 },
    'Pastillas de freno': { km: 15_500 },
    'Líquido de frenos': { months: 16 },
    Refrigerante: { months: 20 },
    Batería: { months: 7 },
    'Service del equipo de GNC': { km: 13_200 },
  };
  for (const [name, b] of Object.entries(base)) {
    const it = item(name);
    if (b.km) it.baseKm = current - b.km;
    if (b.months) it.baseDate = addMonths(today, -b.months);
  }

  const offsets: Partial<Record<string, number>> = { vtv: 12, seguro: 150, oblea_gnc: -3, ph_gnc: 700, licencia: 400, habilitacion: 240, matafuego: 75, patente: 40 };
  const docs: DocumentRec[] = defaultDocTypes(vehicle.fuels).map((type) => ({
    id: newId(),
    vehicleId,
    type,
    name: DOC_TYPES[type].label,
    expires: offsets[type] != null ? addDays(today, offsets[type]!) : undefined,
    warnDays: 30,
  }));

  const checkItems = defaultCheckItems(newId);
  const allOk = Object.fromEntries(checkItems.map((c) => [c.id, 'ok' as const]));
  const lights = checkItems.find((c) => c.label.startsWith('Luces'))!;
  const checks: CheckRun[] = [
    { id: newId(), vehicleId, at: at(5, 6, 3), results: { ...allOk } },
    { id: newId(), vehicleId, at: at(2, 6, 5), results: { ...allOk, [lights.id]: 'mal' }, notes: { [lights.id]: 'Luz de freno izquierda quemada' } },
  ];

  const incidents: Incident[] = [
    {
      id: newId(),
      vehicleId,
      at: at(20, 14, 30),
      km: shifts.find((s) => dayKey(s.startAt) === dayKey(at(20, 12)))?.startKm,
      place: 'Estacionamiento del supermercado',
      description: 'Me rozaron el paragolpes trasero mientras estaba estacionado.',
      photos: [],
      other: { name: 'Juan Pérez', phone: '11 5555-1234', plate: 'AC 456 FG', car: 'Fiat Cronos gris', insurer: 'Seguros Ejemplo', policy: '123456' },
      claimNumber: 'S-00123',
      insurerNotified: true,
      closed: true,
    },
  ];

  // Segundo auto: lo maneja Juan al 50% y se liquida por quincena. La última quincena cerrada queda sin cargar (la app avisa).
  const car2: Vehicle = {
    id: newId(),
    name: 'Fiat Cronos',
    plate: 'AC 456 EF',
    year: 2021,
    fuels: ['nafta', 'gnc'],
    initialKm: 61_800,
    shared: false,
    createdAt: at(DAYS, 9),
    driver: 'chofer',
    chofer: { name: 'Juan', percent: 50, period: 'quincena' },
  };
  const pending = settlePeriod('quincena', addDays(settlePeriod('quincena', today).from, -1));
  const older = settlePeriod('quincena', addDays(pending.from, -1));
  const oldest = settlePeriod('quincena', addDays(older.from, -1));
  let km2 = car2.initialKm;
  const settlements: Settlement[] = [oldest, older].map((q) => {
    km2 += int(2400, 2900);
    return { id: newId(), vehicleId: car2.id, ...q, gross: int(10_500, 12_500) * 100, tolls: int(55, 85) * 1000, km: km2, percent: 50 };
  });
  const items2 = defaultItems(car2.id, car2.fuels, newId);
  const services2: ServiceLog[] = [
    {
      id: newId(),
      vehicleId: car2.id,
      date: addDays(oldest.to, -3),
      km: settlements[0].km! - 400,
      itemIds: [items2.find((i) => i.name.startsWith('Aceite'))!.id, items2.find((i) => i.name.startsWith('Filtro de aire'))!.id],
      cost: 88_000,
      shop: 'Lubricentro El Rápido',
    },
  ];
  const offsets2: Partial<Record<string, number>> = { vtv: 200, seguro: 9, oblea_gnc: 150, ph_gnc: 900, licencia: 500, habilitacion: 300, matafuego: 120, patente: 60 };
  const docs2: DocumentRec[] = defaultDocTypes(car2.fuels).map((type) => ({
    id: newId(),
    vehicleId: car2.id,
    type,
    name: DOC_TYPES[type].label,
    expires: offsets2[type] != null ? addDays(today, offsets2[type]!) : undefined,
    warnDays: 30,
  }));
  // Lo que paga el dueño: seguro y patente.
  const expenses2: Expense[] = [
    { id: newId(), vehicleId: car2.id, at: at(38, 10), category: 'seguro', amount: 68_000 },
    { id: newId(), vehicleId: car2.id, at: at(8, 10), category: 'seguro', amount: 68_000 },
    { id: newId(), vehicleId: car2.id, at: at(24, 11), category: 'patente', amount: 52_000 },
  ];

  const settings: Settings = { id: 'main', vehicleId, agency: { mode: 'fixed', amount: 80_000, period: 'week' }, tolls, theme: 'auto', lastBackupAt: at(3, 21) };

  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
    await db.vehicles.bulkAdd([vehicle, car2]);
    await db.shifts.bulkAdd(shifts);
    await db.fuel.bulkAdd(fuel);
    await db.expenses.bulkAdd([...expenses, ...expenses2]);
    await db.incomes.bulkAdd(incomes);
    await db.items.bulkAdd([...items, ...items2]);
    await db.services.bulkAdd([...services, ...services2]);
    await db.docs.bulkAdd([...docs, ...docs2]);
    await db.settlements.bulkAdd(settlements);
    await db.checkItems.bulkAdd(checkItems);
    await db.checks.bulkAdd(checks);
    await db.incidents.bulkAdd(incidents);
    await db.settings.put(settings);
  });
}

import { defaultCheckItems } from '../domain/checks';
import { defaultDocTypes, DOC_TYPES } from '../domain/documents';
import { defaultItems } from '../domain/maintenance';
import { db, newId, type TableName } from './db';
import type {
  AgencyConfig,
  CheckItem,
  CheckRun,
  DocType,
  DocumentRec,
  Expense,
  FuelLoad,
  Incident,
  Income,
  MaintItem,
  ServiceLog,
  Settings,
  Settlement,
  Shift,
  Vehicle,
} from './types';

/** Todo lo de un auto. */
export interface VehicleRows {
  vehicle: Vehicle;
  shifts: Shift[];
  fuel: FuelLoad[];
  expenses: Expense[];
  incomes: Income[];
  items: MaintItem[];
  services: ServiceLog[];
  docs: DocumentRec[];
  checks: CheckRun[];
  incidents: Incident[];
  settlements: Settlement[];
}

/** Lo del auto activo (para las pantallas), más la lista de autos y los datos de los otros (para los avisos y los totales). */
export interface Loaded extends VehicleRows {
  settings: Settings;
  checkItems: CheckItem[];
  vehicles: Vehicle[];
  others: VehicleRows[];
}

/** Tablas con registros de cada auto. */
const VEHICLE_TABLES = ['shifts', 'fuel', 'expenses', 'incomes', 'items', 'services', 'docs', 'checks', 'incidents', 'settlements'] as const;

const byCreated = (a: Vehicle, b: Vehicle) => a.createdAt.localeCompare(b.createdAt);

async function loadVehicle(vehicle: Vehicle): Promise<VehicleRows> {
  const id = vehicle.id;
  const [shifts, fuel, expenses, incomes, items, services, docs, checks, incidents, settlements] = await Promise.all([
    db.shifts.where('vehicleId').equals(id).toArray(),
    db.fuel.where('vehicleId').equals(id).toArray(),
    db.expenses.where('vehicleId').equals(id).toArray(),
    db.incomes.where('vehicleId').equals(id).toArray(),
    db.items.where('vehicleId').equals(id).toArray(),
    db.services.where('vehicleId').equals(id).toArray(),
    db.docs.where('vehicleId').equals(id).toArray(),
    db.checks.where('vehicleId').equals(id).toArray(),
    db.incidents.where('vehicleId').equals(id).toArray(),
    db.settlements.where('vehicleId').equals(id).toArray(),
  ]);
  return { vehicle, shifts, fuel, expenses, incomes, items, services, docs, checks, incidents, settlements };
}

/** Todo lo del celular, con el auto activo al frente. Null si todavía no se cargó ningún auto. */
export async function loadAll(): Promise<Loaded | null> {
  const settings = await db.settings.get('main');
  if (!settings) return null;
  const [vehicles, checkItems] = await Promise.all([db.vehicles.toArray(), db.checkItems.toArray()]);
  vehicles.sort(byCreated);
  const active = vehicles.find((v) => v.id === settings.vehicleId) ?? vehicles[0];
  if (!active) return null;
  const rows = await Promise.all(vehicles.map(loadVehicle));
  const main = rows.find((r) => r.vehicle.id === active.id)!;
  return { ...main, settings, checkItems, vehicles, others: rows.filter((r) => r !== main) };
}

export const saveSettings = (patch: Partial<Settings>) => db.settings.update('main', patch);

/** Ids de fotos que tiene un registro, sea cual sea su tipo. */
function photoIds(rec: Record<string, unknown> | undefined): string[] {
  if (!rec) return [];
  const ids: string[] = [];
  for (const k of ['photoId', 'photos', 'startPhotos', 'endPhotos']) {
    const v = rec[k];
    if (typeof v === 'string') ids.push(v);
    if (Array.isArray(v)) ids.push(...v.filter((x): x is string => typeof x === 'string'));
  }
  return ids;
}

/** Borra un registro y sus fotos. */
export async function removeRecord(table: Exclude<TableName, 'settings' | 'photos'>, id: string) {
  const t = db.table(table);
  await db.transaction('rw', t, db.photos, async () => {
    const rec = await t.get(id);
    await db.photos.bulkDelete(photoIds(rec));
    await t.delete(id);
  });
}

/** Borra las fotos que se sacaron de un registro al editarlo. */
export async function dropPhotos(before: string[], after: string[]) {
  const gone = before.filter((id) => !after.includes(id));
  if (gone.length) await db.photos.bulkDelete(gone);
}

export interface VehicleInput {
  vehicle: Omit<Vehicle, 'id' | 'createdAt'>;
  oil?: { km?: number; date?: string };
  docs: Partial<Record<DocType, string>>;
}

export interface SetupInput extends VehicleInput {
  agency: AgencyConfig;
}

/** Suma un auto con su plan de mantenimiento, sus papeles y el checklist (si no había), y lo deja como auto activo. */
export async function addVehicle(input: VehicleInput, agency?: AgencyConfig): Promise<string> {
  const vehicle: Vehicle = { ...input.vehicle, id: newId(), createdAt: new Date().toISOString() };
  const items = defaultItems(vehicle.id, vehicle.fuels, newId);
  if (input.oil && (input.oil.km != null || input.oil.date)) {
    items[0] = { ...items[0], baseKm: input.oil.km, baseDate: input.oil.date };
  }
  const docs: DocumentRec[] = defaultDocTypes(vehicle.fuels).map((type) => ({
    id: newId(),
    vehicleId: vehicle.id,
    type,
    name: DOC_TYPES[type].label,
    expires: input.docs[type] || undefined,
    warnDays: 30,
  }));
  await db.transaction('rw', [db.vehicles, db.items, db.docs, db.checkItems, db.settings], async () => {
    await db.vehicles.add(vehicle);
    await db.items.bulkAdd(items);
    await db.docs.bulkAdd(docs);
    if ((await db.checkItems.count()) === 0) await db.checkItems.bulkAdd(defaultCheckItems(newId));
    const prev = await db.settings.get('main');
    await db.settings.put({
      id: 'main',
      vehicleId: vehicle.id,
      agency: agency ?? prev?.agency ?? { mode: 'none' },
      tolls: prev?.tolls ?? [],
      theme: prev?.theme ?? 'auto',
      lastBackupAt: prev?.lastBackupAt,
    });
  });
  return vehicle.id;
}

/** Primera vez: el auto, el plan de mantenimiento, los papeles, el checklist y cómo le pagás a la agencia. */
export const setup = (input: SetupInput) => addVehicle(input, input.agency);

/** Borra un auto con todo lo suyo (fotos incluidas). Si era el activo, pasa al siguiente. */
export async function removeVehicle(id: string) {
  const tables = VEHICLE_TABLES.map((t) => db.table(t));
  await db.transaction('rw', [...tables, db.vehicles, db.photos, db.settings], async () => {
    const photos: string[] = [];
    for (const t of tables) {
      const rows = t.where('vehicleId').equals(id);
      for (const r of await rows.toArray()) photos.push(...photoIds(r));
      await rows.delete();
    }
    await db.photos.bulkDelete(photos);
    await db.vehicles.delete(id);
    const settings = await db.settings.get('main');
    const next = (await db.vehicles.toArray()).sort(byCreated)[0];
    if (settings?.vehicleId === id && next) await db.settings.update('main', { vehicleId: next.id });
  });
}

/** Borra todos los datos del celular. */
export async function wipeAll() {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
}

/** Si al auto se le agrega GNC, suma lo que le falta: papeles y service del equipo. */
export async function ensureFuelDefaults(vehicle: Vehicle) {
  if (!vehicle.fuels.includes('gnc')) return;
  const [docs, items] = await Promise.all([db.docs.where('vehicleId').equals(vehicle.id).toArray(), db.items.where('vehicleId').equals(vehicle.id).toArray()]);
  const missingDocs = (['oblea_gnc', 'ph_gnc'] as DocType[]).filter((t) => !docs.some((x) => x.type === t));
  await db.docs.bulkAdd(missingDocs.map((type) => ({ id: newId(), vehicleId: vehicle.id, type, name: DOC_TYPES[type].label, warnDays: 30 })));
  const gncItem = defaultItems(vehicle.id, vehicle.fuels, newId).find((i) => i.name.includes('GNC'));
  if (gncItem && !items.some((i) => i.name === gncItem.name)) await db.items.add({ ...gncItem, order: items.length });
}

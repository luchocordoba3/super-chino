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
  Shift,
  Vehicle,
} from './types';

export interface Loaded {
  settings: Settings;
  vehicle: Vehicle;
  shifts: Shift[];
  fuel: FuelLoad[];
  expenses: Expense[];
  incomes: Income[];
  items: MaintItem[];
  services: ServiceLog[];
  docs: DocumentRec[];
  checkItems: CheckItem[];
  checks: CheckRun[];
  incidents: Incident[];
}

/** Todo lo del auto activo, para las pantallas. Null si todavía no se cargó el auto. */
export async function loadAll(): Promise<Loaded | null> {
  const settings = await db.settings.get('main');
  if (!settings) return null;
  const vid = settings.vehicleId;
  const [vehicle, shifts, fuel, expenses, incomes, items, services, docs, checkItems, checks, incidents] = await Promise.all([
    db.vehicles.get(vid),
    db.shifts.where('vehicleId').equals(vid).toArray(),
    db.fuel.where('vehicleId').equals(vid).toArray(),
    db.expenses.where('vehicleId').equals(vid).toArray(),
    db.incomes.where('vehicleId').equals(vid).toArray(),
    db.items.where('vehicleId').equals(vid).toArray(),
    db.services.where('vehicleId').equals(vid).toArray(),
    db.docs.where('vehicleId').equals(vid).toArray(),
    db.checkItems.toArray(),
    db.checks.where('vehicleId').equals(vid).toArray(),
    db.incidents.where('vehicleId').equals(vid).toArray(),
  ]);
  if (!vehicle) return null;
  return { settings, vehicle, shifts, fuel, expenses, incomes, items, services, docs, checkItems, checks, incidents };
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

export interface SetupInput {
  vehicle: Omit<Vehicle, 'id' | 'createdAt'>;
  oil?: { km?: number; date?: string };
  agency: AgencyConfig;
  docs: Partial<Record<DocType, string>>;
}

/** Primera vez: crea el auto, el plan de mantenimiento, los papeles y el checklist. */
export async function setup(input: SetupInput): Promise<string> {
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
    await db.settings.put({ id: 'main', vehicleId: vehicle.id, agency: input.agency, tolls: prev?.tolls ?? [], theme: prev?.theme ?? 'auto', lastBackupAt: prev?.lastBackupAt });
  });
  return vehicle.id;
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

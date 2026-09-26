import Dexie, { type EntityTable } from 'dexie';
import type {
  CheckItem,
  CheckRun,
  DocumentRec,
  Expense,
  FuelLoad,
  Incident,
  Income,
  MaintItem,
  Photo,
  ServiceLog,
  Settings,
  Shift,
  Vehicle,
} from './types';

/** Todo queda en el celular (IndexedDB). No hay servidor. */
export class RemisDB extends Dexie {
  settings!: EntityTable<Settings, 'id'>;
  vehicles!: EntityTable<Vehicle, 'id'>;
  shifts!: EntityTable<Shift, 'id'>;
  fuel!: EntityTable<FuelLoad, 'id'>;
  expenses!: EntityTable<Expense, 'id'>;
  incomes!: EntityTable<Income, 'id'>;
  items!: EntityTable<MaintItem, 'id'>;
  services!: EntityTable<ServiceLog, 'id'>;
  docs!: EntityTable<DocumentRec, 'id'>;
  checkItems!: EntityTable<CheckItem, 'id'>;
  checks!: EntityTable<CheckRun, 'id'>;
  incidents!: EntityTable<Incident, 'id'>;
  photos!: EntityTable<Photo, 'id'>;

  constructor(name = 'mi-remis') {
    super(name);
    this.version(1).stores({
      settings: 'id',
      vehicles: 'id',
      shifts: 'id, vehicleId, startAt',
      fuel: 'id, vehicleId, at',
      expenses: 'id, vehicleId, at',
      incomes: 'id, vehicleId, at',
      items: 'id, vehicleId',
      services: 'id, vehicleId, date',
      docs: 'id, vehicleId',
      checkItems: 'id',
      checks: 'id, vehicleId, at',
      incidents: 'id, vehicleId, at',
      photos: 'id',
    });
  }
}

export const db = new RemisDB();

export const TABLES = [
  'settings',
  'vehicles',
  'shifts',
  'fuel',
  'expenses',
  'incomes',
  'items',
  'services',
  'docs',
  'checkItems',
  'checks',
  'incidents',
  'photos',
] as const;
export type TableName = (typeof TABLES)[number];

export const newId = () => crypto.randomUUID();

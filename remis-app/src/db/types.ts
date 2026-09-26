// Tipos de todo lo que se guarda en el celular (IndexedDB).
// Fechas con hora: ISO (`at`). Fechas solas: AAAA-MM-DD (`date`, `expires`).

export type FuelType = 'nafta' | 'gasoil' | 'gnc';
/** Nivel de combustible: 0 vacío, 1 = ¼, 2 = ½, 3 = ¾, 4 lleno. */
export type FuelLevel = 0 | 1 | 2 | 3 | 4;

export interface Vehicle {
  id: string;
  name: string;
  plate: string;
  year?: number;
  fuels: FuelType[];
  /** Km del odómetro cuando empezaste a usar la app. */
  initialKm: number;
  /** Lo manejan dos choferes (día y noche). */
  shared: boolean;
  createdAt: string;
}

export interface Shift {
  id: string;
  vehicleId: string;
  startAt: string;
  startKm: number;
  startFuel?: FuelLevel;
  startPhotos?: string[];
  startNote?: string;
  endAt?: string;
  endKm?: number;
  endFuel?: FuelLevel;
  endPhotos?: string[];
  endNote?: string;
}

export interface FuelLoad {
  id: string;
  vehicleId: string;
  at: string;
  km?: number;
  fuel: FuelType;
  /** Litros (nafta, gasoil) o m³ (GNC). */
  qty: number;
  total: number;
  /** Tanque lleno: sirve para calcular el rendimiento. */
  full: boolean;
  station?: string;
  photoId?: string;
}

export type ExpenseCategory =
  | 'peaje'
  | 'estacionamiento'
  | 'lavado'
  | 'agencia'
  | 'taller'
  | 'seguro'
  | 'patente'
  | 'tramites'
  | 'multa'
  | 'celular'
  | 'comida'
  | 'otro';

export interface Expense {
  id: string;
  vehicleId: string;
  at: string;
  category: ExpenseCategory;
  amount: number;
  note?: string;
  photoId?: string;
}

export interface Income {
  id: string;
  vehicleId: string;
  at: string;
  shiftId?: string;
  /** Lo recaudado en viajes. */
  gross: number;
  trips?: number;
  /** Parte de lo recaudado que fue en efectivo. */
  cash?: number;
  tips?: number;
  /** Comisión de la agencia (cuando cobra un porcentaje). */
  agencyFee: number;
  note?: string;
}

export interface MaintItem {
  id: string;
  vehicleId: string;
  name: string;
  everyKm?: number;
  everyMonths?: number;
  /** Última vez que se hizo, cargada a mano (los services registrados la actualizan solos). */
  baseKm?: number;
  baseDate?: string;
  warnKm: number;
  warnDays: number;
  enabled: boolean;
  order: number;
}

export interface ServiceLog {
  id: string;
  vehicleId: string;
  date: string;
  km: number;
  itemIds: string[];
  cost: number;
  shop?: string;
  note?: string;
  photoId?: string;
}

export type DocType = 'vtv' | 'seguro' | 'oblea_gnc' | 'ph_gnc' | 'licencia' | 'habilitacion' | 'matafuego' | 'patente' | 'otro';

export interface DocumentRec {
  id: string;
  vehicleId: string;
  type: DocType;
  name: string;
  expires?: string;
  warnDays: number;
  note?: string;
  photoId?: string;
}

export interface CheckItem {
  id: string;
  label: string;
  order: number;
  enabled: boolean;
}

export type CheckResult = 'ok' | 'mal';

export interface CheckRun {
  id: string;
  vehicleId: string;
  at: string;
  shiftId?: string;
  results: Record<string, CheckResult>;
  notes?: Record<string, string>;
  /** Ítems que dieron mal y después marcaste como arreglados. */
  fixed?: string[];
}

export interface OtherParty {
  name?: string;
  dni?: string;
  phone?: string;
  plate?: string;
  car?: string;
  insurer?: string;
  policy?: string;
}

export interface Incident {
  id: string;
  vehicleId: string;
  at: string;
  km?: number;
  place?: string;
  lat?: number;
  lng?: number;
  description?: string;
  photos: string[];
  other: OtherParty;
  witnesses?: string;
  policeReport?: string;
  claimNumber?: string;
  insurerNotified: boolean;
  closed: boolean;
}

export interface Photo {
  id: string;
  type: string;
  data: ArrayBuffer;
  createdAt: string;
}

export type AgencyMode = 'none' | 'fixed' | 'percent';
export type AgencyPeriod = 'day' | 'week' | 'month';

export interface AgencyConfig {
  mode: AgencyMode;
  /** Base fija: monto por período. */
  amount?: number;
  period?: AgencyPeriod;
  /** Comisión: porcentaje de lo recaudado. */
  percent?: number;
}

export interface TollPreset {
  id: string;
  name: string;
  amount: number;
}

export interface Settings {
  id: 'main';
  vehicleId: string;
  agency: AgencyConfig;
  tolls: TollPreset[];
  theme: 'auto' | 'light' | 'dark';
  lastBackupAt?: string;
}

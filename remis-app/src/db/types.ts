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
  /** Quién lo maneja. Sin dato: vos. */
  driver?: Driver;
  /** Trato con el chofer, cuando lo maneja otro. */
  chofer?: ChoferDeal;
  /** Si el auto es alquilado: cuánto y cada cuánto se paga. */
  rent?: { amount: number; period: AgencyPeriod };
}

export type Driver = 'me' | 'chofer';
export type SettlePeriod = 'quincena' | 'week' | 'month';

export interface ChoferDeal {
  name: string;
  /** Parte del chofer (%) de lo que queda después de devolverle los peajes. */
  percent: number;
  /** Cada cuánto se liquida. */
  period: SettlePeriod;
}

/** Liquidación con el chofer: lo que facturó el auto en el período y cómo se reparte. */
export interface Settlement {
  id: string;
  vehicleId: string;
  from: string;
  to: string;
  /** Lo facturado, con los peajes con pasajero incluidos (vienen sumados a la tarifa). */
  gross: number;
  /** Peajes con pasajero que pagó el chofer: se le devuelven antes de dividir. */
  tolls: number;
  /** Km del odómetro al cierre. */
  km?: number;
  /** Parte del chofer (%), copiada del trato al guardar. */
  percent: number;
  note?: string;
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
  | 'alquiler'
  | 'monotributo'
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
  /** Comisión de la agencia o de la app (cuando cobra un porcentaje). */
  agencyFee: number;
  note?: string;
  /** De qué app o agencia vino. Sin dato: agencia (los ingresos de antes). */
  platform?: PlatformId;
}

export type PlatformId = 'uber' | 'didi' | 'cabify' | 'indrive' | 'particular' | 'agencia';

export interface PlatformCfg {
  id: PlatformId;
  on: boolean;
  /** neto: lo que anotás ya viene sin la comisión (lo que la app muestra como ganancia). bruto: se descuenta el %. */
  mode: 'neto' | 'bruto';
  percent?: number;
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

export type MonoCat = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K';

export interface Settings {
  id: 'main';
  vehicleId: string;
  agency: AgencyConfig;
  tolls: TollPreset[];
  theme: 'auto' | 'light' | 'dark';
  lastBackupAt?: string;
  /** Con qué apps o agencia trabajás. Sin dato: solo agencia (como antes). */
  platforms?: PlatformCfg[];
  /** Meta de lo que querés cobrar. */
  goal?: { day?: number; week?: number };
  /** Calculadora de viajes: costo por km a mano y mínimos que querés sacar. */
  trip?: { costKm?: number; minKm?: number; minHour?: number };
  monotributo?: { cat: MonoCat; monthly: number; limit: number };
  /** Código del celular (para los códigos de activación) y comienzo de la prueba. */
  installId?: string;
  trialStart?: string;
  /** Código de activación vigente. */
  license?: string;
}

export type SalePlan = 'mes' | 'anual' | 'promo';

/** Panel del vendedor: cada código que diste. */
export interface Sale {
  id: string;
  at: string;
  /** Código del celular del cliente. Vacío en los promos para cualquiera. */
  installId?: string;
  plan: SalePlan;
  /** Desde y hasta cuándo vale (AAAA-MM-DD). */
  starts: string;
  expires: string;
  name?: string;
  phone?: string;
  amount: number;
  code: string;
}

/** La clave del vendedor (solo en el celular del vendedor). */
export interface SellerKey {
  id: 'main';
  privateJwk: JsonWebKey;
  publicKey: string;
  createdAt: string;
}

import type { Basis, Category, Currency, CustomerType, ExpenseCategory, LeadStatus, PayMethod, PlanId, QuoteInput, QuoteResult, QuoteSettings, QuoteStatus, Unit } from '@vidrieria/shared';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'PARTNER';
  active: boolean;
}

export interface Me {
  user: User;
  business: { id: string; slug: string; name: string; customDomain: string | null; plan: PlanId };
  isAdmin: boolean;
}

export interface SiteContent {
  headline: string;
  subheadline: string;
  primaryColor: string;
  accentColor: string;
  heroImage?: string | null;
  services: { title: string; text: string; image?: string | null }[];
  gallery: { image: string; caption: string }[];
  steps: { title: string; text: string }[];
  faqs: { q: string; a: string }[];
  illustrativeImages: boolean;
}

export interface DollarInfo {
  rate: number;
  source: 'MANUAL' | 'OFICIAL' | 'BLUE';
  fetchedAt: string | null;
  fallback: boolean;
}

export interface Business {
  id: string;
  slug: string;
  name: string;
  customDomain: string | null;
  whatsapp: string;
  email: string;
  address: string;
  zones: string;
  hours: string;
  instagram: string;
  logoAssetId: string | null;
  site: SiteContent;
  dollarSource: DollarInfo['source'];
  dollarManual: number;
  wastePct: number;
  depositPct: number;
  urgencyPct: number;
  freightPerKm: number;
  pricesIncludeVat: boolean;
  vatPct: number;
  roundToCm: number;
  minAreaM2: number;
  validDays: number;
  customerAdjust: Partial<Record<CustomerType, number>>;
  quoteFooter: string;
  dollarAlertPct: number;
  payAlias: string;
  payCbu: string;
  payHolder: string;
  payNote: string;
  supplierName: string;
  supplierWhatsapp: string;
  plan: PlanId;
  temperDays: number;
  glassDays: number;
  warrantyMonths: number;
  installmentRates: Record<string, number>;
  priceTestPct: number;
  payFees: Partial<Record<PayMethod, number>>;
  monotributoCategory: string;
  monotributoCap: number | null;
  arcaCuit: string;
  arcaPtoVta: number;
  arcaProduction: boolean;
  reviewUrl: string;
  referralBenefit: string;
  stormMode: boolean;
  mpConnected: boolean;
  arcaReady: boolean;
  arcaCertLoaded: boolean;
  dollar: DollarInfo;
}

export interface PublicBusiness {
  slug: string;
  name: string;
  whatsapp: string;
  email: string;
  address: string;
  zones: string;
  hours: string;
  instagram: string;
  logo: string | null;
  site: SiteContent;
}

export interface CatalogItem {
  id: string;
  category: Category;
  name: string;
  thicknessMm: number | null;
  unit: Unit;
  price: number;
  currency: Currency;
  cost: number | null;
  isGlass: boolean;
  active: boolean;
  stockQty: number | null;
  stockMin: number | null;
  updatedAt: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  defaultWidthMm: number;
  defaultHeightMm: number;
  lines: { catalogItemId: string; basis: Basis; factor: number }[];
  sort: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  type: CustomerType;
  notes: string;
  createdAt: string;
}

export interface Lead {
  id: string;
  kind: string;
  widthCm: number | null;
  heightCm: number | null;
  quantity: number | null;
  details: string;
  zone: string;
  name: string;
  phone: string;
  when: string;
  photoIds: string[];
  status: LeadStatus;
  customerId: string | null;
  createdAt: string;
  quotes: { id: string; number: number; status: QuoteStatus }[];
}

export interface QuoteListItem {
  id: string;
  number: number;
  title: string;
  status: QuoteStatus;
  total: number;
  deposit: number;
  createdAt: string;
  sentAt: string | null;
  viewedAt: string | null;
  acceptedAt: string | null;
  followUpAt: string | null;
  validUntil: string;
  publicToken: string;
  viewCount: number;
  depositReportedAt: string | null;
  depositPaidAt: string | null;
  optionCount: number;
  customer: { id: string; name: string; phone: string } | null;
}

export interface QuoteOption {
  label: string;
  input: QuoteInput;
  result: QuoteResult;
}

export interface Quote extends Omit<QuoteListItem, 'customer' | 'optionCount'> {
  notes: string;
  options: QuoteOption[] | null;
  chosenOption: number | null;
  lastViewedAt: string | null;
  depositProofId: string | null;
  purchasedAt: string | null;
  photoIds: string[];
  customerId: string | null;
  leadId: string | null;
  input: QuoteInput;
  settings: QuoteSettings;
  result: QuoteResult;
  dollarRate: number;
  customer: Customer | null;
  lead: Lead | null;
  job: { id: string; status: JobStatus } | null;
}

export interface QuoteSettingsResponse {
  settings: QuoteSettings;
  dollar: DollarInfo;
  customerAdjust: Partial<Record<CustomerType, number>>;
  validDays: number;
}

export interface Dashboard {
  newLeads: number;
  followUps: number;
  week: { count: number; total: number };
  accepted: { count: number; total: number; deposit: number };
  month: { count: number; total: number; profit: number; costedLines: number; totalLines: number; depositsPaid: number };
  depositsToConfirm: QuoteListItem[];
  dollar: { rate: number; source: DollarInfo['source']; alertPct: number };
  dollarStale: {
    id: string;
    number: number;
    title: string;
    status: QuoteStatus;
    publicToken: string;
    validUntil: string;
    customer: { id: string; name: string; phone: string } | null;
    total: number;
    newTotal: number;
    dollarRate: number;
  }[];
  toBuy: number;
  recent: QuoteListItem[];
}

export interface PurchaseQuote {
  id: string;
  number: number;
  title: string;
  acceptedAt: string;
  result: QuoteResult;
  customer: { id: string; name: string } | null;
}

export interface PublicResult {
  items: { title: string; widthMm: number; heightMm: number; quantity: number; lines: { name: string; qty: number; unit: string }[]; total: number }[];
  extras: { name: string; total: number }[];
  adjust: number;
  urgency: number;
  freight: number;
  discount: number;
  total: number;
  vat: number;
  deposit: number;
  balance: number;
}

export interface PublicQuote {
  quote: PublicResult & {
    number: number;
    title: string;
    notes: string;
    status: QuoteStatus;
    customerName: string | null;
    createdAt: string;
    validUntil: string;
    acceptedAt: string | null;
    options: (PublicResult & { label: string })[] | null;
    chosenLabel: string | null;
    pricesIncludeVat: boolean;
    depositPct: number;
    depositReportedAt: string | null;
    depositPaidAt: string | null;
    footer: string;
  };
  business: {
    name: string;
    slug: string;
    whatsapp: string;
    address: string;
    email: string;
    logo: string | null;
    primaryColor: string;
    accentColor: string;
    deposit: boolean;
    mp: boolean;
    pay: { alias: string; cbu: string; holder: string; note: string };
  };
}

export type JobStatus = 'PENDING' | 'ORDERED' | 'MAKING' | 'RECEIVED' | 'SCHEDULED' | 'INSTALLED' | 'CLOSED';

export interface Crew {
  id: string;
  name: string;
  members: string;
  dayRate: number;
  color: string;
  active: boolean;
}

export interface Job {
  id: string;
  status: JobStatus;
  address: string;
  needsFactory: boolean;
  orderedAt: string | null;
  promisedAt: string | null;
  receivedAt: string | null;
  scheduledAt: string | null;
  crewId: string | null;
  crew: Pick<Crew, 'id' | 'name' | 'color'> | null;
  arrivedAt: string | null;
  installedAt: string | null;
  closedAt: string | null;
  checklist: Record<string, boolean>;
  beforeIds: string[];
  afterIds: string[];
  installNotes: string;
  crewToken: string;
  warrantyToken: string;
  warrantyMonths: number;
  confirmSentAt: string | null;
  reviewSentAt: string | null;
  check30SentAt: string | null;
  maint6SentAt: string | null;
  maint12SentAt: string | null;
  createdAt: string;
  quote: {
    id: string;
    number: number;
    title: string;
    total: number;
    deposit: number;
    depositPaidAt: string | null;
    publicToken: string;
    acceptedAt: string | null;
    customer: { id: string; name: string; phone: string; address: string } | null;
  };
}

export interface Breakage {
  id: string;
  jobId: string | null;
  where: 'TALLER' | 'TRASLADO' | 'OBRA' | 'POSTVENTA';
  description: string;
  cost: number;
  responsible: string;
  reordered: boolean;
  createdAt: string;
  job?: { id: string; quote: { number: number; title: string } } | null;
}

export interface Remnant {
  id: string;
  catalogItemId: string | null;
  glassName: string;
  thicknessMm: number | null;
  widthMm: number;
  heightMm: number;
  photoId: string | null;
  notes: string;
  usedAt: string | null;
  usedQuoteId: string | null;
  createdAt: string;
}

export interface CrewSheet {
  business: { name: string; whatsapp: string; primaryColor: string };
  status: JobStatus;
  number: number;
  title: string;
  notes: string;
  installNotes: string;
  address: string;
  scheduledAt: string | null;
  crew: string | null;
  customer: { name: string; phone: string } | null;
  pieces: { title: string; widthMm: number; heightMm: number; quantity: number; glass: string | null; weightKg: number | null; includes: string[] }[];
  extras: string[];
  checklist: Record<string, boolean>;
  arrivedAt: string | null;
  installedAt: string | null;
  photos: { before: number; after: number };
  warrantyToken: string;
}

export interface WarrantyInfo {
  business: { name: string; slug: string; whatsapp: string; logo: string | null; primaryColor: string; accentColor: string; reviewUrl: string };
  number: number;
  title: string;
  customer: string | null;
  installedAt: string | null;
  warrantyMonths: number;
  until: string | null;
  crew: string | null;
  pieces: { title: string; widthMm: number; heightMm: number; quantity: number; glass: string | null; includes: string[] }[];
}

export interface Payment {
  id: string;
  quoteId: string | null;
  customerId: string | null;
  kind: 'SENA' | 'SALDO' | 'OTRO';
  method: PayMethod;
  amount: number;
  feePct: number;
  net: number;
  date: string;
  note: string;
  chequeBank: string | null;
  chequeNumber: string | null;
  chequeDueAt: string | null;
  chequeStatus: 'CARTERA' | 'DEPOSITADO' | 'COBRADO' | 'ENDOSADO' | 'RECHAZADO' | null;
  invoiceId: string | null;
  quote?: { id?: string; number: number; title?: string; customer: { name: string } | null } | null;
}

export interface Expense {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  date: string;
  recurring: boolean;
  jobId: string | null;
}

export interface WorkDay {
  id: string;
  crewId: string | null;
  worker: string;
  date: string;
  jobId: string | null;
  amount: number;
  advance: boolean;
  paidAt: string | null;
  crew: { name: string; color: string } | null;
  job: { quote: { number: number; title: string } } | null;
}

export interface Invoice {
  id: string;
  quoteId: string | null;
  paymentId: string | null;
  type: string;
  ptoVta: number;
  number: number;
  cae: string | null;
  caeDue: string | null;
  amount: number;
  date: string;
  customerName: string;
  manual: boolean;
}

export interface Receivable {
  customer: { id: string; name: string; phone: string; type: CustomerType } | null;
  due: number;
  oldest: string | null;
  quotes: { id: string; number: number; title: string; total: number; paid: number; due: number; acceptedAt: string | null }[];
}

export interface Numbers {
  monotributo: { category: string | null; cap: number | null; invoiced: number; banked: number; pct: number | null; projection: number };
  month: { income: number; net: number; expenses: number; wages: number };
  cashflow30: { receivable: number; cheques: number; fixed: number; wages: number };
  breakeven: { fixedMonthly: number; marginPct: number | null; salesNeeded: number | null };
  byKind: { kind: string; count: number; revenue: number; profit: number; marginPct: number | null }[];
  jobs: { id: string; number: number; title: string; customer: string | null; price: number; material: number; materialKnown: boolean; wages: number; expenses: number; fees: number; profit: number }[];
}

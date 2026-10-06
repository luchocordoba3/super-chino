import type { Basis, Category, Currency, CustomerType, LeadStatus, QuoteInput, QuoteResult, QuoteSettings, QuoteStatus, Unit } from '@vidrieria/shared';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'PARTNER';
  active: boolean;
}

export interface Me {
  user: User;
  business: { id: string; slug: string; name: string; customDomain: string | null };
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
    pay: { alias: string; cbu: string; holder: string; note: string };
  };
}

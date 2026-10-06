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
  customer: { id: string; name: string; phone: string } | null;
}

export interface Quote extends Omit<QuoteListItem, 'customer'> {
  notes: string;
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
  recent: QuoteListItem[];
}

export interface PublicQuote {
  quote: {
    number: number;
    title: string;
    notes: string;
    status: QuoteStatus;
    customerName: string | null;
    createdAt: string;
    validUntil: string;
    acceptedAt: string | null;
    items: { title: string; widthMm: number; heightMm: number; quantity: number; lines: { name: string; qty: number; unit: string }[]; total: number }[];
    extras: { name: string; total: number }[];
    adjust: number;
    urgency: number;
    freight: number;
    discount: number;
    total: number;
    vat: number;
    pricesIncludeVat: boolean;
    depositPct: number;
    deposit: number;
    balance: number;
    footer: string;
  };
  business: { name: string; slug: string; whatsapp: string; address: string; email: string; logo: string | null; primaryColor: string; accentColor: string };
}

import type { GlassType, PieceKind } from '@vidrieria/shared';
import { api } from '../api';
import { delPhoto, getPhoto } from './idb';
import { itemFromSpec } from './pieces';
import type { CatalogItem, Customer, Quote, Template } from './types';

/** Una pieza medida en la obra (medidas en cm, como se mide con la cinta). */
export interface MeasurePiece {
  id: string;
  templateId: string | null;
  title: string;
  widthCm: number | null;
  heightCm: number | null;
  quantity: number;
  note: string;
  kind?: PieceKind | null;
  thicknessMm?: number | null;
  glass?: GlassType | null;
  laminate?: string | null;
  /** Claves de las fotos en IndexedDB. */
  photos: string[];
}

export interface MeasureDraft {
  id: string;
  createdAt: string;
  customerName: string;
  phone: string;
  address: string;
  notes: string;
  pieces: MeasurePiece[];
}

const DRAFT = 'vd_measure_draft';
const QUEUE = 'vd_measure_queue';
const TEMPLATES = 'vd_templates';
const CATALOG = 'vd_catalog';
export const QUEUE_EVENT = 'vd-measure-queue';

const read = <T,>(key: string, fallback: T): T => {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // almacenamiento lleno o bloqueado
  }
};

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export const emptyDraft = (): MeasureDraft => ({ id: newId(), createdAt: new Date().toISOString(), customerName: '', phone: '', address: '', notes: '', pieces: [] });
export const loadDraft = () => read<MeasureDraft | null>(DRAFT, null);
export const saveDraft = (d: MeasureDraft | null) => write(DRAFT, d);

export const pendingMeasures = () => read<MeasureDraft[]>(QUEUE, []);
function setQueue(q: MeasureDraft[]) {
  write(QUEUE, q.length ? q : null);
  window.dispatchEvent(new Event(QUEUE_EVENT));
}
export const enqueue = (d: MeasureDraft) => setQueue([...pendingMeasures().filter((x) => x.id !== d.id), d]);

/** Plantillas y catálogo guardados para poder medir sin señal. */
export const rememberCatalog = (templates?: Template[], catalog?: CatalogItem[]) => {
  if (templates) write(TEMPLATES, templates);
  if (catalog) write(CATALOG, catalog);
};
export const cachedTemplates = () => read<Template[]>(TEMPLATES, []);

/** Sube una medición: fotos, cliente y presupuesto armado con las plantillas. Devuelve el presupuesto. */
export async function uploadMeasure(d: MeasureDraft): Promise<Quote> {
  const [templates, catalog] = await Promise.all([api<Template[]>('/templates'), api<CatalogItem[]>('/catalog')]);
  rememberCatalog(templates, catalog);

  const photoIds: string[] = [];
  for (const key of d.pieces.flatMap((p) => p.photos)) {
    const dataUrl = await getPhoto(key);
    if (dataUrl) photoIds.push((await api<{ id: string }>('/assets', { body: { dataUrl, kind: 'quote' } })).id);
  }

  let customerId: string | null = null;
  if (d.customerName.trim() || d.phone.trim()) {
    const found = d.phone.trim() ? (await api<Customer[]>(`/customers?q=${encodeURIComponent(d.phone.trim())}`))[0] : undefined;
    customerId = (found ?? (await api<Customer>('/customers', { body: { name: d.customerName.trim() || d.phone.trim(), phone: d.phone.trim(), address: d.address.trim() } }))).id;
  }

  const items = d.pieces
    .filter((p) => p.widthCm && p.heightCm)
    .map((p) =>
      itemFromSpec(
        { ...p, widthMm: Math.round((p.widthCm ?? 0) * 10), heightMm: Math.round((p.heightCm ?? 0) * 10), title: p.title },
        templates,
        catalog,
      ),
    );
  const pieceNotes = d.pieces.map((p, i) => (p.note.trim() ? `Pieza ${i + 1} (${p.title}): ${p.note.trim()}` : '')).filter(Boolean);
  const notes = [d.notes.trim(), d.address.trim() ? `Dirección: ${d.address.trim()}` : '', ...pieceNotes].filter(Boolean).join('\n');
  const quote = await api<Quote>('/quotes', {
    body: { customerId, title: items.length === 1 ? items[0].title : 'Medición en obra', notes, items, extras: [], photoIds },
  });
  for (const key of d.pieces.flatMap((p) => p.photos)) await delPhoto(key).catch(() => {});
  return quote;
}

let syncing = false;
/** Sube las mediciones que quedaron guardadas sin señal. */
export async function syncPending() {
  if (syncing || !navigator.onLine) return 0;
  syncing = true;
  let done = 0;
  try {
    for (const d of pendingMeasures()) {
      try {
        await uploadMeasure(d);
        setQueue(pendingMeasures().filter((x) => x.id !== d.id));
        done++;
      } catch {
        break;
      }
    }
  } finally {
    syncing = false;
  }
  return done;
}

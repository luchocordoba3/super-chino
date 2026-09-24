import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';
import { money } from '../lib/format';
import { useSuppliers } from '../lib/hooks';
import { can, useMe } from '../lib/me';
import type { PriceSuggestion, Product, Unit } from '../lib/types';
import { ScanButton } from './BarcodeScanner';
import { Field, toast, toNum } from './ui';

export interface EntryLine {
  key: string;
  productId: string | null;
  name: string;
  barcode: string;
  price: string;
  unit: Unit;
  qty: string;
  unitCost: string;
  lotCode: string;
  expiresAt: string;
  /** Texto original de la factura (lectura con IA). */
  description?: string;
  candidates?: { id: string; name: string }[];
  skip?: boolean;
}

let seq = 0;
export const newLine = (partial: Partial<EntryLine> = {}): EntryLine => ({
  key: `l${++seq}`,
  productId: null,
  name: '',
  barcode: '',
  price: '',
  unit: 'UNIT',
  qty: '',
  unitCost: '',
  lotCode: '',
  expiresAt: '',
  ...partial,
});

const lineFromProduct = (p: Product, extra: Partial<EntryLine> = {}) =>
  newLine({ productId: p.id, name: p.name, barcode: p.barcode ?? '', unit: p.unit, unitCost: p.cost ? String(p.cost) : '', ...extra });

/** Aviso "el costo subió: precio sugerido" con botón para aplicarlo. */
export function SuggestionCard({ items, onDone }: { items: PriceSuggestion[]; onDone: (productId: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  if (items.length === 0) return null;
  const apply = async (s: PriceSuggestion) => {
    try {
      await api(`/products/${s.productId}`, { method: 'PATCH', body: { price: s.suggestedPrice, priceSource: 'margin' } });
      toast(t('products.applied'));
      void qc.invalidateQueries({ queryKey: ['products'] });
      onDone(s.productId);
    } catch (e) {
      toast(errMsg(e));
    }
  };
  return (
    <div className="card" style={{ borderLeft: '4px solid var(--gold)' }}>
      <h3>{t('stock.marginTitle')}</h3>
      {items.map((s) => (
        <div className="row between list-item" key={s.productId}>
          <span>{t('stock.marginLine', { name: s.name, old: money(s.oldPrice), suggested: money(s.suggestedPrice) })}</span>
          <div className="row">
            <button className="small primary" onClick={() => void apply(s)}>
              {t('stock.applyPrice')}
            </button>
            <button className="small ghost" onClick={() => onDone(s.productId)}>
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Ingreso de mercadería con varios renglones (a mano o precargado por la IA). */
export function EntryEditor(props: {
  initialLines?: EntryLine[];
  initialSupplierId?: string;
  initialInvoiceNumber?: string;
  invoiceScanId?: string;
  onSaved?: () => void;
}) {
  const me = useMe();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sups = useSuppliers();
  const [lines, setLines] = useState<EntryLine[]>(props.initialLines ?? []);
  const [supplierId, setSupplierId] = useState(props.initialSupplierId ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(props.initialInvoiceNumber ?? '');
  const [adder, setAdder] = useState('');
  const [results, setResults] = useState<Product[] | null>(null);
  const [suggestions, setSuggestions] = useState<PriceSuggestion[]>([]);
  const [busy, setBusy] = useState(false);

  const add = async (raw: string) => {
    const c = raw.trim();
    if (!c) return;
    try {
      if (/^\d{6,14}$/.test(c)) {
        const r = await api<{ product: Product | null; suggestion: { name: string } | null }>(`/products/barcode/${c}?lookup=1`);
        setLines((ls) => [...ls, r.product ? lineFromProduct(r.product) : newLine({ barcode: c, name: r.suggestion?.name ?? '' })]);
        setAdder('');
        setResults(null);
      } else {
        setResults((await api<Product[]>(`/products?q=${encodeURIComponent(c)}`)).slice(0, 8));
      }
    } catch (e) {
      toast(errMsg(e));
    }
  };
  const update = (key: string, patch: Partial<EntryLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    const active = lines.filter((l) => !l.skip);
    for (const l of active) {
      if (!((toNum(l.qty) ?? 0) > 0)) return toast(`${l.name || l.description}: ${t('common.qty')}`);
      if (!l.productId && (!l.name.trim() || toNum(l.price) == null)) return toast(`${t('stock.newProduct')}: ${t('common.name')} / ${t('common.price')}`);
    }
    setBusy(true);
    try {
      const items = active.map((l) => ({
        ...(l.productId ? { productId: l.productId } : { newProduct: { name: l.name.trim(), price: toNum(l.price), barcode: l.barcode || null, unit: l.unit } }),
        qty: toNum(l.qty),
        unitCost: toNum(l.unitCost),
        lotCode: l.lotCode || null,
        expiresAt: l.expiresAt || null,
      }));
      const r = await api<{ suggestions: PriceSuggestion[] }>('/stock/entries', {
        body: { supplierId: supplierId || null, invoiceNumber: invoiceNumber || null, invoiceScanId: props.invoiceScanId ?? null, items },
      });
      toast(t('stock.entrySaved'));
      setLines([]);
      setInvoiceNumber('');
      setSuggestions(can(me, 'prices') ? r.suggestions : []);
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['lots'] });
      props.onSaved?.();
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <SuggestionCard items={suggestions} onDone={(id) => setSuggestions((s) => s.filter((x) => x.productId !== id))} />
      <div className="card stack">
        <div className="grid2">
          <Field label={t('products.supplier')}>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">—</option>
              {sups.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('stock.invoiceNumber')}>
            <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </Field>
        </div>
        <div className="row">
          <input
            className="grow"
            style={{ width: 'auto' }}
            placeholder={t('products.searchPlaceholder')}
            value={adder}
            onChange={(e) => setAdder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add(adder);
              }
            }}
          />
          <ScanButton onCode={(c) => void add(c)} />
          <button type="button" onClick={() => void add(adder)}>
            {t('stock.addLine')}
          </button>
        </div>
        {results && (
          <div className="stack">
            {results.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => {
                  setLines((ls) => [...ls, lineFromProduct(p)]);
                  setAdder('');
                  setResults(null);
                }}
              >
                {p.name} <span className="muted small">{p.barcode}</span>
              </button>
            ))}
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setLines((ls) => [...ls, newLine({ name: adder.trim() })]);
                setAdder('');
                setResults(null);
              }}
            >
              + {t('stock.newProduct')}: “{adder}”
            </button>
          </div>
        )}
      </div>

      {lines.map((l) => (
        <div className="card stack" key={l.key} style={{ opacity: l.skip ? 0.5 : 1 }}>
          {l.description && <div className="muted small">📄 {l.description}</div>}
          <div className="row between">
            {l.candidates ? (
              <select
                className="grow"
                style={{ width: 'auto' }}
                value={l.productId ?? ''}
                onChange={(e) => {
                  const c = l.candidates!.find((x) => x.id === e.target.value);
                  update(l.key, c ? { productId: c.id, name: c.name } : { productId: null, name: l.description ?? '' });
                }}
              >
                {l.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    ✓ {c.name}
                  </option>
                ))}
                <option value="">+ {t('scan.create')}</option>
              </select>
            ) : (
              <strong className="grow">{l.productId ? l.name : `${t('stock.newProduct')}${l.barcode ? ` · ${l.barcode}` : ''}`}</strong>
            )}
            <label className="check small">
              <input type="checkbox" checked={!!l.skip} onChange={(e) => update(l.key, { skip: e.target.checked })} /> {t('scan.skip')}
            </label>
            <button type="button" className="small ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
              ✕
            </button>
          </div>
          {!l.productId && (
            <div className="grid2">
              <Field label={t('common.name')}>
                <input value={l.name} onChange={(e) => update(l.key, { name: e.target.value })} />
              </Field>
              <Field label={`${t('common.price')} ($)`}>
                <input value={l.price} onChange={(e) => update(l.key, { price: e.target.value })} inputMode="decimal" />
              </Field>
            </div>
          )}
          <div className="grid2">
            <Field label={t('common.qty')}>
              <input value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label={`${t('stock.unitCost')} ($)`}>
              <input value={l.unitCost} onChange={(e) => update(l.key, { unitCost: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label={`${t('stock.expiresAt')} (${t('common.optional')})`}>
              <input type="date" value={l.expiresAt} onChange={(e) => update(l.key, { expiresAt: e.target.value })} />
            </Field>
            <Field label={`${t('stock.lotCode')} (${t('common.optional')})`}>
              <input value={l.lotCode} onChange={(e) => update(l.key, { lotCode: e.target.value })} />
            </Field>
          </div>
        </div>
      ))}
      {lines.length > 0 && (
        <button className="primary big" onClick={() => void save()} disabled={busy}>
          {t('stock.saveEntry')} ({lines.filter((l) => !l.skip).length})
        </button>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type ContentUnit, parseContent, unitPrice } from '@almacen/shared';
import { api } from '../api';
import { Empty, ErrorBox, Loading } from '../components/ui';
import { dayFmt, money, todayISO } from '../lib/format';
import { eanModules, eanPath } from '../lib/ean13';
import { useCategories, useDebounce } from '../lib/hooks';
import type { Product } from '../lib/types';

const PER_KEY = { kg: 'kg', l: 'l', '10 g': 'g10', '10 ml': 'ml10', u: 'u' } as const;

/** Etiquetas de góndola con precio por unidad de medida (kilo, litro o 10 g/ml) y código de barras. */
export function Labels() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'changed' | 'all'>('changed');
  const [since, setSince] = useState(params.get('since') ?? todayISO());
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const search = useDebounce(q);
  const cats = useCategories();
  const query = new URLSearchParams({
    ...(search ? { q: search } : {}),
    ...(cat ? { categoryId: cat } : {}),
    ...(mode === 'changed' ? { priceChangedSince: since } : {}),
  });
  const products = useQuery({ queryKey: ['products', 'labels', query.toString()], queryFn: () => api<Product[]>(`/products?${query}`) });
  const selected = (products.data ?? []).filter((p) => !excluded.has(p.id));
  const toggle = (id: string) => {
    const next = new Set(excluded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExcluded(next);
  };

  return (
    <div className="stack">
      <div className="stack no-print">
        <Link to="/products">← {t('products.title')}</Link>
        <h1>{t('labels.title')}</h1>
        <p className="muted">{t('labels.help')}</p>
        <div className="card row">
          <select value={mode} onChange={(e) => setMode(e.target.value as 'changed' | 'all')} style={{ width: 'auto' }}>
            <option value="changed">{t('labels.changedSince')}</option>
            <option value="all">{t('labels.all')}</option>
          </select>
          {mode === 'changed' && <input type="date" value={since} onChange={(e) => setSince(e.target.value)} style={{ width: 'auto' }} />}
          <input className="grow" style={{ width: 'auto' }} placeholder={t('products.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 'auto' }}>
            <option value="">
              {t('products.category')}: {t('common.all')}
            </option>
            {cats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {products.isLoading && <Loading />}
        <ErrorBox error={products.error} />
        {products.data?.length === 0 && <Empty />}
        {products.data && products.data.length > 0 && (
          <div className="card stack">
            <div className="row between">
              <strong>{t('labels.count', { count: selected.length })}</strong>
              <button className="primary" disabled={!selected.length} onClick={() => window.print()}>
                🖨 {t('labels.print')}
              </button>
            </div>
            <div className="row small">
              {products.data.map((p) => (
                <label className="check" key={p.id}>
                  <input type="checkbox" checked={!excluded.has(p.id)} onChange={() => toggle(p.id)} /> {p.name}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="labels-sheet print-area">
        {selected.map((p) => (
          <ShelfLabel key={p.id} p={p} />
        ))}
      </div>
    </div>
  );
}

function ShelfLabel({ p }: { p: Product }) {
  // La etiqueta la leen los clientes: siempre en español.
  const { t } = useTranslation(undefined, { lng: 'es' });
  const content = p.contentQty && p.contentUnit ? { qty: p.contentQty, unit: p.contentUnit as ContentUnit } : parseContent(p.name);
  const up = unitPrice(p.price, content, p.unit);
  const modules = p.barcode ? eanModules(p.barcode) : null;
  return (
    <div className="shelf-label">
      <div className="sl-name">{p.name}</div>
      <div className="sl-price">{money(p.price)}</div>
      {up && (
        <div className="sl-unit">
          {money(up.value)} {t(`labels.per.${PER_KEY[up.per]}`)}
        </div>
      )}
      <div className="sl-foot">
        {modules && (
          <svg className="sl-barcode" viewBox={`0 0 ${modules.length} 1`} preserveAspectRatio="none" aria-hidden>
            <path d={eanPath(modules)} />
          </svg>
        )}
        <span className="grow">{p.barcode}</span>
        <span>{dayFmt(todayISO())}</span>
      </div>
    </div>
  );
}

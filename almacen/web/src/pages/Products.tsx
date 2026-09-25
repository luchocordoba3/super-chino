import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError, errMsg } from '../api';
import { ScanButton } from '../components/BarcodeScanner';
import { Empty, ErrorBox, Field, Loading, Modal, toast, toNum } from '../components/ui';
import { dayFmt, daysUntil, money, qtyFmt } from '../lib/format';
import { useCategories, useDebounce, useSuppliers } from '../lib/hooks';
import { can, useMe } from '../lib/me';
import { parseContent } from '@almacen/shared';
import type { Product, Unit } from '../lib/types';

export function Products() {
  const me = useMe();
  const { t } = useTranslation();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const [cat, setCat] = useState('');
  const [modal, setModal] = useState<'new' | 'bulk' | null>(null);
  const search = useDebounce(q);
  const cats = useCategories();
  const params = new URLSearchParams({ ...(search ? { q: search } : {}), ...(low ? { lowStock: '1' } : {}), ...(cat ? { categoryId: cat } : {}) });
  const products = useQuery({ queryKey: ['products', params.toString()], queryFn: () => api<Product[]>(`/products?${params}`) });

  return (
    <div className="stack">
      <div className="row between">
        <h1>{t('products.title')}</h1>
        <div className="row">
          {(can(me, 'stock') || can(me, 'prices')) && (
            <Link className="btn" to="/suppliers">
              {t('products.suppliers')}
            </Link>
          )}
          <Link className="btn" to="/labels">
            🏷️ {t('products.labels')}
          </Link>
          {can(me, 'stock') && can(me, 'prices') && (
            <Link className="btn" to="/products/import">
              📄 {t('products.import')}
            </Link>
          )}
          {can(me, 'prices') && <button onClick={() => setModal('bulk')}>{t('products.bulkPrice')}</button>}
          {(can(me, 'stock') || can(me, 'prices')) && (
            <button className="primary" onClick={() => setModal('new')}>
              + {t('products.new')}
            </button>
          )}
        </div>
      </div>
      <div className="card row">
        <input className="grow" style={{ width: 'auto' }} placeholder={t('products.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        <ScanButton onCode={setQ} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 'auto' }}>
          <option value="">{t('products.category')}: {t('common.all')}</option>
          {cats.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> {t('products.lowStock')}
        </label>
      </div>
      {products.isLoading && <Loading />}
      <ErrorBox error={products.error} />
      {products.data && products.data.length === 0 && <Empty />}
      {products.data && products.data.length > 0 && (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th className="num">{t('common.price')}</th>
                <th className="num">{t('products.stock')}</th>
                <th>{t('products.nearestExpiry')}</th>
              </tr>
            </thead>
            <tbody>
              {products.data.map((p) => {
                const days = p.nearestExpiry ? daysUntil(p.nearestExpiry) : null;
                return (
                  <tr key={p.id} onClick={() => nav(`/products/${p.id}`)} style={{ cursor: 'pointer' }}>
                    <td>
                      <Link to={`/products/${p.id}`}>{p.name}</Link>
                      <div className="muted small">{[p.barcode, p.category].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="num">{money(p.price)}</td>
                    <td className={`num ${p.stock <= p.minStock ? 'error' : ''}`}>
                      {qtyFmt(p.stock)} {p.unit === 'KG' ? 'kg' : ''}
                    </td>
                    <td>
                      {p.nearestExpiry && (
                        <span className={`badge ${days! < 0 ? 'red' : days! <= me.store.settings.expiryAlertDays ? 'gold' : 'gray'}`}>{dayFmt(p.nearestExpiry)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {modal === 'new' && (
        <Modal title={t('products.new')} onClose={() => setModal(null)}>
          <ProductForm onSaved={(p) => nav(`/products/${p.id}`)} />
        </Modal>
      )}
      {modal === 'bulk' && (
        <Modal title={t('products.bulkPrice')} onClose={() => setModal(null)}>
          <BulkPrice onDone={() => setModal(null)} />
        </Modal>
      )}
    </div>
  );
}

/** Alta / edición de producto. */
export function ProductForm({ initial, onSaved }: { initial?: Product; onSaved?: (p: Product) => void }) {
  const me = useMe();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cats = useCategories();
  const sups = useSuppliers();
  const [f, setF] = useState({
    barcode: initial?.barcode ?? '',
    name: initial?.name ?? '',
    brand: initial?.brand ?? '',
    categoryId: initial?.categoryId ?? '',
    supplierId: initial?.supplierId ?? '',
    unit: (initial?.unit ?? 'UNIT') as Unit,
    price: initial ? String(initial.price) : '',
    cost: initial ? String(initial.cost) : '',
    minStock: initial ? String(initial.minStock) : '',
    idealStock: initial?.idealStock != null ? String(initial.idealStock) : '',
    targetMargin: initial?.targetMargin != null ? String(initial.targetMargin) : '',
    contentQty: initial?.contentQty != null ? String(initial.contentQty) : '',
    contentUnit: initial?.contentUnit ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const canPrice = !initial || can(me, 'prices');
  const parsed = parseContent(f.name);

  const lookup = async (code: string) => {
    setF((prev) => ({ ...prev, barcode: code }));
    if (initial) return;
    const r = await api<{ product: Product | null; suggestion: { name: string; brand: string | null } | null }>(`/products/barcode/${encodeURIComponent(code)}?lookup=1`);
    if (r.product) setError(t('products.barcodeTaken'));
    else if (r.suggestion) {
      setF((prev) => ({ ...prev, name: prev.name || r.suggestion!.name, brand: prev.brand || (r.suggestion!.brand ?? '') }));
      toast(t('products.lookupFound'));
    }
  };

  const newCategory = async () => {
    const name = window.prompt(t('products.newCategory'));
    if (!name) return;
    const c = await api<{ id: string }>('/categories', { body: { name } });
    await qc.invalidateQueries({ queryKey: ['categories'] });
    setF((prev) => ({ ...prev, categoryId: c.id }));
  };
  const newSupplier = async () => {
    const name = window.prompt(t('products.newSupplier'));
    if (!name) return;
    const phone = window.prompt(t('products.phone')) ?? '';
    const s = await api<{ id: string }>('/suppliers', { body: { name, phone } });
    await qc.invalidateQueries({ queryKey: ['suppliers'] });
    setF((prev) => ({ ...prev, supplierId: s.id }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = {
      barcode: f.barcode || null,
      name: f.name,
      brand: f.brand || null,
      categoryId: f.categoryId || null,
      supplierId: f.supplierId || null,
      unit: f.unit,
      ...(canPrice ? { price: toNum(f.price) ?? 0 } : {}),
      cost: toNum(f.cost) ?? 0,
      minStock: toNum(f.minStock) ?? 0,
      idealStock: toNum(f.idealStock),
      targetMargin: toNum(f.targetMargin),
      contentQty: f.contentUnit ? toNum(f.contentQty) : null,
      contentUnit: f.contentUnit && toNum(f.contentQty) ? f.contentUnit : null,
    };
    try {
      const p = initial
        ? await api<Product>(`/products/${initial.id}`, { method: 'PATCH', body })
        : await api<Product>('/products', { body });
      toast(t('common.saved'));
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['product', p.id] });
      onSaved?.(p);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'barcode_taken' ? t('products.barcodeTaken') : errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <Field label={t('products.barcode')}>
        <div className="row">
          <input className="grow" style={{ width: 'auto' }} value={f.barcode} onChange={set('barcode')} onBlur={(e) => !initial && e.target.value && void lookup(e.target.value)} inputMode="numeric" />
          <ScanButton onCode={(c) => void lookup(c)} />
        </div>
      </Field>
      <Field label={t('common.name')}>
        <input value={f.name} onChange={set('name')} required />
      </Field>
      <div className="grid2">
        <Field label={`${t('common.price')} ($)`}>
          <input value={f.price} onChange={set('price')} inputMode="decimal" required disabled={!canPrice} />
        </Field>
        <Field label={`${t('common.cost')} ($)`}>
          <input value={f.cost} onChange={set('cost')} inputMode="decimal" />
        </Field>
        <Field label={t('products.unit')}>
          <select value={f.unit} onChange={set('unit')}>
            <option value="UNIT">{t('common.units.UNIT')}</option>
            <option value="KG">{t('common.units.KG')}</option>
          </select>
        </Field>
        <Field label={t('products.minStock')}>
          <input value={f.minStock} onChange={set('minStock')} inputMode="decimal" />
        </Field>
        <Field label={t('products.idealStock')} hint={t('products.idealStockHint')}>
          <input value={f.idealStock} onChange={set('idealStock')} inputMode="decimal" />
        </Field>
        <Field label={t('products.brand')}>
          <input value={f.brand} onChange={set('brand')} />
        </Field>
        <Field label={t('products.targetMargin')} hint={`${t('common.optional')} · ${me.store.settings.targetMargin}%`}>
          <input value={f.targetMargin} onChange={set('targetMargin')} inputMode="decimal" />
        </Field>
        <Field label={t('products.content')} hint={!f.contentQty && parsed ? `${t('products.detected')}: ${parsed.qty} ${parsed.unit}` : undefined}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input value={f.contentQty} onChange={set('contentQty')} inputMode="decimal" placeholder={parsed ? String(parsed.qty) : ''} />
            <select value={f.contentUnit} onChange={set('contentUnit')} style={{ width: 'auto' }}>
              <option value="">{parsed ? parsed.unit : '—'}</option>
              {(['g', 'kg', 'ml', 'l', 'u'] as const).map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </Field>
      </div>
      <Field label={t('products.category')}>
        <div className="row">
          <select className="grow" style={{ width: 'auto' }} value={f.categoryId} onChange={set('categoryId')}>
            <option value="">—</option>
            {cats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void newCategory()}>
            +
          </button>
        </div>
      </Field>
      <Field label={t('products.supplier')}>
        <div className="row">
          <select className="grow" style={{ width: 'auto' }} value={f.supplierId} onChange={set('supplierId')}>
            <option value="">—</option>
            {sups.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void newSupplier()}>
            +
          </button>
        </div>
      </Field>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy}>
        {t('common.save')}
      </button>
    </form>
  );
}

function BulkPrice({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cats = useCategories();
  const sups = useSuppliers();
  const [percent, setPercent] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [preview, setPreview] = useState<{ count: number; changes: { id: string; name: string; oldPrice: number; newPrice: number }[] } | null>(null);
  const body = (dryRun: boolean) => ({ percent: toNum(percent) ?? 0, categoryId: categoryId || null, supplierId: supplierId || null, dryRun });

  const run = async (dryRun: boolean) => {
    try {
      const r = await api<{ count: number; changes: { id: string; name: string; oldPrice: number; newPrice: number }[] }>('/products/bulk-price', { body: body(dryRun) });
      if (dryRun) setPreview(r);
      else {
        toast(t('products.applied'));
        void qc.invalidateQueries({ queryKey: ['products'] });
        onDone();
      }
    } catch (e) {
      toast(errMsg(e));
    }
  };

  return (
    <div className="stack">
      <Field label={t('products.percent')} hint={t('products.bulkHelp')}>
        <input value={percent} onChange={(e) => (setPercent(e.target.value), setPreview(null))} inputMode="decimal" />
      </Field>
      <div className="grid2">
        <select value={categoryId} onChange={(e) => (setCategoryId(e.target.value), setPreview(null))}>
          <option value="">{t('products.category')}: {t('common.all')}</option>
          {cats.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={supplierId} onChange={(e) => (setSupplierId(e.target.value), setPreview(null))}>
          <option value="">{t('products.supplier')}: {t('common.all')}</option>
          {sups.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {!preview && (
        <button onClick={() => void run(true)} disabled={!toNum(percent)}>
          {t('common.preview')}
        </button>
      )}
      {preview && (
        <>
          <strong>{t('products.willChange', { count: preview.count })}</strong>
          <div className="table-wrap" style={{ maxHeight: 240 }}>
            <table>
              <tbody>
                {preview.changes.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="num muted">{money(c.oldPrice)}</td>
                    <td className="num">
                      <strong>{money(c.newPrice)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="primary" onClick={() => void run(false)} disabled={preview.count === 0}>
            {t('common.apply')}
          </button>
        </>
      )}
    </div>
  );
}

import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Field, Loading, toast, toNum } from '../components/ui';
import { dateTimeFmt, dayFmt, daysUntil, money, qtyFmt } from '../lib/format';
import { can, useMe } from '../lib/me';
import type { ProductDetail as Detail, Product } from '../lib/types';
import { ProductForm } from './Products';

export function ProductDetail() {
  const { id } = useParams();
  const me = useMe();
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['product', id], queryFn: () => api<Detail>(`/products/${id}`) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const p = q.data;

  return (
    <div className="stack">
      <Link to="/products">← {t('common.back')}</Link>
      <div className="row between">
        <h1>{p.name}</h1>
        <div className="row">
          <span className="badge gold">{money(p.price)}</span>
          {p.hasRecipe ? (
            <span className="badge">🍳 {t('recipe.badge')}</span>
          ) : (
            <span className={`badge ${p.stock <= p.minStock ? 'red' : 'green'}`}>
              {t('products.stock')}: {qtyFmt(p.stock)}
            </span>
          )}
        </div>
      </div>
      {p.unallocatedSold > 0 && <p className="warn">{t('stock.sinStock', { qty: qtyFmt(p.unallocatedSold) })}</p>}
      {!can(me, 'owner') && (
        <button
          type="button"
          onClick={() =>
            void api('/stock/shortage', { method: 'POST', body: { productId: p.id } })
              .then(() => toast(t('pos.shortageSent', { name: p.name })))
              .catch((e) => toast(errMsg(e)))
          }
        >
          📣 {t('pos.shortage')}
        </button>
      )}

      {(can(me, 'stock') || can(me, 'prices')) && (
        <div className="card">
          <ProductForm key={p.updatedAt} initial={p} />
        </div>
      )}
      {can(me, 'stock') && <RecipeEditor key={`r${p.updatedAt}`} product={p} />}

      <div className="card">
        <h2>{t('products.lots')}</h2>
        {p.lots.length === 0 && <Empty text={t('stock.noLots')} />}
        <table>
          <tbody>
            {p.lots.map((l) => {
              const days = l.expiresAt ? daysUntil(l.expiresAt) : null;
              return (
                <tr key={l.id}>
                  <td>{l.lotCode ?? '—'}</td>
                  <td>
                    {l.expiresAt ? (
                      <span className={`badge ${days! < 0 ? 'red' : days! <= me.store.settings.expiryAlertDays ? 'gold' : 'gray'}`}>{dayFmt(l.expiresAt)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="num">{qtyFmt(l.qtyRemaining)}</td>
                  <td className="num muted">{money(l.unitCost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {can(me, 'adjust') && <AdjustForm productId={p.id} lots={p.lots} />}

      <div className="card">
        <h2>{t('products.priceHistory')}</h2>
        {p.priceHistory.length === 0 && <Empty />}
        {p.priceHistory.map((c) => (
          <div key={c.id} className="list-item small">
            <span className="muted">{dateTimeFmt(c.createdAt)}</span>
            <span className="grow">
              {money(c.oldPrice)} → <strong>{money(c.newPrice)}</strong>
            </span>
            <span className="muted">
              {t(`products.sources.${c.source}`)} {c.user && t('products.changedBy', { name: c.user })}
            </span>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>{t('products.movements')}</h2>
        {p.movements.map((m) => (
          <div key={m.id} className="list-item small">
            <span className="muted">{dateTimeFmt(m.createdAt)}</span>
            <span className="grow">
              {t(`stock.movementTypes.${m.type}`)} {m.reason && <span className="muted">· {m.reason}</span>}
            </span>
            <span className={m.qty < 0 ? 'error' : 'ok'}>
              {m.qty > 0 ? '+' : ''}
              {qtyFmt(m.qty)}
            </span>
            <span className="muted">{m.user}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdjustForm({ productId, lots }: { productId: string; lots: Detail['lots'] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [qty, setQty] = useState('');
  const [type, setType] = useState<'ADJUSTMENT' | 'WASTE'>('WASTE');
  const [reason, setReason] = useState('');
  const [lotId, setLotId] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = toNum(qty);
    if (!n) return;
    try {
      await api('/stock/adjust', { body: { productId, qty: type === 'WASTE' ? -Math.abs(n) : n, type, reason: reason || null, lotId: lotId || null } });
      toast(t('common.saved'));
      setQty('');
      setReason('');
      void qc.invalidateQueries({ queryKey: ['product', productId] });
    } catch (err) {
      toast(errMsg(err));
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>{t('stock.adjust')}</h2>
      <div className="grid2">
        <select value={type} onChange={(e) => setType(e.target.value as 'ADJUSTMENT' | 'WASTE')}>
          <option value="WASTE">{t('stock.waste')}</option>
          <option value="ADJUSTMENT">{t('stock.movementTypes.ADJUSTMENT')}</option>
        </select>
        <Field label={t('common.qty')} hint={type === 'ADJUSTMENT' ? t('stock.adjustHelp') : undefined}>
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" required />
        </Field>
        <select value={lotId} onChange={(e) => setLotId(e.target.value)}>
          <option value="">{t('products.lots')}: FEFO</option>
          {lots.map((l) => (
            <option key={l.id} value={l.id}>
              {l.lotCode ?? '—'} · {dayFmt(l.expiresAt)} · {qtyFmt(l.qtyRemaining)}
            </option>
          ))}
        </select>
        <input placeholder={t('common.reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <button>{t('common.save')}</button>
    </form>
  );
}

/** Receta: qué ingredientes se descuentan al vender una unidad (tostado, café, tragos...). */
function RecipeEditor({ product }: { product: Detail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(product.hasRecipe);
  const [rows, setRows] = useState(
    product.recipe.map((r) => ({ ingredientId: r.ingredientId, name: r.name, unit: r.unit, qty: String(r.qty).replace('.', ','), unitCost: r.qty ? r.cost / r.qty : 0 })),
  );
  const [term, setTerm] = useState('');
  const found = useQuery({
    queryKey: ['products', 'search', term],
    queryFn: () => api<Product[]>(`/products?q=${encodeURIComponent(term.trim())}`),
    enabled: term.trim().length >= 2,
  });
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        🍳 {t('recipe.make')}
      </button>
    );
  }
  const cost = rows.reduce((s, r) => s + (toNum(r.qty) ?? 0) * r.unitCost, 0);
  const pct = product.price > 0 ? Math.round(((product.price - cost) / product.price) * 100) : 0;
  const options = (found.data ?? []).filter((x) => x.id !== product.id && !x.hasRecipe && !rows.some((r) => r.ingredientId === x.id)).slice(0, 6);
  const save = async () => {
    try {
      await api(`/products/${product.id}/recipe`, {
        method: 'PUT',
        body: { items: rows.map((r) => ({ ingredientId: r.ingredientId, qty: toNum(r.qty) ?? 0 })).filter((r) => r.qty > 0) },
      });
      toast(t('recipe.saved'));
      await qc.invalidateQueries({ queryKey: ['product', product.id] });
    } catch (e) {
      toast(errMsg(e));
    }
  };
  return (
    <div className="card stack">
      <h2>🍳 {t('recipe.title')}</h2>
      <p className="muted small">{t('recipe.help')}</p>
      {rows.map((r, i) => (
        <div className="row" key={r.ingredientId} style={{ flexWrap: 'nowrap' }}>
          <span className="grow">{r.name}</span>
          <input
            style={{ width: 90 }}
            inputMode="decimal"
            aria-label={r.name}
            value={r.qty}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
          />
          <span className="muted small">{r.unit === 'KG' ? 'kg' : t('recipe.units')}</span>
          <button type="button" className="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={t('common.delete')}>
            ✕
          </button>
        </div>
      ))}
      <input type="search" placeholder={t('recipe.addIngredient')} value={term} onChange={(e) => setTerm(e.target.value)} />
      {options.map((x) => (
        <button
          type="button"
          key={x.id}
          className="ghost"
          style={{ textAlign: 'left' }}
          onClick={() => {
            setRows([...rows, { ingredientId: x.id, name: x.name, unit: x.unit, qty: '', unitCost: x.cost }]);
            setTerm('');
          }}
        >
          + {x.name} <span className="muted small">({t('products.stock')}: {qtyFmt(x.stock)})</span>
        </button>
      ))}
      <div className="row between">
        <span>
          {t('recipe.cost')}: <strong>{money(cost)}</strong> · {t('recipe.margin', { pct })}
        </span>
        <button type="button" className="primary" onClick={() => void save()}>
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

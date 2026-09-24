import { type FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';
import { ScanButton } from '../components/BarcodeScanner';
import { EntryEditor, SuggestionCard } from '../components/EntryEditor';
import { LabelReader } from '../components/LabelReader';
import { Empty, ErrorBox, Field, Loading, Tabs, toast, toNum } from '../components/ui';
import { dateTimeFmt, dayFmt, money, qtyFmt } from '../lib/format';
import { useCategories } from '../lib/hooks';
import { can, useMe } from '../lib/me';
import type { LotRow, Movement, PriceSuggestion, Product, Unit } from '../lib/types';

type Tab = 'quick' | 'entry' | 'lots' | 'moves';

export function Stock() {
  const me = useMe();
  const { t } = useTranslation();
  const canLoad = can(me, 'stock');
  const [tab, setTab] = useState<Tab>(canLoad ? 'quick' : 'lots');
  const tabs: { id: Tab; label: string }[] = [
    ...(canLoad ? [{ id: 'quick' as Tab, label: t('stock.quickLoad') }, { id: 'entry' as Tab, label: t('stock.invoiceEntry') }] : []),
    { id: 'lots', label: t('stock.lots') },
    { id: 'moves', label: t('stock.movements') },
  ];
  return (
    <div className="stack">
      <h1>{t('stock.title')}</h1>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'quick' && <QuickLoad />}
      {tab === 'entry' && (
        <>
          {me.aiEnabled && (
            <Link className="btn" to="/stock/scan">
              📸 {t('stock.scanInvoice')}
            </Link>
          )}
          <EntryEditor />
        </>
      )}
      {tab === 'lots' && <Lots />}
      {tab === 'moves' && <Moves />}
    </div>
  );
}

const emptyForm = { name: '', price: '', unit: 'UNIT' as Unit, categoryId: '', qty: '', unitCost: '', expiresAt: '', lotCode: '' };

/** Escaneo el código -> si es nuevo pongo nombre y precio -> cantidad (y vencimiento) -> listo. */
function QuickLoad() {
  const me = useMe();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cats = useCategories();
  const [code, setCode] = useState('');
  const [found, setFound] = useState<{ product: Product | null; barcode: string | null } | null>(null);
  const [results, setResults] = useState<Product[] | null>(null);
  const [f, setF] = useState(emptyForm);
  const [recent, setRecent] = useState<{ name: string; qty: number; stock: number }[]>([]);
  const [suggestions, setSuggestions] = useState<PriceSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const choose = (product: Product | null, barcode: string | null, name = '') => {
    setFound({ product, barcode });
    setResults(null);
    setF({ ...emptyForm, name, unitCost: product?.cost ? String(product.cost) : '' });
    setTimeout(() => (product ? qtyRef : nameRef).current?.focus(), 0);
  };

  const lookup = async (raw: string) => {
    const c = raw.trim();
    if (!c) return;
    setCode(c);
    try {
      if (/^\d{4,14}$/.test(c)) {
        const r = await api<{ product: Product | null; suggestion: { name: string } | null }>(`/products/barcode/${c}?lookup=1`);
        choose(r.product, c, r.suggestion?.name ?? '');
      } else {
        setResults((await api<Product[]>(`/products?q=${encodeURIComponent(c)}`)).slice(0, 8));
      }
    } catch (e) {
      toast(errMsg(e));
    }
  };

  const reset = () => {
    setFound(null);
    setCode('');
    setF(emptyForm);
    setTimeout(() => codeRef.current?.focus(), 0);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!found) return;
    setBusy(true);
    try {
      const qty = toNum(f.qty) ?? 0;
      const r = await api<{ product: Product; created: boolean; suggestion: PriceSuggestion | null }>('/stock/quick', {
        body: {
          productId: found.product?.id ?? null,
          barcode: found.product ? null : found.barcode,
          qty,
          unitCost: toNum(f.unitCost),
          expiresAt: f.expiresAt || null,
          lotCode: f.lotCode || null,
          ...(found.product ? {} : { product: { name: f.name, price: toNum(f.price), unit: f.unit, categoryId: f.categoryId || null } }),
        },
      });
      toast(t('stock.entrySaved'));
      setRecent((prev) => [{ name: r.product.name, qty, stock: r.product.stock }, ...prev].slice(0, 10));
      if (r.suggestion && can(me, 'prices')) setSuggestions((s) => [r.suggestion!, ...s.filter((x) => x.productId !== r.suggestion!.productId)]);
      void qc.invalidateQueries({ queryKey: ['products'] });
      reset();
    } catch (err) {
      toast(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <SuggestionCard items={suggestions} onDone={(id) => setSuggestions((s) => s.filter((x) => x.productId !== id))} />
      <div className="card stack">
        <p className="muted">{t('stock.quickHelp')}</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup(code);
          }}
        >
          <input ref={codeRef} className="grow" style={{ width: 'auto', fontSize: '1.2rem' }} value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('products.barcode')} autoFocus />
          <ScanButton onCode={(c) => void lookup(c)} />
          <button>{t('common.search')}</button>
        </form>
        {results && (
          <div className="stack">
            {results.map((p) => (
              <button key={p.id} type="button" onClick={() => choose(p, p.barcode)}>
                {p.name} <span className="muted small">{p.barcode}</span>
              </button>
            ))}
            <button type="button" className="ghost" onClick={() => choose(null, null, code)}>
              + {t('stock.newProduct')}: “{code}”
            </button>
          </div>
        )}
      </div>

      {found && (
        <form className="card stack" onSubmit={save}>
          {found.product ? (
            <strong>{t('stock.existing', { name: found.product.name, stock: qtyFmt(found.product.stock) })}</strong>
          ) : (
            <>
              <strong>
                {t('stock.newProduct')} {found.barcode && <span className="muted">· {found.barcode}</span>}
              </strong>
              <div className="grid2">
                <Field label={t('common.name')}>
                  <input ref={nameRef} value={f.name} onChange={set('name')} required />
                </Field>
                <Field label={`${t('common.price')} ($)`}>
                  <input value={f.price} onChange={set('price')} inputMode="decimal" required />
                </Field>
                <Field label={t('products.unit')}>
                  <select value={f.unit} onChange={set('unit')}>
                    <option value="UNIT">{t('common.units.UNIT')}</option>
                    <option value="KG">{t('common.units.KG')}</option>
                  </select>
                </Field>
                <Field label={t('products.category')}>
                  <select value={f.categoryId} onChange={set('categoryId')}>
                    <option value="">—</option>
                    {cats.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </>
          )}
          <div className="grid2">
            <Field label={t('common.qty')}>
              <input ref={qtyRef} value={f.qty} onChange={set('qty')} inputMode="decimal" required />
            </Field>
            <Field label={`${t('stock.unitCost')} (${t('common.optional')})`}>
              <input value={f.unitCost} onChange={set('unitCost')} inputMode="decimal" />
            </Field>
            <Field label={`${t('stock.expiresAt')} (${t('common.optional')})`}>
              <input type="date" value={f.expiresAt} onChange={set('expiresAt')} />
            </Field>
            <Field label={`${t('stock.lotCode')} (${t('common.optional')})`}>
              <input value={f.lotCode} onChange={set('lotCode')} />
            </Field>
          </div>
          {me.aiEnabled && <LabelReader onRead={(r) => setF((prev) => ({ ...prev, expiresAt: r.expiresAt ?? prev.expiresAt, lotCode: r.lotCode ?? prev.lotCode }))} />}
          <div className="row">
            <button className="primary big grow" disabled={busy}>
              {t('stock.saveEntry')}
            </button>
            <button type="button" onClick={reset}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {recent.length > 0 && (
        <div className="card">
          {recent.map((r, i) => (
            <div key={i} className="list-item small">
              <span className="grow">✓ {r.name}</span>
              <span>+{qtyFmt(r.qty)}</span>
              <span className="muted">→ {qtyFmt(r.stock)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Lots() {
  const me = useMe();
  const { t } = useTranslation();
  const [within, setWithin] = useState<number>(me.store.settings.expiryAlertDays);
  const q = useQuery({ queryKey: ['lots', within], queryFn: () => api<LotRow[]>(`/stock/lots${within >= 0 ? `?within=${within}` : ''}`) });
  return (
    <div className="card stack">
      <select value={within} onChange={(e) => setWithin(Number(e.target.value))} style={{ width: 'auto' }}>
        {[me.store.settings.expiryAlertDays, 30, 90].map((d) => (
          <option key={d} value={d}>
            {t('stock.expiring')}: {d} {t('common.days')}
          </option>
        ))}
        <option value={-1}>{t('common.all')}</option>
      </select>
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} />
      {q.data?.length === 0 && <Empty />}
      <div className="table-wrap">
        <table>
          <tbody>
            {q.data?.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link to={`/products/${l.productId}`}>{l.product}</Link>
                  <div className="muted small">{l.lotCode}</div>
                </td>
                <td>
                  {l.expiresAt ? (
                    <span className={`badge ${l.daysLeft! < 0 ? 'red' : l.daysLeft! <= me.store.settings.expiryAlertDays ? 'gold' : 'gray'}`}>
                      {dayFmt(l.expiresAt)} · {l.daysLeft! < 0 ? t('stock.expired') : t('stock.daysLeft', { count: l.daysLeft! })}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="num">{qtyFmt(l.qtyRemaining)}</td>
                <td>{l.offer && <span className="badge red">{t('pos.offer')} {money(l.offer.offerPrice)}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Moves() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['movements'], queryFn: () => api<Movement[]>('/stock/movements?limit=150') });
  if (q.isLoading) return <Loading />;
  return (
    <div className="card">
      <ErrorBox error={q.error} />
      {q.data?.map((m) => (
        <div key={m.id} className="list-item small">
          <span className="muted">{dateTimeFmt(m.createdAt)}</span>
          <span className="grow">
            <Link to={`/products/${m.productId}`}>{m.product}</Link> · {t(`stock.movementTypes.${m.type}`)}
            {m.reason && <span className="muted"> · {m.reason}</span>}
          </span>
          <span className={m.qty < 0 ? 'error' : 'ok'}>
            {m.qty > 0 ? '+' : ''}
            {qtyFmt(m.qty)}
          </span>
          <span className="muted">{m.user}</span>
        </div>
      ))}
    </div>
  );
}

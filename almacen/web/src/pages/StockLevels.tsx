import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Loading, toast, toNum } from '../components/ui';
import { qtyFmt } from '../lib/format';
import { can, useMe } from '../lib/me';

export type Level = 'ok' | 'mid' | 'low' | 'none';
export interface LevelRow {
  productId: string;
  name: string;
  categoryId: string | null;
  category: string | null;
  unit: 'UNIT' | 'KG';
  stock: number;
  idealStock: number | null;
  refStock: number | null;
  perDay: number;
  pct: number | null;
  ref: number | null;
  daysLeft: number | null;
  level: Level;
}

export function LevelBar({ pct, level }: { pct: number | null; level: Level }) {
  return (
    <div className={`level-bar level-${level}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
      <span style={{ width: `${pct ?? 0}%` }} />
    </div>
  );
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Stock en %: de un vistazo, qué se está terminando. */
export function StockLevels() {
  const me = useMe();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['stock-levels'], queryFn: () => api<LevelRow[]>('/stock/levels') });
  const [term, setTerm] = useState('');
  const [cat, setCat] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [ideal, setIdeal] = useState('');

  const all = q.data ?? [];
  const cats = useMemo(
    () => [...new Map(all.filter((r) => r.categoryId).map((r) => [r.categoryId!, r.category ?? ''])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [all],
  );
  const rows = all.filter((r) => (!onlyLow || r.level === 'low') && (!cat || r.categoryId === cat) && (!term || norm(r.name).includes(norm(term))));
  const lowCount = all.filter((r) => r.level === 'low').length;

  const days = (n: number) => (n === 0 ? t('levels.endsToday') : n === 1 ? t('levels.oneDay') : t('levels.daysLeft', { count: n }));
  const saveIdeal = async (r: LevelRow) => {
    const v = ideal.trim() === '' ? null : toNum(ideal);
    if (v != null && v < 0) return;
    try {
      await api(`/products/${r.productId}`, { method: 'PATCH', body: { idealStock: v } });
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ['stock-levels'] });
    } catch (e) {
      toast(errMsg(e));
    }
  };

  return (
    <div className="stack">
      <h1>{t('levels.title')}</h1>
      <p className="muted">{t('levels.help', { pct: me.store.settings.lowStockPct })}</p>
      <div className="row">
        <input type="search" className="grow" placeholder={t('common.search')} value={term} onChange={(e) => setTerm(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t('products.category')}>
          <option value="">{t('levels.allCategories')}</option>
          {cats.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <label className="row small">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
          {t('levels.onlyLow', { count: lowCount })}
        </label>
      </div>
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} />
      {q.data && rows.length === 0 && <Empty text={t('levels.none')} />}
      {rows.length > 0 && (
        <div className="card">
          {rows.map((r) => (
            <div className="list-item" key={r.productId}>
              <div className="grow">
                <div className="row between">
                  <Link to={`/products/${r.productId}`}>{r.name}</Link>
                  <strong className={`level-text-${r.level}`}>{r.pct == null ? '—' : `${r.pct}%`}</strong>
                </div>
                <LevelBar pct={r.pct} level={r.level} />
                <div className="muted small">
                  {r.ref != null ? t('levels.of', { stock: qtyFmt(r.stock), ref: qtyFmt(r.ref) }) : `${t('products.stock')}: ${qtyFmt(r.stock)}`}
                  {r.daysLeft != null && ` · ${days(r.daysLeft)}`}
                  {' · '}
                  {r.idealStock != null ? t('levels.manual') : r.refStock != null ? t('levels.auto') : t('levels.noRef')}
                </div>
              </div>
              {can(me, 'stock') &&
                (editing === r.productId ? (
                  <div className="row small">
                    <input
                      style={{ width: 80 }}
                      inputMode="decimal"
                      aria-label={t('levels.ideal')}
                      placeholder={t('levels.autoShort')}
                      value={ideal}
                      onChange={(e) => setIdeal(e.target.value)}
                      autoFocus
                    />
                    <button type="button" className="primary" onClick={() => void saveIdeal(r)}>
                      ✓
                    </button>
                    <button type="button" onClick={() => setEditing(null)} aria-label={t('common.cancel')}>
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="small"
                    onClick={() => {
                      setEditing(r.productId);
                      setIdeal(r.idealStock == null ? '' : String(r.idealStock));
                    }}
                  >
                    {t('levels.setIdeal')}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

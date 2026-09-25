import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Empty, ErrorBox, Loading } from '../components/ui';
import { dateTimeFmt, dayFmt, money, qtyFmt } from '../lib/format';
import type { AlertRow } from '../lib/types';

/** Texto del aviso en el idioma de quien lo mira (se arma con los datos guardados). */
export function useAlertText() {
  const { t } = useTranslation();
  return (a: AlertRow) => {
    const d = a.data;
    const n = (k: string) => Number(d[k] ?? 0);
    const vars = {
      name: String(d.name ?? ''),
      date: dayFmt(String(d.date ?? '')),
      qty: qtyFmt(n('qty')),
      stock: qtyFmt(n('stock')),
      min: qtyFmt(n('min')),
      count: n('count'),
      diff: money(n('diff')),
      expected: qtyFmt(n('expected')),
      counted: qtyFmt(n('counted')),
      price: money(n('price')),
      pct: n('pct'),
      minutes: n('minutes'),
      start: String(d.start ?? ''),
      by: String(d.by ?? ''),
    };
    return t(`alerts.types.${a.type === 'LOW_STOCK' && d.pct != null ? 'LOW_STOCK_PCT' : a.type}`, vars);
  };
}

export function alertLink(a: AlertRow) {
  if (a.type === 'OFFER_SUGGESTED') return '/offers';
  if (a.type === 'CASH_DIFF' || a.type === 'VOID_SPIKE') return '/sales';
  if (a.type === 'LATE' || a.type === 'ABSENT') return '/attendance';
  if (a.type === 'SHORTAGE') return '/reorder';
  return a.data.productId ? `/products/${a.data.productId}` : null;
}

export function Alerts() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const text = useAlertText();
  const q = useQuery({ queryKey: ['alerts'], queryFn: () => api<AlertRow[]>('/alerts') });
  const resolve = async (id: string) => {
    await api(`/alerts/${id}/resolve`, { method: 'POST' });
    void qc.invalidateQueries({ queryKey: ['alerts'] });
  };
  return (
    <div className="stack">
      <h1>{t('alerts.title')}</h1>
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} />
      {q.data?.length === 0 && <Empty text={t('alerts.none')} />}
      {q.data?.map((a) => {
        const link = alertLink(a);
        const color = a.severity === 'danger' ? 'var(--danger)' : a.severity === 'warn' ? 'var(--warn)' : 'var(--line)';
        return (
          <div key={a.id} className="card row between" style={{ borderLeft: `4px solid ${color}` }}>
            <div className="grow">
              {link ? <Link to={link}>{text(a)}</Link> : text(a)}
              <div className="muted small">{dateTimeFmt(a.createdAt)}</div>
            </div>
            <button className="small" onClick={() => void resolve(a.id)}>
              {t('alerts.resolve')}
            </button>
          </div>
        );
      })}
    </div>
  );
}

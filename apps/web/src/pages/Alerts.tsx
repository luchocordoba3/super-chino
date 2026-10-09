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
      imei: String(d.imei ?? ''),
      days: n('days'),
      number: n('number'),
      device: String(d.device ?? ''),
      amount: d.currency === 'USD' && d.fx ? `US$ ${n('fx')}` : money(n('amount')),
      detail: CONFLICTS[String(d.kind)] ? `${CONFLICTS[String(d.kind)]}${d.name ? ` · ${d.name}` : ''}${d.imei ? ` (${d.imei})` : ''}` : String(d.kind ?? ''),
    };
    return t(`alerts.types.${a.type}`, vars);
  };
}

/** Qué pasó al sincronizar una venta de la casa de celulares. */
const CONFLICTS: Record<string, string> = {
  serial_not_available: 'se vendió un equipo que no estaba disponible',
  sold_without_imei: 'se vendió un celular sin indicar el IMEI',
  trade_in_credit: 'el crédito de un usado ya se había usado',
  trade_in_paid_twice: 'se pagó dos veces un usado',
  deposit: 'la seña ya se había usado o venció',
  deposit_serial_not_available: 'se señó un equipo que no estaba disponible',
  repair_paid_twice: 'se cobró dos veces una reparación',
};

export function alertLink(a: AlertRow) {
  if (a.type === 'REPAIR_STUCK' || a.type === 'REPAIR_NOT_PICKED') return `/repairs/${a.data.repairId}`;
  if (a.type === 'UNIT_AGING') return `/serials/${a.data.serialItemId}`;
  if (a.type === 'DEPOSIT_EXPIRED') return '/deposits';
  if (a.type === 'COURIER_DIFF') return '/deliveries';
  if (a.type === 'RATE_STALE') return '/settings';
  if (a.type === 'UNIT_CONFLICT') return '/sales';
  if (a.type === 'OFFER_SUGGESTED') return '/offers';
  if (a.type === 'CASH_DIFF' || a.type === 'VOID_SPIKE') return '/sales';
  if (a.type === 'LATE' || a.type === 'ABSENT') return '/attendance';
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

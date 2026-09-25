import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { PaymentMethod } from '@almacen/shared';
import { api } from '../api';
import { ErrorBox, Loading } from '../components/ui';
import { dayFmt, money, qtyFmt, timeFmt } from '../lib/format';

interface Dash {
  today: { total: number; count: number; avgTicket: number; profit: number; byMethod: Partial<Record<PaymentMethod, number>>; byCashier: { name: string; total: number; count: number }[] };
  topProducts: { productId: string; name: string; qty: number; total: number }[];
  alerts: Partial<Record<'info' | 'warn' | 'danger', number>>;
  expiringLots: number;
  suggestedOffers: number;
  savedThisMonth: number;
  wasteThisMonth: number;
  voidsToday: Partial<Record<'ITEM_REMOVED' | 'SALE_VOIDED', number>>;
  week: { date: string; total: number }[];
  staff: {
    working: { userId: string; name: string; since: string; lateMin: number | null }[];
    late: { userId: string; name: string; minutes: number }[];
    absent: { userId: string; name: string; start: string }[];
  };
}

export function Dashboard() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dash>('/dashboard'), refetchInterval: 60_000 });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const d = q.data;
  const alertCount = (d.alerts.danger ?? 0) + (d.alerts.warn ?? 0) + (d.alerts.info ?? 0);
  const stat = (label: string, value: string, to?: string, danger = false) => {
    const body = (
      <div className="stat">
        <div className={`v ${danger ? 'error' : ''}`}>{value}</div>
        <div className="l">{label}</div>
      </div>
    );
    return to ? (
      <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>
        {body}
      </Link>
    ) : (
      body
    );
  };
  return (
    <div className="stack">
      <div className="grid2">
        {stat(t('dashboard.salesToday'), money(d.today.total), '/sales')}
        {stat(t('dashboard.tickets'), String(d.today.count))}
        {stat(t('dashboard.avgTicket'), money(d.today.avgTicket))}
        {stat(t('dashboard.profit'), money(d.today.profit))}
        {stat(t('dashboard.openAlerts'), String(alertCount), '/alerts', (d.alerts.danger ?? 0) > 0)}
        {stat(t('dashboard.expiringSoon'), String(d.expiringLots), '/stock')}
        {stat(t('dashboard.suggestedOffers'), String(d.suggestedOffers), '/offers')}
        {stat(t('dashboard.savedThisMonth'), money(d.savedThisMonth), '/offers')}
        {stat(t('dashboard.wasteThisMonth'), money(d.wasteThisMonth))}
      </div>
      <div className="grid2">
        <Link className="card" to="/attendance" style={{ color: 'inherit' }}>
          <h3>🕘 {t('dashboard.workingNow')}</h3>
          {d.staff.working.length === 0 && <p className="muted">{t('dashboard.nobodyWorking')}</p>}
          {d.staff.working.map((w) => (
            <div className="row between" key={w.userId}>
              <span>{w.name}</span>
              <span className="muted small">{t('attendance.since', { time: timeFmt(w.since) })}</span>
            </div>
          ))}
          {d.staff.late.length > 0 && <p className="small">⚠️ {t('dashboard.lateNow', { names: d.staff.late.map((l) => `${l.name} (${l.minutes}')`).join(', ') })}</p>}
          {d.staff.absent.length > 0 && <p className="small error">⛔ {t('dashboard.absentNow', { names: d.staff.absent.map((a) => a.name).join(', ') })}</p>}
        </Link>
        <div className="card">
          <h3>{t('dashboard.byMethod')}</h3>
          {Object.entries(d.today.byMethod).map(([m, v]) => (
            <div className="row between" key={m}>
              <span>{t(`pos.methods.${m as PaymentMethod}`)}</span>
              <strong>{money(v)}</strong>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>{t('dashboard.byCashier')}</h3>
          {d.today.byCashier.map((c) => (
            <div className="row between" key={c.name}>
              <span>
                {c.name} <span className="muted small">({c.count})</span>
              </span>
              <strong>{money(c.total)}</strong>
            </div>
          ))}
          {(d.voidsToday.ITEM_REMOVED || d.voidsToday.SALE_VOIDED) && (
            <p className="small warn">
              {t('dashboard.removedItems', { count: d.voidsToday.ITEM_REMOVED ?? 0 })} · {t('dashboard.voidedSales', { count: d.voidsToday.SALE_VOIDED ?? 0 })}
            </p>
          )}
        </div>
        <div className="card">
          <h3>{t('dashboard.topProducts')}</h3>
          {d.topProducts.map((p) => (
            <div className="row between" key={p.productId}>
              <Link to={`/products/${p.productId}`}>{p.name}</Link>
              <span className="muted" style={{ whiteSpace: 'nowrap' }}>
                {qtyFmt(p.qty)} · {money(p.total)}
              </span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>{t('nav.sales')} · 7 {t('common.days')}</h3>
          {d.week.map((w) => (
            <div className="row between" key={w.date}>
              <span className="muted">{dayFmt(w.date)}</span>
              <strong>{money(w.total)}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

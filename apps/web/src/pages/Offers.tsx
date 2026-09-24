import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Loading, toast, toNum } from '../components/ui';
import { dayFmt, money, qtyFmt } from '../lib/format';
import { useMe } from '../lib/me';
import type { OfferRow } from '../lib/types';

export function shareText(storeName: string, offers: OfferRow[], title: string) {
  return [`${title} · ${storeName}`, ...offers.map((o) => `• ${o.name}: ${money(o.listPrice)} → ${money(o.offerPrice)}`)].join('\n');
}

export async function shareOffers(text: string) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch {
      // cancelado: se ofrece WhatsApp
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

export function Offers() {
  const me = useMe();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['offers'], queryFn: () => api<OfferRow[]>('/offers') });
  const summary = useQuery({ queryKey: ['offers', 'summary'], queryFn: () => api<{ savedThisMonth: number }>('/offers/summary') });
  const act = async (id: string, action: 'approve' | 'dismiss' | 'end') => {
    try {
      await api(`/offers/${id}/${action}`, { method: 'POST' });
      void qc.invalidateQueries({ queryKey: ['offers'] });
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    } catch (e) {
      toast(errMsg(e));
    }
  };
  const edit = async (o: OfferRow) => {
    const v = toNum(window.prompt(t('offers.offerPrice'), String(o.offerPrice)) ?? '');
    if (v == null) return;
    try {
      await api(`/offers/${o.id}`, { method: 'PATCH', body: { offerPrice: v } });
      void qc.invalidateQueries({ queryKey: ['offers'] });
    } catch (e) {
      toast(errMsg(e));
    }
  };
  const active = q.data?.filter((o) => o.status === 'ACTIVE') ?? [];
  const suggested = q.data?.filter((o) => o.status === 'SUGGESTED') ?? [];

  const card = (o: OfferRow) => (
    <div key={o.id} className="card stack">
      <div className="row between">
        <Link to={`/products/${o.productId}`}>
          <strong>{o.name}</strong>
        </Link>
        <span className={`badge ${o.daysLeft != null && o.daysLeft <= 1 ? 'red' : 'gold'}`}>
          {dayFmt(o.expiresAt)} · {t('offers.expiresIn', { count: o.daysLeft ?? 0 })}
        </span>
      </div>
      <div className="row">
        <span className="muted" style={{ textDecoration: 'line-through' }}>
          {money(o.listPrice)}
        </span>
        <strong style={{ fontSize: '1.4rem', color: 'var(--red)' }}>{money(o.offerPrice)}</strong>
        <span className="badge red">-{o.discountPct}%</span>
        <span className="muted small">{o.lotCode}</span>
      </div>
      {o.reason?.qty != null && (
        <div className="small muted">{t('offers.reason', { qty: qtyFmt(o.reason.qty), perDay: qtyFmt(o.reason.perDay ?? 0), days: o.reason.days ?? 0 })}</div>
      )}
      {o.status === 'ACTIVE' && <div className="small">{t('offers.sold', { qty: qtyFmt(o.soldQty) })}</div>}
      <div className="row">
        {o.status === 'SUGGESTED' && (
          <>
            <button className="primary small" onClick={() => void act(o.id, 'approve')}>
              ✓ {t('offers.approve')}
            </button>
            <button className="small" onClick={() => void act(o.id, 'dismiss')}>
              {t('offers.dismiss')}
            </button>
          </>
        )}
        {o.status === 'ACTIVE' && (
          <button className="small" onClick={() => void act(o.id, 'end')}>
            {t('offers.end')}
          </button>
        )}
        <button className="small ghost" onClick={() => void edit(o)}>
          {t('common.edit')} $
        </button>
      </div>
    </div>
  );

  return (
    <div className="stack">
      <h1>{t('offers.title')}</h1>
      {summary.data && <p className="card ok">{t('offers.savedTotal', { amount: money(summary.data.savedThisMonth) })}</p>}
      {active.length > 0 && (
        <div className="row">
          <Link className="btn" to="/offers/print">
            🖨 {t('offers.printSign')}
          </Link>
          <button onClick={() => void shareOffers(shareText(me.store.name, active, t('offers.todaysOffers')))}>📲 {t('offers.shareWhatsapp')}</button>
        </div>
      )}
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} />
      {q.data?.length === 0 && <Empty text={t('offers.none')} />}
      {suggested.length > 0 && <h2>{t('offers.suggested')}</h2>}
      {suggested.map(card)}
      {active.length > 0 && <h2>{t('offers.active')}</h2>}
      {active.map(card)}
    </div>
  );
}

/** Cartel "Ofertas del día" para imprimir y pegar en la vidriera. */
export function OffersPrint() {
  const me = useMe();
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['offers', 'ACTIVE'], queryFn: () => api<OfferRow[]>('/offers?status=ACTIVE') });
  return (
    <div>
      <div className="row no-print" style={{ padding: 12 }}>
        <Link className="btn" to="/offers">
          ← {t('common.back')}
        </Link>
        <button className="primary" onClick={() => window.print()}>
          🖨 {t('common.print')}
        </button>
      </div>
      <div className="sign print-area">
        <h1>{t('offers.todaysOffers')}</h1>
        <p style={{ textAlign: 'center', fontSize: '1.3rem' }}>{me.store.name}</p>
        {q.data?.map((o) => (
          <div className="sign-item" key={o.id}>
            <span>{o.name}</span>
            <span>
              <span className="old">{money(o.listPrice)}</span>
              <span className="new">{money(o.offerPrice)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

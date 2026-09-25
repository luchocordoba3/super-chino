import { type FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Field, Loading, toast } from '../components/ui';
import { money, qtyFmt, timeFmt } from '../lib/format';
import { useMe } from '../lib/me';

export type OrderStatus = 'NEW' | 'PREPARING' | 'READY' | 'DELIVERED' | 'CANCELLED';
export interface OrderRow {
  id: string;
  number: number;
  name: string;
  phone: string;
  delivery: boolean;
  address: string | null;
  payment: 'CASH' | 'QR' | 'TRANSFER';
  note: string | null;
  status: OrderStatus;
  total: number;
  createdAt: string;
  items: { productId: string; name: string; qty: number; unitPrice: number }[];
}
export const openOrderCount = (orders: OrderRow[] | undefined) => (orders ?? []).filter((o) => ['NEW', 'PREPARING', 'READY'].includes(o.status)).length;

/** Número para wa.me: si el cliente no puso el código de país, se asume Argentina (549 + área + número). */
export const waNumber = (phone: string) => {
  const d = phone.replace(/\D/g, '').replace(/^0/, '');
  return d.startsWith('54') ? d : d.length === 10 ? `549${d}` : d;
};
const readyText = (o: OrderRow) =>
  `Hola ${o.name}! Tu pedido N° ${o.number} está listo${o.delivery ? ' y sale para tu casa' : ' para retirar'}. Total: ${money(o.total)}. ¡Gracias!`;

/** Pedidos por WhatsApp: se usan en el celular del equipo y en la caja (que además los cobra). */
export function OrdersList({ orders, onStatus, onCharge }: { orders: OrderRow[]; onStatus: (id: string, status: OrderStatus) => Promise<unknown>; onCharge?: (o: OrderRow) => void }) {
  const { t } = useTranslation();
  const act = (id: string, status: OrderStatus) => void onStatus(id, status).catch((e) => toast(errMsg(e)));
  if (orders.length === 0) return <Empty text={t('orders.none')} />;
  return (
    <div className="stack">
      {orders.map((o) => {
        const closed = o.status === 'DELIVERED' || o.status === 'CANCELLED';
        return (
          <div className={`card stack order order-${o.status.toLowerCase()}`} key={o.id}>
            <div className="row between">
              <strong>
                N° {o.number} · {o.name}
              </strong>
              <span className="badge">{t(`orders.status.${o.status}`)}</span>
            </div>
            <div className="muted small">
              {timeFmt(o.createdAt)} · {o.delivery ? `🛵 ${o.address}` : `🏪 ${t('orders.pickup')}`} · {t(`shop.payments.${o.payment}`)}
            </div>
            {o.items.map((i) => (
              <div className="row between small" key={i.productId}>
                <span>
                  {qtyFmt(i.qty)} × {i.name}
                </span>
                <span>{money(i.qty * i.unitPrice)}</span>
              </div>
            ))}
            {o.note && <div className="small">📝 {o.note}</div>}
            <div className="row between">
              <strong>{money(o.total)}</strong>
              {!closed && (
                <div className="row">
                  {o.status === 'NEW' && (
                    <button type="button" onClick={() => act(o.id, 'PREPARING')}>
                      {t('orders.prepare')}
                    </button>
                  )}
                  {o.status !== 'READY' && (
                    <a
                      className="btn btn-primary"
                      href={`https://wa.me/${waNumber(o.phone)}?text=${encodeURIComponent(readyText(o))}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => act(o.id, 'READY')}
                    >
                      ✅ {t('orders.ready')}
                    </a>
                  )}
                  {o.status === 'READY' && (
                    <a className="btn" href={`https://wa.me/${waNumber(o.phone)}?text=${encodeURIComponent(readyText(o))}`} target="_blank" rel="noreferrer">
                      📲 {t('orders.notify')}
                    </a>
                  )}
                  {onCharge && (
                    <button type="button" className="primary" onClick={() => onCharge(o)}>
                      {t('orders.charge')}
                    </button>
                  )}
                  <button type="button" className="ghost small" onClick={() => window.confirm(t('orders.cancelConfirm', { number: o.number })) && act(o.id, 'CANCELLED')}>
                    {t('common.cancel')}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Pantalla "Pedidos" del equipo (celular o PC). */
export function Orders() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['orders'], queryFn: () => api<OrderRow[]>('/orders'), refetchInterval: 15_000 });
  const onStatus = async (id: string, status: OrderStatus) => {
    await api(`/orders/${id}/status`, { method: 'POST', body: { status } });
    await qc.invalidateQueries({ queryKey: ['orders'] });
  };
  return (
    <div className="stack">
      <h1>{t('orders.title')}</h1>
      <p className="muted small">{t('orders.help')}</p>
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} />
      {q.data && <OrdersList orders={q.data} onStatus={onStatus} />}
    </div>
  );
}

/** Ajustes → Pedidos por WhatsApp: el link del local, el número y si hay envíos. */
export function ShopSettings() {
  const me = useMe();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const link = useQuery({ queryKey: ['shop-link'], queryFn: () => api<{ path: string | null }>('/shop') });
  const s = me.store.settings;
  const [f, setF] = useState({ shopWhatsapp: s.shopWhatsapp, shopDelivery: s.shopDelivery, shopNote: s.shopNote });
  const url = link.data?.path ? window.location.origin + link.data.path : null;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await Promise.all([qc.invalidateQueries({ queryKey: ['shop-link'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
    } catch (e) {
      toast(errMsg(e));
    }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/store', { method: 'PATCH', body: { settings: { ...s, ...f, shopWhatsapp: f.shopWhatsapp.replace(/\D/g, '') } } });
      toast(t('common.saved'));
    });
  };
  const share = url ? `https://wa.me/?text=${encodeURIComponent(t('shop.shareText', { store: me.store.name, url }))}` : '';
  return (
    <div className="card stack">
      <h2>🛵 {t('shop.settingsTitle')}</h2>
      <p className="muted small">{t('shop.settingsHelp')}</p>
      <form className="stack" onSubmit={save}>
        <Field label={t('shop.whatsappLabel')} hint={t('shop.whatsappHint')}>
          <input value={f.shopWhatsapp} inputMode="tel" onChange={(e) => setF({ ...f, shopWhatsapp: e.target.value })} placeholder="5493415551234" />
        </Field>
        <label className="row">
          <input type="checkbox" checked={f.shopDelivery} onChange={(e) => setF({ ...f, shopDelivery: e.target.checked })} /> {t('shop.deliveryLabel')}
        </label>
        <Field label={t('shop.noteLabel')}>
          <input value={f.shopNote} maxLength={200} onChange={(e) => setF({ ...f, shopNote: e.target.value })} placeholder={t('shop.notePlaceholder')} />
        </Field>
        <button className="primary">{t('shop.saveSettings')}</button>
      </form>
      {url ? (
        <>
          <input readOnly value={url} aria-label={t('shop.link')} onFocus={(e) => e.target.select()} />
          <div className="row">
            <a className="btn btn-primary" href={share} target="_blank" rel="noreferrer">
              📲 {t('shop.share')}
            </a>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(url).then(() => toast(t('shop.copied')))}>
              {t('shop.copy')}
            </button>
            <button type="button" className="small" onClick={() => window.confirm(t('shop.renewConfirm')) && void run(() => api('/shop', { method: 'POST', body: { renew: true } }))}>
              {t('shop.renew')}
            </button>
            <button type="button" className="small danger" onClick={() => void run(() => api('/shop', { method: 'DELETE' }))}>
              {t('shop.disable')}
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="primary" onClick={() => void run(() => api('/shop', { method: 'POST', body: {} }))}>
          {t('shop.enable')}
        </button>
      )}
    </div>
  );
}

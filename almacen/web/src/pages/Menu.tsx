import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';
import { Loading, toast } from '../components/ui';
import { money, qtyFmt, setCurrency } from '../lib/format';

interface MenuData {
  store: { name: string; currency: string };
  table: number;
  categories: { id: string; name: string }[];
  products: { id: string; name: string; price: number; unit: 'UNIT' | 'KG'; categoryId: string | null; available: boolean }[];
  tab: { items: { name: string; qty: number; unitPrice: number; pending: boolean }[]; total: number; billRequested: boolean } | null;
  payQr: boolean;
}

/** La carta que abre el cliente con el QR de la mesa: sin cuenta ni app. Pide y el pedido llega a la caja. */
export function MenuPage() {
  const { token = '' } = useParams();
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['menu', token], queryFn: () => api<MenuData>(`/public/menu/${token}`), refetchInterval: 15_000, retry: false });
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setCurrency(q.data.store.currency);
  }, [q.data]);

  if (q.isLoading) return <Loading />;
  const m = q.data;
  if (!m) return <div className="menu center-box card">{t('menu.notFound')}</div>;

  const shown = cat ? m.products.filter((p) => p.categoryId === cat) : m.products;
  const lines = m.products.filter((p) => cart[p.id]).map((p) => ({ ...p, qty: cart[p.id] }));
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const setQty = (id: string, qty: number) => setCart(({ [id]: _old, ...rest }) => (qty > 0 ? { ...rest, [id]: Math.min(20, qty) } : rest));

  const run = async (f: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await f();
      toast(ok);
      await q.refetch();
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const order = () =>
    run(async () => {
      await api(`/public/menu/${token}/order`, { method: 'POST', body: { items: lines.map((l) => ({ productId: l.id, qty: l.qty })) } });
      setCart({});
    }, t('menu.sent'));

  return (
    <div className="menu">
      <header className="menu-head">
        <div className="menu-store">{m.store.name}</div>
        <div className="menu-table">{t('menu.table', { n: m.table })}</div>
      </header>
      {m.categories.length > 1 && (
        <div className="pos-quick-cats">
          <button type="button" className={cat === '' ? 'active' : ''} onClick={() => setCat('')}>
            {t('pos.quickAll')}
          </button>
          {m.categories.map((c) => (
            <button type="button" key={c.id} className={cat === c.id ? 'active' : ''} onClick={() => setCat(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}
      <div className="card">
        {shown.map((p) => (
          <div className={`list-item menu-item ${p.available ? '' : 'off'}`} key={p.id}>
            <div className="grow">
              <div className="n">{p.name}</div>
              <div className="muted">
                {money(p.price)}
                {p.unit === 'KG' ? ' / kg' : ''}
              </div>
            </div>
            {!p.available ? (
              <span className="muted small">{t('menu.soldOut')}</span>
            ) : cart[p.id] ? (
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <button type="button" onClick={() => setQty(p.id, cart[p.id] - 1)} aria-label={`− ${p.name}`}>
                  −
                </button>
                <strong>{cart[p.id]}</strong>
                <button type="button" onClick={() => setQty(p.id, cart[p.id] + 1)} aria-label={`+ ${p.name}`}>
                  +
                </button>
              </div>
            ) : (
              <button type="button" className="primary" onClick={() => setQty(p.id, 1)} aria-label={`${t('menu.add')} ${p.name}`}>
                {t('menu.add')}
              </button>
            )}
          </div>
        ))}
      </div>

      {m.tab && (
        <div className="card stack">
          <h2>{t('menu.yourTab')}</h2>
          {m.tab.items.map((i, k) => (
            <div className="row between" key={k}>
              <span>
                {qtyFmt(i.qty)} × {i.name} {i.pending && <span className="badge gold">{t('menu.pending')}</span>}
              </span>
              <span>{money(i.qty * i.unitPrice)}</span>
            </div>
          ))}
          <div className="row between">
            <strong>{t('common.total')}</strong>
            <strong>{money(m.tab.total)}</strong>
          </div>
          {m.payQr && <p className="hint">💳 {t('menu.payHint')}</p>}
          <button type="button" disabled={busy || m.tab.billRequested} onClick={() => void run(() => api(`/public/menu/${token}/bill`, { method: 'POST' }), t('menu.billSent'))}>
            🧾 {m.tab.billRequested ? t('menu.billRequested') : t('menu.askBill')}
          </button>
        </div>
      )}

      {count > 0 && (
        <div className="menu-cartbar">
          <span>
            {t('menu.cart', { count })} · <strong>{money(total)}</strong>
          </span>
          <button type="button" className="primary" disabled={busy} onClick={() => void order()}>
            {t('menu.order')}
          </button>
        </div>
      )}
    </div>
  );
}

import { type FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';
import { Field, Loading, toast } from '../components/ui';
import { money, qtyFmt, setCurrency } from '../lib/format';

interface ShopData {
  store: { name: string; currency: string };
  whatsapp: string;
  delivery: boolean;
  note: string;
  categories: { id: string; name: string }[];
  products: { id: string; name: string; price: number; unit: 'UNIT' | 'KG'; categoryId: string | null; available: boolean }[];
}
type Payment = 'CASH' | 'QR' | 'TRANSFER';
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const step = (unit: 'UNIT' | 'KG') => (unit === 'KG' ? 0.25 : 1);

/** Texto del pedido para WhatsApp (siempre en español: lo lee el local). */
export function orderText(a: { number: number; name: string; lines: { name: string; qty: number; unit: 'UNIT' | 'KG' }[]; total: number; delivery: boolean; address?: string; payment: string; note?: string }) {
  return [
    `Hola! Soy ${a.name}. Te hago el pedido N° ${a.number}:`,
    ...a.lines.map((l) => `• ${l.unit === 'KG' ? `${qtyFmt(l.qty)} kg de` : `${l.qty} ×`} ${l.name}`),
    `Total: ${money(a.total)}`,
    a.delivery ? `Envío a: ${a.address}` : 'Lo retiro en el local',
    `Pago: ${a.payment}`,
    ...(a.note ? [`Nota: ${a.note}`] : []),
  ].join('\n');
}

/** Link público del local: el cliente arma el pedido y lo manda por WhatsApp; llega a la caja. */
export function ShopPage() {
  const { slug = '' } = useParams();
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['shop', slug], queryFn: () => api<ShopData>(`/public/shop/${slug}`), retry: false });
  const key = `shop.cart.${slug}`;
  const [cart, setCart] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(cart));
    } catch {
      // sin localStorage: el carrito queda en memoria
    }
  }, [cart, key]);
  const [term, setTerm] = useState('');
  const [cat, setCat] = useState('');
  const [checkout, setCheckout] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', delivery: true, address: '', payment: 'CASH' as Payment, note: '' });
  const [done, setDone] = useState<{ number: number; total: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setCurrency(q.data.store.currency);
  }, [q.data]);

  if (q.isLoading) return <Loading />;
  const s = q.data;
  if (!s) return <div className="menu center-box card">{t('shop.notFound')}</div>;
  const delivery = s.delivery && form.delivery;
  const lines = s.products.filter((p) => cart[p.id]).map((p) => ({ ...p, qty: cart[p.id] }));
  const total = Math.round(lines.reduce((a, l) => a + l.qty * l.price, 0) * 100) / 100;
  const setQty = (id: string, qty: number) => setCart(({ [id]: _old, ...rest }) => (qty > 0 ? { ...rest, [id]: Math.round(qty * 1000) / 1000 } : rest));
  const shown = s.products.filter((p) => (!cat || p.categoryId === cat) && (!term || norm(p.name).includes(norm(term))));
  const payLabel = (p: Payment) => t(`shop.payments.${p}`);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ number: number; total: number }>(`/public/shop/${slug}/orders`, {
        method: 'POST',
        body: { name: form.name, phone: form.phone, delivery, address: delivery ? form.address : undefined, payment: form.payment, note: form.note || undefined, items: lines.map((l) => ({ productId: l.id, qty: l.qty })) },
      });
      const text = orderText({ number: r.number, name: form.name, lines, total: r.total, delivery, address: form.address, payment: payLabel(form.payment), note: form.note });
      setDone({ number: r.number, total: r.total, text });
      setCart({});
    } catch (err) {
      toast(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="menu">
        <div className="card stack" style={{ textAlign: 'center' }}>
          <h1>✅ {t('shop.doneTitle', { number: done.number })}</h1>
          <p>{t('shop.doneHelp')}</p>
          <div className="pos-total">{money(done.total)}</div>
          {s.whatsapp && (
            <a className="btn btn-primary" href={`https://wa.me/${s.whatsapp}?text=${encodeURIComponent(done.text)}`} target="_blank" rel="noreferrer">
              📲 {t('shop.sendWhatsapp')}
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="menu">
      <header className="menu-head">
        <div className="menu-store">{s.store.name}</div>
        <div className="menu-table">{t('shop.subtitle')}</div>
      </header>
      {s.note && <p className="card small">ℹ️ {s.note}</p>}
      {!checkout ? (
        <>
          <input type="search" placeholder={t('common.search')} value={term} onChange={(e) => setTerm(e.target.value)} />
          {s.categories.length > 1 && (
            <div className="pos-quick-cats">
              <button type="button" className={cat === '' ? 'active' : ''} onClick={() => setCat('')}>
                {t('pos.quickAll')}
              </button>
              {s.categories.map((c) => (
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
                    <button type="button" onClick={() => setQty(p.id, cart[p.id] - step(p.unit))} aria-label={`− ${p.name}`}>
                      −
                    </button>
                    <strong>
                      {qtyFmt(cart[p.id])}
                      {p.unit === 'KG' ? ' kg' : ''}
                    </strong>
                    <button type="button" onClick={() => setQty(p.id, cart[p.id] + step(p.unit))} aria-label={`+ ${p.name}`}>
                      +
                    </button>
                  </div>
                ) : (
                  <button type="button" className="primary" onClick={() => setQty(p.id, p.unit === 'KG' ? 0.5 : 1)} aria-label={`${t('menu.add')} ${p.name}`}>
                    {t('menu.add')}
                  </button>
                )}
              </div>
            ))}
          </div>
          {lines.length > 0 && (
            <div className="menu-cartbar">
              <span>
                {t('menu.cart', { count: lines.length })} · <strong>{money(total)}</strong>
              </span>
              <button type="button" className="primary" onClick={() => setCheckout(true)}>
                {t('shop.continue')}
              </button>
            </div>
          )}
        </>
      ) : (
        <form className="card stack" onSubmit={(e) => void submit(e)}>
          <button type="button" className="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setCheckout(false)}>
            ← {t('shop.back')}
          </button>
          {lines.map((l) => (
            <div className="row between" key={l.id}>
              <span>
                {qtyFmt(l.qty)}
                {l.unit === 'KG' ? ' kg' : ' ×'} {l.name}
              </span>
              <span>{money(l.qty * l.price)}</span>
            </div>
          ))}
          <div className="row between">
            <strong>{t('common.total')}</strong>
            <strong>{money(total)}</strong>
          </div>
          <Field label={t('shop.name')}>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={60} autoComplete="name" />
          </Field>
          <Field label={t('shop.phone')}>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required inputMode="tel" autoComplete="tel" />
          </Field>
          {s.delivery && (
            <div className="row">
              <button type="button" className={form.delivery ? 'primary' : ''} onClick={() => setForm({ ...form, delivery: true })}>
                🛵 {t('shop.delivery')}
              </button>
              <button type="button" className={!form.delivery ? 'primary' : ''} onClick={() => setForm({ ...form, delivery: false })}>
                🏪 {t('shop.pickup')}
              </button>
            </div>
          )}
          {delivery && (
            <Field label={t('shop.address')}>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required maxLength={160} autoComplete="street-address" />
            </Field>
          )}
          <Field label={t('shop.payment')}>
            <div className="row">
              {(['CASH', 'QR', 'TRANSFER'] as const).map((p) => (
                <button type="button" key={p} className={form.payment === p ? 'primary' : ''} onClick={() => setForm({ ...form, payment: p })}>
                  {payLabel(p)}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('shop.note')}>
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} />
          </Field>
          <button className="primary big" disabled={busy}>
            {t('shop.place')}
          </button>
        </form>
      )}
    </div>
  );
}

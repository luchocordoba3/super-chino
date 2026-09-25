import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Empty, ErrorBox, Loading, toNum } from '../components/ui';
import { qtyFmt } from '../lib/format';
import { useMe } from '../lib/me';

interface Group {
  supplier: { id: string; name: string; phone: string | null } | null;
  items: { productId: string; name: string; stock: number; perDay: number; qty: number }[];
}

// El pedido va en español: los proveedores son locales.
function orderText(store: string, supplier: string, lines: { name: string; qty: number }[]) {
  return [`Hola ${supplier}, te hago un pedido para ${store}:`, ...lines.map((l) => `• ${l.qty} x ${l.name}`), 'Gracias!'].join('\n');
}

export function Reorder() {
  const me = useMe();
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['reorder'], queryFn: () => api<Group[]>('/reorder') });
  const [qty, setQty] = useState<Record<string, string>>({});
  const value = (i: Group['items'][number]) => toNum(qty[i.productId] ?? String(i.qty)) ?? 0;

  return (
    <div className="stack">
      <h1>{t('reorder.title')}</h1>
      <p className="muted">{t('reorder.help')}</p>
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} />
      {q.data?.length === 0 && <Empty text={t('reorder.none')} />}
      {q.data?.map((g) => {
        const lines = g.items.map((i) => ({ name: i.name, qty: value(i) })).filter((l) => l.qty > 0);
        const url = `https://wa.me/${g.supplier?.phone ?? ''}?text=${encodeURIComponent(orderText(me.store.name, g.supplier?.name ?? '', lines))}`;
        return (
          <div className="card stack" key={g.supplier?.id ?? '-'}>
            <div className="row between">
              <h2>{g.supplier?.name ?? t('reorder.noSupplier')}</h2>
              {g.supplier && (
                <a className="btn btn-primary" href={url} target="_blank" rel="noreferrer">
                  📲 {t('reorder.sendWhatsapp')}
                </a>
              )}
            </div>
            {g.supplier && !g.supplier.phone && (
              <Link className="hint" to="/suppliers">
                {t('reorder.noPhone')} →
              </Link>
            )}
            {g.items.map((i) => (
              <div className="row between list-item" key={i.productId}>
                <span className="grow">
                  <Link to={`/products/${i.productId}`}>{i.name}</Link>
                  <div className="muted small">
                    {t('products.stock')}: {qtyFmt(i.stock)} · {t('reorder.perDay', { qty: qtyFmt(i.perDay) })}
                  </div>
                </span>
                <label className="row small">
                  {t('reorder.order')}
                  <input style={{ width: 80 }} inputMode="decimal" value={qty[i.productId] ?? String(i.qty)} onChange={(e) => setQty({ ...qty, [i.productId]: e.target.value })} />
                </label>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

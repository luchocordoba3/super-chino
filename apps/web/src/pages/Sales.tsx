import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CashMoveKind, Payment } from '@super-chino/shared';
import { api } from '../api';
import { Empty, ErrorBox, Loading, Tabs } from '../components/ui';
import { dateTimeFmt, money, timeFmt, todayISO } from '../lib/format';

interface SaleRow {
  id: string;
  occurredAt: string;
  user: string | null;
  status: 'COMPLETED' | 'VOIDED';
  total: number;
  payments: Payment[];
  items: number;
  voidReason: string | null;
}
interface SessionRow {
  id: string;
  user: string | null;
  openedAt: string;
  closedAt: string | null;
  openingAmount: number;
  expectedAmount: number | null;
  countedAmount: number | null;
  difference: number | null;
  movementsNet: number;
  movements: { id: string; kind: CashMoveKind; amount: number; reason: string | null; supplier: string | null; user: string | null; occurredAt: string }[];
}

export function Sales() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'sales' | 'cash'>('sales');
  const [date, setDate] = useState(todayISO());
  const sales = useQuery({ queryKey: ['sales', date], queryFn: () => api<SaleRow[]>(`/sales?date=${date}`), enabled: tab === 'sales' });
  const sessions = useQuery({ queryKey: ['sales', 'sessions'], queryFn: () => api<SessionRow[]>('/cash-sessions'), enabled: tab === 'cash' });
  const total = sales.data?.filter((s) => s.status === 'COMPLETED').reduce((a, s) => a + s.total, 0) ?? 0;

  return (
    <div className="stack">
      <h1>{t('sales.title')}</h1>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'sales', label: t('sales.title') },
          { id: 'cash', label: t('sales.cashSessions') },
        ]}
      />
      {tab === 'sales' && (
        <>
          <div className="row">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 'auto' }} />
            <strong>
              {t('common.total')}: {money(total)}
            </strong>
          </div>
          {sales.isLoading && <Loading />}
          <ErrorBox error={sales.error} />
          {sales.data?.length === 0 && <Empty />}
          <div className="card table-wrap">
            <table>
              <tbody>
                {sales.data?.map((s) => (
                  <tr key={s.id} style={{ opacity: s.status === 'VOIDED' ? 0.5 : 1 }}>
                    <td className="muted">{timeFmt(s.occurredAt)}</td>
                    <td>{s.user}</td>
                    <td className="small">
                      {s.items} {t('sales.items')} · {s.payments.map((p) => t(`pos.methods.${p.method}`)).join(' + ')}
                    </td>
                    <td className="num">
                      {s.status === 'VOIDED' ? <span className="badge red">{t('sales.voided')}</span> : null} {money(s.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === 'cash' && (
        <div className="card table-wrap">
          {sessions.isLoading && <Loading />}
          <table>
            <thead>
              <tr>
                <th>{t('sales.cashier')}</th>
                <th>{t('common.date')}</th>
                <th className="num">{t('pos.openingAmount')}</th>
                <th className="num">{t('sales.movements')}</th>
                <th className="num">{t('pos.expected')}</th>
                <th className="num">{t('pos.countedAmount')}</th>
                <th className="num">{t('pos.difference')}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.data?.map((s) => (
                <Fragment key={s.id}>
                  <tr>
                    <td>{s.user}</td>
                    <td className="small">
                      {dateTimeFmt(s.openedAt)} {s.closedAt ? `→ ${timeFmt(s.closedAt)}` : <span className="badge gold">{t('sales.open')}</span>}
                    </td>
                    <td className="num">{money(s.openingAmount)}</td>
                    <td className="num">{s.movements.length ? money(s.movementsNet) : '—'}</td>
                    <td className="num">{s.expectedAmount != null ? money(s.expectedAmount) : '—'}</td>
                    <td className="num">{s.countedAmount != null ? money(s.countedAmount) : '—'}</td>
                    <td className={`num ${s.difference ? 'error' : 'ok'}`}>{s.difference != null ? money(s.difference) : '—'}</td>
                  </tr>
                  {s.movements.map((m) => (
                    <tr key={m.id} className="small muted">
                      <td colSpan={7}>
                        💸 {timeFmt(m.occurredAt)} · {t(`pos.moveKinds.${m.kind}`)} {money(m.amount)}
                        {m.supplier ? ` · ${m.supplier}` : ''}
                        {m.reason ? ` · ${m.reason}` : ''}
                        {m.user ? ` (${m.user})` : ''}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

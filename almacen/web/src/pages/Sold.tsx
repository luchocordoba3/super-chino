import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Empty, ErrorBox, Loading, Tabs } from '../components/ui';
import { type CsvCell, downloadCsv } from '../lib/csv';
import { money, qtyFmt, timeFmt, todayISO } from '../lib/format';

type Tot = { total: number; tickets: number };
export interface Shift extends Tot {
  id: string;
  userId: string | null;
  user: string | null;
  openedAt: string | null;
  closedAt: string | null;
}
interface Units {
  from: string;
  to: string;
  days: ({ date: string } & Tot)[];
  shifts: Shift[];
  employees: ({ id: string; name: string } & Tot)[];
  products: { productId: string; name: string; unit: string; category: string | null; qty: number; total: number; byShift: Record<string, number>; byDay: Record<string, number>; byUser: Record<string, number> }[];
}
type Tab = 'shift' | 'day' | 'week';
interface Col {
  key: string;
  label: string;
  sub?: string;
  tot: Tot;
}

const shiftDate = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Lunes a domingo de la semana que contiene `ymd`. */
export function weekOf(ymd: string) {
  const wd = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  const from = shiftDate(ymd, -((wd + 6) % 7));
  return { from, to: shiftDate(from, 6) };
}

/** Qué se vendió: cada producto por turno, por empleado en el día o por día en la semana. */
export function Sold() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('shift');
  const [date, setDate] = useState(todayISO());
  const [userId, setUserId] = useState('');
  const [term, setTerm] = useState('');
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const range = tab === 'week' ? weekOf(date) : { from: date, to: date };
  const uid = tab === 'week' ? userId : '';
  const q = useQuery({
    queryKey: ['units', range.from, range.to, uid],
    queryFn: async () => {
      const r = await api<Units>(`/reports/units?from=${range.from}&to=${range.to}${uid ? `&userId=${uid}` : ''}`);
      if (!uid) setPeople(r.employees.map((e) => ({ id: e.id, name: e.name })));
      return r;
    },
  });
  const locale = i18n.language === 'zh' ? 'zh-CN' : 'es-AR';
  const dayLabel = (ymd: string) => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`));
  const shiftLabel = (s: Shift) => (s.id === '-' ? t('sold.noShift') : (s.user ?? '?'));
  const shiftHours = (s: Shift) => (s.openedAt ? `${timeFmt(s.openedAt)}–${s.closedAt ? timeFmt(s.closedAt) : t('sold.open')}` : undefined);

  const d = q.data;
  const cols: Col[] = !d
    ? []
    : tab === 'shift'
      ? d.shifts.map((s) => ({ key: s.id, label: shiftLabel(s), sub: shiftHours(s), tot: s }))
      : tab === 'day'
        ? d.employees.map((e) => ({ key: e.id, label: e.name, tot: e }))
        : d.days.map((x) => ({ key: x.date, label: dayLabel(x.date), tot: x }));
  const cell = (p: Units['products'][number], key: string) => (tab === 'shift' ? p.byShift : tab === 'day' ? p.byUser : p.byDay)[key] ?? 0;
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const rows = (d?.products ?? []).filter((p) => !term || norm(p.name).includes(norm(term)));
  const total = cols.reduce((a, c) => ({ total: a.total + c.tot.total, tickets: a.tickets + c.tot.tickets }), { total: 0, tickets: 0 });

  const exportCsv = () => {
    const head: CsvCell[] = [t('sold.product'), ...cols.map((c) => (c.sub ? `${c.label} ${c.sub}` : c.label)), t('common.total'), t('sold.amount')];
    const body = rows.map((p) => [p.name, ...cols.map((c) => cell(p, c.key) || null), p.qty, p.total]);
    const foot: CsvCell[] = [t('sold.sales'), ...cols.map((c) => c.tot.total), total.total, null];
    const tickets: CsvCell[] = [t('sold.tickets'), ...cols.map((c) => c.tot.tickets), total.tickets, null];
    downloadCsv(`vendido-${tab === 'shift' ? 'turnos' : tab === 'day' ? 'dia' : 'semana'}-${range.from}.csv`, [head, ...body, foot, tickets]);
  };

  return (
    <div className="stack">
      <h1>{t('sold.title')}</h1>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'shift', label: t('sold.byShift') },
          { id: 'day', label: t('sold.byDay') },
          { id: 'week', label: t('sold.byWeek') },
        ]}
      />
      <p className="muted small">{t(`sold.help.${tab}`)}</p>
      <div className="row">
        <input type="date" aria-label={t('sold.date')} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 'auto' }} />
        {tab === 'week' && (
          <>
            <span className="muted small">
              {dayLabel(range.from)} → {dayLabel(range.to)}
            </span>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label={t('sold.employee')}>
              <option value="">{t('sold.everyone')}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        )}
        <input type="search" className="grow" placeholder={t('common.search')} value={term} onChange={(e) => setTerm(e.target.value)} />
        <button type="button" onClick={exportCsv} disabled={!rows.length}>
          ⬇ {t('sold.excel')}
        </button>
      </div>
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} />
      {d && d.products.length === 0 && <Empty text={t('sold.none')} />}
      {d && d.products.length > 0 && (
        <div className="card table-wrap">
          <table className="units-table">
            <thead>
              <tr>
                <th>{t('sold.product')}</th>
                {cols.map((c) => (
                  <th key={c.key} className="num">
                    {c.label}
                    {c.sub && <div className="muted small">{c.sub}</div>}
                  </th>
                ))}
                <th className="num">{t('common.total')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.productId}>
                  <td>
                    <Link to={`/products/${p.productId}`}>{p.name}</Link>
                  </td>
                  {cols.map((c) => {
                    const v = cell(p, c.key);
                    return (
                      <td key={c.key} className="num">
                        {v ? qtyFmt(v) : <span className="muted">·</span>}
                      </td>
                    );
                  })}
                  <td className="num">
                    <strong>{qtyFmt(p.qty)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th>{t('sold.sales')}</th>
                {cols.map((c) => (
                  <th key={c.key} className="num">
                    {money(c.tot.total)}
                  </th>
                ))}
                <th className="num">{money(total.total)}</th>
              </tr>
              <tr>
                <td className="muted">{t('sold.tickets')}</td>
                {cols.map((c) => (
                  <td key={c.key} className="num muted">
                    {c.tot.tickets}
                  </td>
                ))}
                <td className="num muted">{total.tickets}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

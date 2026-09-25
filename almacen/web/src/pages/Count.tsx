import { type FormEvent, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';
import { ErrorBox, Loading, toast, toNum } from '../components/ui';
import { qtyFmt } from '../lib/format';

interface CountView {
  id: string;
  doneAt: string | null;
  items: { id: string; name: string; unit: 'UNIT' | 'KG'; barcode: string | null; countedQty: number | null; expectedQty: number | null; difference: number | null }[];
}

export function CountPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['count', id], queryFn: () => api<CountView>(`/counts/${id}`) });
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const c = q.data;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/counts/${id}`, { body: { items: c.items.map((i) => ({ id: i.id, countedQty: toNum(values[i.id] ?? '') ?? 0 })) } });
      void qc.invalidateQueries({ queryKey: ['count', id] });
      void qc.invalidateQueries({ queryKey: ['messages'] });
    } catch (err) {
      toast(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (c.doneAt) {
    const diffs = c.items.filter((i) => i.difference);
    return (
      <div className="stack">
        <h1>{t('count.result')}</h1>
        {diffs.length === 0 && <p className="card ok">{t('count.allGood')}</p>}
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th className="num">{t('count.expected')}</th>
                <th className="num">{t('count.counted')}</th>
                <th className="num">{t('count.diff')}</th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td className="num">{qtyFmt(i.expectedQty)}</td>
                  <td className="num">{qtyFmt(i.countedQty)}</td>
                  <td className={`num ${i.difference ? 'error' : 'ok'}`}>{qtyFmt(i.difference)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h1>{t('count.title')}</h1>
      <p className="card">{t('count.blindHelp')}</p>
      {c.items.map((i) => (
        <label className="card row between" key={i.id}>
          <span>
            <strong>{i.name}</strong>
            <div className="muted small">{i.barcode}</div>
          </span>
          <input
            style={{ width: 110, fontSize: '1.2rem' }}
            inputMode="decimal"
            required
            placeholder={i.unit === 'KG' ? 'kg' : '0'}
            value={values[i.id] ?? ''}
            onChange={(e) => setValues({ ...values, [i.id]: e.target.value })}
          />
        </label>
      ))}
      <button className="primary big" disabled={busy}>
        {t('count.submit')}
      </button>
    </form>
  );
}

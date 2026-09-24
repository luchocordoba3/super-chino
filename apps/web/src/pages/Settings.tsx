import { type FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { StoreSettings } from '@super-chino/shared';
import { api, errMsg } from '../api';
import { Field, toast, toNum } from '../components/ui';
import { can, useMe } from '../lib/me';

const NUM_FIELDS = [
  'expiryAlertDays',
  'targetMargin',
  'priceRounding',
  'offerAllowBelowCostDays',
  'voidAlertThreshold',
  'cashDiffThreshold',
  'countItemsPerDay',
  'countDiffThreshold',
  'aiDailyScanLimit',
] as const;

export function Settings() {
  const me = useMe();
  const { t } = useTranslation();
  return (
    <div className="stack">
      <h1>{t('settings.title')}</h1>
      {can(me, 'owner') && <StoreForm />}
      {can(me, 'owner') && (
        <div className="card">
          <h2>{t('settings.ai')}</h2>
          <p className={me.aiEnabled ? 'ok' : 'warn'}>{me.aiEnabled ? t('settings.aiOn') : t('settings.aiOff')}</p>
        </div>
      )}
    </div>
  );
}

function StoreForm() {
  const me = useMe();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(me.store.name);
  const [s, setS] = useState<StoreSettings>(me.store.settings);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/store', { method: 'PATCH', body: { name, settings: s } });
      toast(t('common.saved'));
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      toast(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={save}>
      <h2>{t('settings.store')}</h2>
      <Field label={t('settings.storeName')}>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <div className="grid2">
        {NUM_FIELDS.map((k) => (
          <Field key={k} label={t(`settings.${k}`)}>
            <input inputMode="decimal" value={String(s[k])} onChange={(e) => setS({ ...s, [k]: toNum(e.target.value) ?? 0 })} />
          </Field>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={s.offerAutoApprove} onChange={(e) => setS({ ...s, offerAutoApprove: e.target.checked })} />
        {t('settings.offerAutoApprove')}
      </label>
      <div>
        <strong>{t('settings.offerTiers')}</strong>
        {s.offerTiers.map((tier, i) => (
          <div className="row" key={i}>
            <input
              style={{ width: 80 }}
              inputMode="numeric"
              value={tier.days}
              onChange={(e) => setS({ ...s, offerTiers: s.offerTiers.map((x, j) => (j === i ? { ...x, days: toNum(e.target.value) ?? 0 } : x)) })}
            />
            <span>{t('common.days')} →</span>
            <input
              style={{ width: 80 }}
              inputMode="numeric"
              value={tier.pct}
              onChange={(e) => setS({ ...s, offerTiers: s.offerTiers.map((x, j) => (j === i ? { ...x, pct: toNum(e.target.value) ?? 0 } : x)) })}
            />
            <span>%</span>
          </div>
        ))}
      </div>
      <button className="primary" disabled={busy}>
        {t('common.save')}
      </button>
    </form>
  );
}

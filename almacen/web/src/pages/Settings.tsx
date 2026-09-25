import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { StoreSettings } from '@almacen/shared';
import { api, errMsg } from '../api';
import { Field, toast, toNum } from '../components/ui';
import { dateTimeFmt } from '../lib/format';
import { enablePush, pushSupported } from '../lib/live';
import { can, useMe } from '../lib/me';
import { MenuSettings, MercadoPagoSettings } from './MercadoPago';
import { ShopSettings } from './Orders';
import { FiscalSettings } from './Invoice';

const NUM_FIELDS = [
  'expiryAlertDays',
  'targetMargin',
  'priceRounding',
  'offerAllowBelowCostDays',
  'voidAlertThreshold',
  'cashDiffThreshold',
  'countItemsPerDay',
  'countDiffThreshold',
  'lowStockPct',
  'tables',
  'aiDailyScanLimit',
  'lateToleranceMin',
  'absentAfterMin',
] as const;
type NumField = (typeof NUM_FIELDS)[number];
const INT_FIELDS = new Set<NumField>(['expiryAlertDays', 'offerAllowBelowCostDays', 'voidAlertThreshold', 'countItemsPerDay', 'lowStockPct', 'tables', 'aiDailyScanLimit', 'lateToleranceMin', 'absentAfterMin']);

export function Settings() {
  const me = useMe();
  const { t } = useTranslation();
  return (
    <div className="stack">
      <h1>{t('settings.title')}</h1>
      <Notifications />
      {can(me, 'owner') && <StoreForm />}
      {can(me, 'owner') && <Devices />}
      {can(me, 'owner') && <FiscalSettings />}
      {can(me, 'owner') && <ShopSettings />}
      {can(me, 'owner') && <MenuSettings />}
      {can(me, 'owner') && <MercadoPagoSettings />}
      {can(me, 'owner') && <DemoReset />}
      {can(me, 'owner') && (
        <button
          onClick={() =>
            void api('/jobs/run', { method: 'POST' })
              .then(() => toast(t('settings.jobsDone')))
              .catch((e) => toast(errMsg(e)))
          }
        >
          🔎 {t('settings.runJobs')}
        </button>
      )}
      {can(me, 'owner') && (
        <button
          onClick={() =>
            void api('/counts', { body: {} })
              .then(() => toast(t('count.title') + ' ✓'))
              .catch((e) => toast(errMsg(e)))
          }
        >
          🔢 {t('count.title')}
        </button>
      )}
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
  const [nums, setNums] = useState(() => Object.fromEntries(NUM_FIELDS.map((k) => [k, String(me.store.settings[k])])) as Record<NumField, string>);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const settings = { ...s };
      for (const k of NUM_FIELDS) {
        const v = toNum(nums[k]);
        if (v != null) settings[k] = INT_FIELDS.has(k) ? Math.round(v) : v;
      }
      await api('/store', { method: 'PATCH', body: { name, settings } });
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
            <input inputMode="decimal" value={nums[k]} onChange={(e) => setNums({ ...nums, [k]: e.target.value })} />
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

function Devices() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['devices'], queryFn: () => api<{ id: string; name: string; lastSeenAt: string | null }[]>('/pos/devices') });
  const revoke = async (id: string) => {
    if (!window.confirm(t('settings.revoke') + '?')) return;
    await api(`/pos/devices/${id}`, { method: 'DELETE' });
    void qc.invalidateQueries({ queryKey: ['devices'] });
  };
  return (
    <div className="card stack">
      <h2>{t('settings.devices')}</h2>
      {q.data?.map((d) => (
        <div key={d.id} className="list-item">
          <span className="grow">{d.name}</span>
          <span className="muted small">
            {t('settings.lastSeen')}: {d.lastSeenAt ? dateTimeFmt(d.lastSeenAt) : '—'}
          </span>
          <button className="small danger" onClick={() => void revoke(d.id)}>
            {t('settings.revoke')}
          </button>
        </div>
      ))}
      <Link className="btn" to="/pos">
        {t('settings.openPos')}
      </Link>
    </div>
  );
}

function Notifications() {
  const me = useMe();
  const { t } = useTranslation();
  const [on, setOn] = useState(() => pushSupported() && Notification.permission === 'granted');
  const available = pushSupported() && !!me.vapidPublicKey;
  const enable = async () => {
    try {
      await enablePush(me.vapidPublicKey!, (sub) => api('/push/subscribe', { body: sub }));
      setOn(true);
      toast(t('settings.notificationsOn'));
    } catch (e) {
      toast(errMsg(e));
    }
  };
  return (
    <div className="card stack">
      <h2>{t('settings.notifications')}</h2>
      {!available && <p className="muted">{t('settings.notificationsUnavailable')}</p>}
      {available && (on ? <p className="ok">{t('settings.notificationsOn')}</p> : <button onClick={() => void enable()}>🔔 {t('settings.enableNotifications')}</button>)}
    </div>
  );
}

/** Solo en el servidor de demostración: vuelve el local DEMO01 a los datos de ejemplo de hoy. */
function DemoReset() {
  const me = useMe();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['public-config'], queryFn: () => api<{ demo: boolean }>('/public/config'), staleTime: Infinity });
  const [busy, setBusy] = useState(false);
  if (!cfg.data?.demo || me.store.code !== 'DEMO01') return null;
  const reset = async () => {
    if (!window.confirm(t('settings.resetDemoConfirm'))) return;
    setBusy(true);
    try {
      await api('/demo/reset', { method: 'POST' });
      await qc.invalidateQueries();
      toast(t('settings.resetDemoDone'));
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button disabled={busy} onClick={() => void reset()}>
      ♻️ {busy ? t('common.loading') : t('settings.resetDemo')}
    </button>
  );
}

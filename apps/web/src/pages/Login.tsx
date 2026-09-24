import { type FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError, errMsg } from '../api';
import { LangSwitch } from '../components/Layout';
import { Field, Tabs, toast } from '../components/ui';

type Tab = 'employee' | 'owner' | 'register';
const remember = (k: string, v?: string) => {
  try {
    if (v !== undefined) localStorage.setItem(k, v);
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
};

export function Login() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>((remember('loginTab') as Tab) || 'employee');
  const [f, setF] = useState({ storeCode: remember('storeCode'), username: '', pin: '', email: '', password: '', storeName: '', name: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (tab === 'employee') {
        await api('/auth/login', { body: { storeCode: f.storeCode, username: f.username, pin: f.pin } });
        remember('storeCode', f.storeCode.toUpperCase());
      } else if (tab === 'owner') {
        await api('/auth/owner-login', { body: { email: f.email, password: f.password } });
      } else {
        await api('/auth/register', { body: { storeName: f.storeName, name: f.name, email: f.email, password: f.password, lang: i18n.language } });
      }
      remember('loginTab', tab === 'register' ? 'owner' : tab);
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError(t('login.invalid'));
      else if (err instanceof ApiError && err.code === 'email_taken') setError(t('login.emailTaken'));
      else setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="row between">
        <div className="logo">🛒 Super Chino</div>
        <LangSwitch />
      </div>
      <p className="muted">{t('login.tagline')}</p>
      <DemoBox />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'employee', label: t('login.employee') },
          { id: 'owner', label: t('login.owner') },
          { id: 'register', label: t('login.register') },
        ]}
      />
      <form className="card stack" onSubmit={submit}>
        {tab === 'employee' && (
          <>
            <Field label={t('login.storeCode')}>
              <input value={f.storeCode} onChange={set('storeCode')} autoCapitalize="characters" required />
            </Field>
            <Field label={t('login.username')}>
              <input value={f.username} onChange={set('username')} autoCapitalize="none" required />
            </Field>
            <Field label={t('login.pin')}>
              <input value={f.pin} onChange={set('pin')} type="password" inputMode="numeric" pattern="\d{4,8}" required />
            </Field>
          </>
        )}
        {tab === 'register' && (
          <>
            <Field label={t('login.storeName')}>
              <input value={f.storeName} onChange={set('storeName')} required minLength={2} />
            </Field>
            <Field label={t('login.yourName')}>
              <input value={f.name} onChange={set('name')} required minLength={2} />
            </Field>
          </>
        )}
        {tab !== 'employee' && (
          <>
            <Field label={t('login.email')}>
              <input value={f.email} onChange={set('email')} type="email" autoCapitalize="none" required />
            </Field>
            <Field label={t('login.password')}>
              <input value={f.password} onChange={set('password')} type="password" required minLength={tab === 'register' ? 8 : 1} />
            </Field>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button className="primary big" disabled={busy}>
          {tab === 'register' ? t('login.createAccount') : t('login.enter')}
        </button>
      </form>
    </div>
  );
}

// Datos del local de demostración (se cargan con SEED_DEMO=true, ver prisma/seed.ts).
const DEMO = {
  owner: { email: 'dueno@demo.com', password: 'demo1234' },
  employee: { storeCode: 'DEMO01', username: 'sofia', pin: '1234' },
};

/** Entrar a la demo con un toque (solo en servidores de demostración). */
function DemoBox() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['public-config'], queryFn: () => api<{ demo: boolean }>('/public/config'), staleTime: Infinity });
  const [busy, setBusy] = useState(false);
  if (!cfg.data?.demo) return null;
  const enter = async (who: 'owner' | 'employee') => {
    setBusy(true);
    try {
      if (who === 'owner') await api('/auth/owner-login', { body: DEMO.owner });
      else await api('/auth/login', { body: DEMO.employee });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card stack" style={{ borderLeft: '4px solid var(--gold)', marginBottom: 12 }}>
      <strong>{t('login.demoTitle')}</strong>
      <div className="row">
        <button type="button" className="primary" disabled={busy} onClick={() => void enter('owner')}>
          {t('login.demoOwner')}
        </button>
        <button type="button" disabled={busy} onClick={() => void enter('employee')}>
          {t('login.demoEmployee')}
        </button>
      </div>
      <span className="hint">
        {t('login.owner')}: {DEMO.owner.email} · {DEMO.owner.password} — {t('login.employee')}: {DEMO.employee.storeCode} · {DEMO.employee.username} · PIN {DEMO.employee.pin}
      </span>
    </div>
  );
}

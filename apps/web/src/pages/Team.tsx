import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type Lang, PERMS, type Perm } from '@super-chino/shared';
import { api, ApiError, errMsg } from '../api';
import { ErrorBox, Field, Loading, toast } from '../components/ui';
import { useMe } from '../lib/me';

interface UserRow { id: string; name: string; username: string; role: 'OWNER' | 'EMPLOYEE'; perms: Perm[]; lang: Lang; active: boolean; hasPin: boolean }

export function Team() {
  const me = useMe();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/users') });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) => api(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      toast(t('common.saved'));
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast(errMsg(e)),
  });

  const [form, setForm] = useState({ name: '', username: '', pin: '', lang: 'es' as Lang, perms: ['sell'] as Perm[] });
  const [error, setError] = useState('');
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/users', { body: form });
      setForm({ name: '', username: '', pin: '', lang: 'es', perms: ['sell'] });
      toast(t('common.saved'));
      void qc.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'username_taken' ? t('team.usernameTaken') : errMsg(err));
    }
  };
  const togglePerm = (perms: Perm[], p: Perm) => (perms.includes(p) ? perms.filter((x) => x !== p) : [...perms, p]);

  return (
    <div className="stack">
      <h1>{t('team.title')}</h1>
      <p className="card">{t('team.storeCodeHelp', { code: me.store.code })}</p>
      {users.isLoading && <Loading />}
      <ErrorBox error={users.error} />
      {users.data?.map((u) => (
        <div className="card stack" key={u.id}>
          <div className="row between">
            <strong>
              {u.name} <span className="muted small">@{u.username}</span>
            </strong>
            <span className={`badge ${u.active ? 'green' : 'gray'}`}>{u.role === 'OWNER' ? t('roles.OWNER') : u.active ? t('common.active') : t('common.inactive')}</span>
          </div>
          {u.role === 'EMPLOYEE' && (
            <div className="row">
              {PERMS.map((p) => (
                <label className="check" key={p}>
                  <input type="checkbox" checked={u.perms.includes(p)} onChange={() => update.mutate({ id: u.id, perms: togglePerm(u.perms, p) })} />
                  {t(`perms.${p}`)}
                </label>
              ))}
            </div>
          )}
          <div className="row">
            <select value={u.lang} onChange={(e) => update.mutate({ id: u.id, lang: e.target.value })} style={{ width: 'auto' }}>
              <option value="es">Español</option>
              <option value="zh">中文</option>
            </select>
            <button
              type="button"
              className="small"
              onClick={() => {
                const pin = window.prompt(t('team.newPin') + ' (' + t('team.pinHelp') + ')');
                if (pin === null) return;
                if (!/^\d{4,8}$/.test(pin)) return toast(t('team.pinHelp'));
                update.mutate({ id: u.id, pin });
              }}
            >
              {t('team.newPin')}
            </button>
            {u.role === 'EMPLOYEE' && (
              <button type="button" className={`small ${u.active ? 'danger' : ''}`} onClick={() => update.mutate({ id: u.id, active: !u.active })}>
                {u.active ? t('team.deactivate') : t('team.activate')}
              </button>
            )}
          </div>
        </div>
      ))}
      <form className="card stack" onSubmit={create}>
        <h2>{t('team.newEmployee')}</h2>
        <div className="grid2">
          <Field label={t('common.name')}>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label={t('login.username')}>
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} required pattern="[a-z0-9._\-]{2,30}" autoCapitalize="none" />
          </Field>
          <Field label={t('login.pin')} hint={t('team.pinHelp')}>
            <input value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} required pattern="\d{4,8}" inputMode="numeric" />
          </Field>
          <Field label={t('common.language')}>
            <select value={form.lang} onChange={(e) => setForm({ ...form, lang: e.target.value as Lang })}>
              <option value="es">Español</option>
              <option value="zh">中文</option>
            </select>
          </Field>
        </div>
        <div className="row">
          {PERMS.map((p) => (
            <label className="check" key={p}>
              <input type="checkbox" checked={form.perms.includes(p)} onChange={() => setForm({ ...form, perms: togglePerm(form.perms, p) })} />
              {t(`perms.${p}`)}
            </label>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        <button className="primary">{t('common.add')}</button>
      </form>
    </div>
  );
}

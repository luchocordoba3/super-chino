import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type Lang, PERMS, type Perm, type WeekSchedule } from '@super-chino/shared';
import { api, ApiError, errMsg } from '../api';
import { ErrorBox, Field, Loading, Modal, toast, toNum } from '../components/ui';
import { useMe } from '../lib/me';

interface UserRow {
  id: string;
  name: string;
  username: string;
  role: 'OWNER' | 'EMPLOYEE';
  perms: Perm[];
  lang: Lang;
  active: boolean;
  hasPin: boolean;
  dni: string | null;
  phone: string | null;
  hiredAt: string | null;
  salary: number | null;
  notes: string | null;
  schedule: WeekSchedule | null;
}

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

  const [fichaFor, setFichaFor] = useState<UserRow | null>(null);
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
              <button type="button" className="small" onClick={() => setFichaFor(u)}>
                📋 {t('team.ficha')}
              </button>
            )}
            {u.role === 'EMPLOYEE' && (
              <button type="button" className={`small ${u.active ? 'danger' : ''}`} onClick={() => update.mutate({ id: u.id, active: !u.active })}>
                {u.active ? t('team.deactivate') : t('team.activate')}
              </button>
            )}
          </div>
        </div>
      ))}
      {fichaFor && (
        <FichaModal
          user={fichaFor}
          onClose={() => setFichaFor(null)}
          onSave={(body) => update.mutate({ id: fichaFor.id, ...body }, { onSuccess: () => setFichaFor(null) })}
        />
      )}
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

/** Lunes a domingo (el horario se guarda con 0 = domingo). */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Ficha del empleado (datos que ve solo el dueño) y su horario de cada día. */
function FichaModal({ user, onClose, onSave }: { user: UserRow; onClose: () => void; onSave: (body: Record<string, unknown>) => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({
    dni: user.dni ?? '',
    phone: user.phone ?? '',
    hiredAt: user.hiredAt ?? '',
    salary: user.salary != null ? String(user.salary) : '',
    notes: user.notes ?? '',
  });
  const [week, setWeek] = useState(() => Array.from({ length: 7 }, (_, i) => ({ start: user.schedule?.[i]?.start ?? '', end: user.schedule?.[i]?.end ?? '' })));
  const setDay = (i: number, k: 'start' | 'end', v: string) => setWeek(week.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const schedule = week.map((d) => (d.start && d.end ? { start: d.start, end: d.end } : null));
    if (schedule.some((d) => d && d.end <= d.start)) return toast(t('errors.validation'));
    onSave({
      dni: f.dni.trim() || null,
      phone: f.phone.trim() || null,
      hiredAt: f.hiredAt || null,
      salary: f.salary ? toNum(f.salary) : null,
      notes: f.notes.trim() || null,
      schedule: schedule.every((d) => !d) ? null : schedule,
    });
  };
  return (
    <Modal title={`📋 ${user.name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">🔒 {t('team.fichaHelp')}</p>
        <div className="grid2">
          <Field label={t('team.dni')}>
            <input value={f.dni} maxLength={20} onChange={(e) => setF({ ...f, dni: e.target.value })} />
          </Field>
          <Field label={t('team.phone')}>
            <input type="tel" value={f.phone} maxLength={30} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
          <Field label={t('team.hiredAt')}>
            <input type="date" value={f.hiredAt} onChange={(e) => setF({ ...f, hiredAt: e.target.value })} />
          </Field>
          <Field label={t('team.salary')}>
            <input inputMode="decimal" value={f.salary} onChange={(e) => setF({ ...f, salary: e.target.value })} />
          </Field>
        </div>
        <Field label={t('team.notes')}>
          <textarea rows={2} maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <h3>{t('team.schedule')}</h3>
        <p className="muted small">{t('team.scheduleHelp')}</p>
        <table className="schedule">
          <tbody>
            {WEEK_ORDER.map((i) => (
              <tr key={i}>
                <th>{t(`team.days.d${i}` as 'team.days.d0')}</th>
                <td>
                  <input type="time" aria-label={`${t(`team.days.d${i}` as 'team.days.d0')} ${t('attendance.in')}`} value={week[i].start} onChange={(e) => setDay(i, 'start', e.target.value)} />
                </td>
                <td>
                  <input type="time" aria-label={`${t(`team.days.d${i}` as 'team.days.d0')} ${t('attendance.out')}`} value={week[i].end} onChange={(e) => setDay(i, 'end', e.target.value)} />
                </td>
                <td className="muted small">{!week[i].start && !week[i].end ? t('team.dayOff') : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="primary">{t('common.save')}</button>
      </form>
    </Modal>
  );
}

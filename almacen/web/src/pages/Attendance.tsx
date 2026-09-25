import { type FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Field, Loading, Modal, toast } from '../components/ui';
import { dayFmt, timeFmt, todayISO } from '../lib/format';

interface Board {
  working: { userId: string; name: string; since: string; lateMin: number | null }[];
  late: { userId: string; name: string; minutes: number }[];
  absent: { userId: string; name: string; start: string }[];
  expected: { userId: string; name: string; start: string }[];
}
interface Entry {
  id: string;
  userId: string;
  name: string;
  day: string;
  inAt: string | null;
  outAt: string | null;
  minutes: number;
  lateMin: number | null;
  late: boolean;
  inSource: string | null;
  outSource: string | null;
  note: string | null;
  editedAt: string | null;
  open: boolean;
  incomplete: boolean;
}
interface Person {
  userId: string;
  name: string;
  days: number;
  minutes: number;
  lateCount: number;
  lateMinutes: number;
  absences: number;
  absentDays: string[];
  incomplete: number;
}
interface Report {
  from: string;
  to: string;
  users: Person[];
  entries: Entry[];
}

const shiftDay = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Esta semana (de lunes a hoy), este mes y el mes pasado. */
function periods(today: string) {
  const monday = shiftDay(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = shiftDay(monthStart, -1);
  return {
    thisWeek: [monday, today],
    thisMonth: [monthStart, today],
    lastMonth: [`${lastMonthEnd.slice(0, 8)}01`, lastMonthEnd],
  } as const;
}
const hours = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
/** Hora local "HH:MM" para los campos de hora. */
const toHM = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const SOURCE_ICON: Record<string, string> = { pos: '🖥', phone: '📱', manual: '✏️' };

/** Horarios del equipo: quién está hoy, horas para pagar sueldos, tardanzas, faltas y correcciones. */
export function Attendance() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const today = todayISO();
  const presets = periods(today);
  const [range, setRange] = useState<readonly [string, string]>(presets.thisWeek);
  const [person, setPerson] = useState<string | null>(null);
  const [editing, setEditing] = useState<Entry | 'new' | null>(null);
  const qs = `from=${range[0]}&to=${range[1]}`;
  const board = useQuery({ queryKey: ['attendance', 'today'], queryFn: () => api<Board>('/attendance/today'), refetchInterval: 60_000 });
  const report = useQuery({ queryKey: ['attendance', 'report', qs], queryFn: () => api<Report>(`/attendance?${qs}`) });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ role: string; active: boolean; schedule: unknown }[]>('/users') });
  const noSchedule = users.data && !users.data.some((u) => u.role === 'EMPLOYEE' && u.active && u.schedule);
  const entries = (report.data?.entries ?? []).filter((e) => !person || e.userId === person);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['attendance'] });

  const list = (title: string, items: { key: string; name: string; extra: string }[], cls = '') => (
    <div className="stack" style={{ gap: 4 }}>
      <strong className={cls}>{title}</strong>
      {items.length === 0 && <span className="muted small">{t('attendance.nobody')}</span>}
      {items.map((i) => (
        <span key={i.key}>
          {i.name} <span className="muted small">{i.extra}</span>
        </span>
      ))}
    </div>
  );

  return (
    <div className="stack">
      <h1>🕘 {t('attendance.title')}</h1>
      {noSchedule && <p className="card">{t('attendance.noSchedule')}</p>}

      <div className="card stack">
        <h2>{t('attendance.today')}</h2>
        {board.isLoading && <Loading />}
        <ErrorBox error={board.error} />
        {board.data && (
          <div className="grid2">
            {list(
              `🟢 ${t('attendance.working')}`,
              board.data.working.map((w) => ({
                key: w.userId,
                name: w.name,
                extra: t('attendance.since', { time: timeFmt(w.since) }) + (w.lateMin ? ` · ${t('attendance.lateBy', { count: w.lateMin })}` : ''),
              })),
            )}
            {list(
              `⚠️ ${t('attendance.late')}`,
              board.data.late.map((l) => ({ key: l.userId, name: l.name, extra: t('attendance.lateBy', { count: l.minutes }) })),
            )}
            {list(
              `⛔ ${t('attendance.absent')}`,
              board.data.absent.map((a) => ({ key: a.userId, name: a.name, extra: t('attendance.startsAt', { time: a.start }) })),
              board.data.absent.length ? 'error' : '',
            )}
            {list(
              `🕒 ${t('attendance.expected')}`,
              board.data.expected.map((a) => ({ key: a.userId, name: a.name, extra: t('attendance.startsAt', { time: a.start }) })),
            )}
          </div>
        )}
      </div>

      <div className="card stack">
        <div className="row">
          {(Object.keys(presets) as (keyof typeof presets)[]).map((k) => (
            <button key={k} className={range[0] === presets[k][0] && range[1] === presets[k][1] ? 'primary' : ''} onClick={() => setRange(presets[k])}>
              {t(`attendance.${k}`)}
            </button>
          ))}
        </div>
        <div className="row">
          <Field label={t('attendance.from')}>
            <input type="date" value={range[0]} max={range[1]} onChange={(e) => e.target.value && setRange([e.target.value, range[1]])} />
          </Field>
          <Field label={t('attendance.to')}>
            <input type="date" value={range[1]} min={range[0]} onChange={(e) => e.target.value && setRange([range[0], e.target.value])} />
          </Field>
          <a className="btn" href={`/api/attendance.csv?${qs}`} download>
            📥 {t('attendance.export')}
          </a>
        </div>
        {report.isLoading && <Loading />}
        <ErrorBox error={report.error} />
        {report.data && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('attendance.employee')}</th>
                  <th className="num">{t('attendance.days')}</th>
                  <th className="num">{t('attendance.hours')}</th>
                  <th className="num">{t('attendance.lates')}</th>
                  <th className="num">{t('attendance.absences')}</th>
                  <th className="num">{t('attendance.incomplete')}</th>
                </tr>
              </thead>
              <tbody>
                {report.data.users.map((u) => (
                  <tr key={u.userId} className={person === u.userId ? 'selected' : ''} onClick={() => setPerson(person === u.userId ? null : u.userId)} style={{ cursor: 'pointer' }}>
                    <td>{u.name}</td>
                    <td className="num">{u.days}</td>
                    <td className="num">
                      <strong>{hours(u.minutes)}</strong>
                    </td>
                    <td className={`num ${u.lateCount ? 'error' : ''}`}>{u.lateCount ? `${u.lateCount} (${u.lateMinutes}')` : 0}</td>
                    <td className={`num ${u.absences ? 'error' : ''}`} title={u.absentDays.map(dayFmt).join(', ')}>
                      {u.absences}
                    </td>
                    <td className={`num ${u.incomplete ? 'error' : ''}`}>{u.incomplete}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card stack">
        <div className="row between">
          <h2>
            {t('attendance.entries')}
            {person && report.data ? ` · ${report.data.users.find((u) => u.userId === person)?.name ?? ''}` : ''}
          </h2>
          <button onClick={() => setEditing('new')}>＋ {t('attendance.add')}</button>
        </div>
        {report.data && entries.length === 0 && <Empty />}
        {entries.map((e) => (
          <div key={e.id} className="row between attendance-row">
            <span>
              <strong>{e.name}</strong> <span className="muted small">{dayFmt(e.day)}</span>
            </span>
            <span className="small">
              {e.inAt ? `${SOURCE_ICON[e.inSource ?? ''] ?? ''} ${timeFmt(e.inAt)}` : <span className="error">{t('attendance.in')}: {t('attendance.missing')}</span>}
              {' → '}
              {e.outAt ? `${SOURCE_ICON[e.outSource ?? ''] ?? ''} ${timeFmt(e.outAt)}` : e.open ? <span className="badge green">{t('attendance.working')}</span> : <span className="error">{t('attendance.out')}: {t('attendance.missing')}</span>}
              {e.inAt && e.outAt && <strong> · {hours(e.minutes)}</strong>}
              {e.late && <span className="badge gold"> {t('attendance.lateBy', { count: e.lateMin ?? 0 })}</span>}
              {e.editedAt && <span className="muted"> · ✏️ {t('attendance.edited')}</span>}
              {e.note && <span className="muted"> · {e.note}</span>}
            </span>
            <button className="small ghost" onClick={() => setEditing(e)}>
              {t('common.edit')}
            </button>
          </div>
        ))}
      </div>

      {editing && report.data && (
        <EntryModal
          entry={editing}
          people={report.data.users}
          defaultUser={person}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** Corregir un fichaje (o cargar uno que faltó). Las horas se toman del día elegido, en la hora del local. */
function EntryModal({ entry, people, defaultUser, onClose, onSaved }: { entry: Entry | 'new'; people: Person[]; defaultUser: string | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const isNew = entry === 'new';
  const [f, setF] = useState({
    userId: isNew ? (defaultUser ?? people[0]?.userId ?? '') : entry.userId,
    date: isNew ? todayISO() : entry.day,
    inTime: isNew ? '' : toHM(entry.inAt),
    outTime: isNew ? '' : toHM(entry.outAt),
    note: isNew ? '' : (entry.note ?? ''),
  });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.inTime && !f.outTime) return toast(t('errors.validation'));
    const body = { date: f.date, inTime: f.inTime || null, outTime: f.outTime || null, note: f.note.trim() || null };
    try {
      if (isNew) await api('/attendance', { body: { ...body, userId: f.userId } });
      else await api(`/attendance/${entry.id}`, { method: 'PATCH', body });
      toast(t('common.saved'));
      onSaved();
    } catch (err) {
      toast(errMsg(err));
    }
  };
  const remove = async () => {
    if (isNew || !window.confirm(t('attendance.deleteConfirm'))) return;
    try {
      await api(`/attendance/${entry.id}`, { method: 'DELETE' });
      onSaved();
    } catch (err) {
      toast(errMsg(err));
    }
  };
  return (
    <Modal title={isNew ? t('attendance.add') : `${entry.name} · ${dayFmt(entry.day)}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        {isNew && (
          <Field label={t('attendance.employee')}>
            <select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })} required>
              {people.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('common.date')}>
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
        </Field>
        <div className="grid2">
          <Field label={t('attendance.in')}>
            <input type="time" value={f.inTime} onChange={(e) => setF({ ...f, inTime: e.target.value })} />
          </Field>
          <Field label={t('attendance.out')}>
            <input type="time" value={f.outTime} onChange={(e) => setF({ ...f, outTime: e.target.value })} />
          </Field>
        </div>
        <Field label={t('common.note')}>
          <input value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <button className="primary">{t('common.save')}</button>
        {!isNew && (
          <button type="button" className="danger" onClick={() => void remove()}>
            {t('common.delete')}
          </button>
        )}
      </form>
    </Modal>
  );
}

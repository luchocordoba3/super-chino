import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';
import { MessageCard } from '../components/MessageCard';
import { Dashboard } from './Dashboard';
import { Empty, toast } from '../components/ui';
import { timeFmt } from '../lib/format';
import { can, useMe } from '../lib/me';
import type { Msg } from '../lib/types';

export function Home() {
  const me = useMe();
  const { t } = useTranslation();
  const inbox = useQuery({ queryKey: ['messages', 'inbox'], queryFn: () => api<Msg[]>('/messages?box=inbox') });
  const tasks = inbox.data?.filter((m) => m.kind === 'TASK' && !m.doneAt) ?? [];
  return (
    <div className="stack">
      <h1>{t('home.hello', { name: me.user.name })}</h1>
      {me.user.role === 'EMPLOYEE' && <ClockCard />}
      {can(me, 'reports') && <Dashboard />}
      <div className="card">
        <h3>{t('home.shortcuts')}</h3>
        <div className="row">
          {can(me, 'sell') && <Link className="btn" to="/pos">{t('nav.pos')}</Link>}
          {can(me, 'stock') && <Link className="btn" to="/stock">{t('stock.quickLoad')}</Link>}
          <Link className="btn" to="/products">{t('nav.products')}</Link>
          <Link className="btn" to="/messages">{t('nav.messages')}</Link>
        </div>
      </div>
      <h2>{t('home.myTasks')}</h2>
      {inbox.data && tasks.length === 0 && <Empty text={t('home.noTasks')} />}
      {tasks.map((m) => (
        <MessageCard key={m.id} m={m} box="inbox" />
      ))}
    </div>
  );
}

interface MyStatus {
  working: boolean;
  since: string | null;
  today: { id: string; inAt: string | null; outAt: string | null }[];
}

/** Fichar entrada y salida desde el celular (necesita internet; vale la hora del servidor). */
function ClockCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['attendance', 'me'], queryFn: () => api<MyStatus>('/attendance/me') });
  const [busy, setBusy] = useState(false);
  const clock = async (action: 'in' | 'out') => {
    setBusy(true);
    try {
      qc.setQueryData(['attendance', 'me'], await api<MyStatus>('/attendance/clock', { body: { id: crypto.randomUUID(), action } }));
      toast(`${t(action === 'in' ? 'attendance.clockIn' : 'attendance.clockOut')} ✓`);
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const s = q.data;
  const lastOut = s?.today.filter((e) => e.outAt).at(-1)?.outAt;
  return (
    <div className="card stack clock-card">
      <h3>🕘 {t('attendance.card')}</h3>
      {s && (
        <p>
          {s.working && s.since
            ? t('attendance.workingSince', { time: timeFmt(s.since) })
            : lastOut
              ? t('attendance.leftAt', { time: timeFmt(lastOut) })
              : t('attendance.notClocked')}
        </p>
      )}
      <div className="grid2">
        <button className={`big ${s && !s.working ? 'primary' : ''}`} disabled={busy || !s || s.working} onClick={() => void clock('in')}>
          ▶ {t('attendance.clockIn')}
        </button>
        <button className={`big ${s?.working ? 'primary' : ''}`} disabled={busy || !s?.working} onClick={() => void clock('out')}>
          ⏹ {t('attendance.clockOut')}
        </button>
      </div>
    </div>
  );
}

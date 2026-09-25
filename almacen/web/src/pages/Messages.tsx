import { type FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';
import { MessageCard } from '../components/MessageCard';
import { Empty, ErrorBox, Field, Loading, Tabs, toast } from '../components/ui';
import { can, useMe } from '../lib/me';
import type { Msg } from '../lib/types';

export function Messages() {
  const { t } = useTranslation();
  const [box, setBox] = useState<'inbox' | 'sent'>('inbox');
  const q = useQuery({ queryKey: ['messages', box], queryFn: () => api<Msg[]>(`/messages?box=${box}`) });
  return (
    <div className="stack">
      <h1>{t('messages.title')}</h1>
      <Compose />
      <Tabs
        value={box}
        onChange={setBox}
        tabs={[
          { id: 'inbox', label: t('messages.inbox') },
          { id: 'sent', label: t('messages.sent') },
        ]}
      />
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} />
      {q.data?.length === 0 && <Empty text={t('messages.noMessages')} />}
      {q.data?.map((m) => <MessageCard key={m.id} m={m} box={box} />)}
    </div>
  );
}

function Compose() {
  const me = useMe();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isOwner = can(me, 'owner');
  const users = useQuery({
    queryKey: ['directory'],
    queryFn: () => api<{ id: string; name: string; role: string; active: boolean }[]>('/users/directory'),
    enabled: isOwner,
  });
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [to, setTo] = useState<string[]>([]);
  const [task, setTask] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/messages', {
        body: {
          text,
          to: isOwner ? (to.length ? to : 'all') : 'owner',
          kind: task ? 'TASK' : 'MESSAGE',
          requiresPhoto: task && photo,
          dueAt: task && dueAt ? new Date(dueAt).toISOString() : null,
        },
      });
      setText('');
      setTask(false);
      setPhoto(false);
      setDueAt('');
      setOpen(false);
      toast(t('common.send') + ' ✓');
      void qc.invalidateQueries({ queryKey: ['messages'] });
    } catch (err) {
      toast(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="primary" onClick={() => setOpen(true)}>
        ✏️ {t('messages.compose')}
      </button>
    );
  }
  const employees = users.data?.filter((u) => u.role === 'EMPLOYEE' && u.active) ?? [];
  return (
    <form className="card stack" onSubmit={send}>
      <Field label={t('messages.text')}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} required autoFocus />
      </Field>
      {isOwner ? (
        <div className="stack">
          <strong className="small">{t('messages.to')}</strong>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={to.length === 0} onChange={() => setTo([])} /> {t('messages.toAll')}
            </label>
            {employees.map((u) => (
              <label className="check" key={u.id}>
                <input type="checkbox" checked={to.includes(u.id)} onChange={() => setTo(to.includes(u.id) ? to.filter((x) => x !== u.id) : [...to, u.id])} />
                {u.name}
              </label>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={task} onChange={(e) => setTask(e.target.checked)} /> {t('messages.task')}
          </label>
          {task && (
            <>
              <label className="check">
                <input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} /> 📷 {t('messages.requiresPhoto')}
              </label>
              <Field label={t('messages.dueAt')}>
                <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </Field>
            </>
          )}
        </div>
      ) : (
        <p className="muted small">{t('messages.toOwner')}</p>
      )}
      <div className="row">
        <button className="primary" disabled={busy}>
          {t('common.send')}
        </button>
        <button type="button" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

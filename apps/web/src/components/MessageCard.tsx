import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError, errMsg } from '../api';
import { dateTimeFmt } from '../lib/format';
import { shrinkImage } from '../lib/image';
import { useMe } from '../lib/me';
import type { Msg } from '../lib/types';
import { toast } from './ui';

export function MessageCard({ m, box }: { m: Msg; box: 'inbox' | 'sent' }) {
  const me = useMe();
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const lang = (i18n.language === 'zh' ? 'zh' : 'es') as 'es' | 'zh';
  const translated = m.lang !== lang ? m.translations[lang] : undefined;
  const [original, setOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['messages'] });
    void qc.invalidateQueries({ queryKey: ['unread'] });
  };

  useEffect(() => {
    if (box === 'inbox' && !m.myReadAt) void api(`/messages/${m.id}/read`, { method: 'POST' }).then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id, m.myReadAt, box]);

  const complete = async (file?: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('note', '');
      if (file) form.append('photo', await shrinkImage(file), 'foto.jpg');
      await api(`/messages/${m.id}/done`, file ? { form } : { method: 'POST', body: {} });
      toast(t('common.done'));
      refresh();
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'photo_required' ? t('messages.photoRequired') : errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const title = m.meta?.type ? t(`messages.taskTypes.${m.meta.type}`) : null;
  const body = original || !translated ? m.text : translated;
  const isRecipient = m.recipients.some((r) => r.userId === me.user.id);

  return (
    <div className="card stack" style={m.kind === 'TASK' && !m.doneAt ? { borderLeft: '4px solid var(--red)' } : undefined}>
      <div className="row between small">
        <strong>{m.from?.name ?? t('messages.system')}</strong>
        <span className="muted">
          {m.kind === 'TASK' && <span className={`badge ${m.doneAt ? 'green' : 'red'}`}>{m.doneAt ? t('common.done') : t('common.pending')}</span>}{' '}
          {dateTimeFmt(m.createdAt)}
        </span>
      </div>
      {title && <strong>{title}</strong>}
      <div style={{ whiteSpace: 'pre-wrap', fontSize: '1.05rem' }}>{body}</div>
      <div className="row small">
        {m.translationStatus === 'pending' && m.lang !== lang && <span className="muted">{t('messages.translating')}</span>}
        {m.translationStatus === 'failed' && m.lang !== lang && (
          <button className="small ghost" onClick={() => void api(`/messages/${m.id}/translate`, { method: 'POST' }).then(refresh)}>
            {t('messages.translationFailed')} · {t('common.retry')}
          </button>
        )}
        {translated && (
          <button className="small ghost" onClick={() => setOriginal(!original)}>
            {original ? t('messages.showTranslation') : t('messages.showOriginal')}
          </button>
        )}
        {m.dueAt && (
          <span className="badge gold">
            {t('messages.dueAt')}: {dateTimeFmt(m.dueAt)}
          </span>
        )}
      </div>
      {m.meta?.type === 'REMOVE_EXPIRED' && !m.doneAt && <div className="hint">{t('messages.removeExpiredHelp')}</div>}
      {box === 'sent' && (
        <div className="row small">
          {m.recipients.map((r) => (
            <span key={r.userId} className={`badge ${r.readAt ? 'green' : 'gray'}`}>
              {r.name} {r.readAt ? `✓✓ ${t('messages.seen')}` : `✓ ${t('messages.notSeen')}`}
            </span>
          ))}
        </div>
      )}
      {m.doneAt && (
        <div className="small">
          ✓ {t('messages.doneBy', { name: m.doneBy ?? '' })} · {dateTimeFmt(m.doneAt)}
          {m.doneNote && <div>{m.doneNote}</div>}
          {m.donePhoto && (
            <a href={m.donePhoto} target="_blank" rel="noreferrer">
              <img src={m.donePhoto} alt="" style={{ maxWidth: 220, borderRadius: 8, display: 'block', marginTop: 6 }} />
            </a>
          )}
        </div>
      )}
      {m.kind === 'TASK' && !m.doneAt && (isRecipient || me.user.role === 'OWNER') && (
        <div className="row">
          {m.meta?.type === 'COUNT' ? (
            <Link className="btn btn-primary" to={`/counts/${m.meta.countId}`}>
              {t('messages.openCount')}
            </Link>
          ) : m.requiresPhoto ? (
            <label className="btn btn-primary">
              📷 {t('messages.markDone')}
              <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && void complete(e.target.files[0])} />
            </label>
          ) : (
            <button className="primary" disabled={busy} onClick={() => void complete()}>
              ✓ {t('messages.markDone')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

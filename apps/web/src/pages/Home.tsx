import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { MessageCard } from '../components/MessageCard';
import { Empty } from '../components/ui';
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

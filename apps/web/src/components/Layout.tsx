import { NavLink, Outlet } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { type AppLang, setLang } from '../i18n';
import { useLiveEvents } from '../lib/live';
import { can, useMe } from '../lib/me';

export function LangSwitch({ onChange }: { onChange?: (l: AppLang) => void }) {
  const { i18n } = useTranslation();
  const next: AppLang = i18n.language === 'zh' ? 'es' : 'zh';
  return (
    <button
      type="button"
      onClick={() => {
        setLang(next);
        onChange?.(next);
      }}
    >
      {next === 'zh' ? '中文' : 'Español'}
    </button>
  );
}

export function Layout() {
  const me = useMe();
  const { t } = useTranslation();
  const qc = useQueryClient();
  useLiveEvents();
  const unread = useQuery({
    queryKey: ['unread'],
    queryFn: () => api<{ unread: number; openTasks: number }>('/messages/unread'),
    refetchInterval: 60_000,
  });
  const badge = (unread.data?.unread ?? 0) + (unread.data?.openTasks ?? 0);

  const links = [
    { to: '/', label: t('nav.home'), show: true },
    { to: '/pos', label: t('nav.pos'), show: can(me, 'sell') },
    { to: '/stock', label: t('nav.stock'), show: can(me, 'stock') || can(me, 'adjust') },
    { to: '/products', label: t('nav.products'), show: true },
    { to: '/suppliers', label: t('nav.suppliers'), show: can(me, 'stock') || can(me, 'prices') },
    { to: '/messages', label: t('nav.messages'), show: true },
    { to: '/alerts', label: t('nav.alerts'), show: can(me, 'owner') },
    { to: '/offers', label: t('nav.offers'), show: can(me, 'prices') },
    { to: '/reorder', label: t('nav.reorder'), show: can(me, 'stock') },
    { to: '/sales', label: t('nav.sales'), show: can(me, 'reports') },
    { to: '/team', label: t('nav.team'), show: can(me, 'owner') },
    { to: '/settings', label: t('nav.settings'), show: true },
  ].filter((l) => l.show);

  const saveLang = (lang: AppLang) => {
    void api('/auth/me', { method: 'PATCH', body: { lang } }).then(() => qc.invalidateQueries({ queryKey: ['me'] }));
  };
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    qc.clear();
    window.location.href = '/';
  };

  return (
    <div>
      <header className="topbar">
        <div className="brand">🛒 {me.store.name}</div>
        <LangSwitch onChange={saveLang} />
        <button type="button" onClick={logout}>
          {t('common.logout')}
        </button>
      </header>
      <nav className="nav">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === '/'}>
            {l.label} {l.to === '/messages' && badge > 0 && <span className="pill-count">{badge}</span>}
          </NavLink>
        ))}
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

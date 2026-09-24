import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { can, useMe } from '../lib/me';

export function Home() {
  const me = useMe();
  const { t } = useTranslation();
  return (
    <div className="stack">
      <h1>{t('home.hello', { name: me.user.name })}</h1>
      <div className="card">
        <h3>{t('home.shortcuts')}</h3>
        <div className="row">
          {can(me, 'sell') && <Link className="btn" to="/pos">{t('nav.pos')}</Link>}
          {can(me, 'stock') && <Link className="btn" to="/stock">{t('stock.quickLoad')}</Link>}
          <Link className="btn" to="/messages">{t('nav.messages')}</Link>
        </div>
      </div>
    </div>
  );
}

import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from './api';
import { Layout } from './components/Layout';
import { ErrorBox, Loading, Toaster } from './components/ui';
import { setLang } from './i18n';
import { setCurrency } from './lib/format';
import { MeContext, meQuery } from './lib/me';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { ProductDetail } from './pages/ProductDetail';
import { Products } from './pages/Products';
import { Settings } from './pages/Settings';
import { Stock } from './pages/Stock';
import { Team } from './pages/Team';

export function App() {
  const location = useLocation();
  const isPos = location.pathname.startsWith('/pos');
  const me = useQuery({ ...meQuery, enabled: !isPos });

  useEffect(() => {
    if (me.data) {
      setLang(me.data.user.lang);
      setCurrency(me.data.store.currency);
    }
  }, [me.data]);

  if (isPos) {
    return (
      <>
        <Toaster />
        <p className="main">…</p>
      </>
    );
  }
  if (me.isLoading) return <div className="main"><Loading /></div>;
  if (me.error && !(me.error instanceof ApiError && me.error.status === 401)) {
    return <div className="main"><ErrorBox error={me.error} /></div>;
  }
  if (!me.data) return (<><Toaster /><Login /></>);

  return (
    <MeContext.Provider value={me.data}>
      <Toaster />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="products" element={<Products />} />
          <Route path="products/:id" element={<ProductDetail />} />
          <Route path="stock" element={<Stock />} />
          <Route path="team" element={<Team />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </MeContext.Provider>
  );
}

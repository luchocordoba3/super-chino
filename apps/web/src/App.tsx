import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from './api';
import { Layout } from './components/Layout';
import { ErrorBox, Loading, Toaster } from './components/ui';
import { setLang } from './i18n';
import { setCurrency } from './lib/format';
import { MeContext, meQuery } from './lib/me';
import { Alerts } from './pages/Alerts';
import { CountPage } from './pages/Count';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Messages } from './pages/Messages';
import { Offers, OffersPrint } from './pages/Offers';
import { Pos } from './pages/Pos';
import { ProductDetail } from './pages/ProductDetail';
import { Reorder } from './pages/Reorder';
import { Sales } from './pages/Sales';
import { Products } from './pages/Products';
import { ScanInvoice } from './pages/ScanInvoice';
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
        <Pos />
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
        <Route path="/offers/print" element={<OffersPrint />} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="products" element={<Products />} />
          <Route path="products/:id" element={<ProductDetail />} />
          <Route path="stock" element={<Stock />} />
          <Route path="stock/scan" element={<ScanInvoice />} />
          <Route path="messages" element={<Messages />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="offers" element={<Offers />} />
          <Route path="counts/:id" element={<CountPage />} />
          <Route path="reorder" element={<Reorder />} />
          <Route path="sales" element={<Sales />} />
          <Route path="team" element={<Team />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </MeContext.Provider>
  );
}

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
import { ImportProducts } from './pages/ImportProducts';
import { Labels } from './pages/Labels';
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
import { Suppliers } from './pages/Suppliers';
import { Stock } from './pages/Stock';
import { Team } from './pages/Team';
import { Attendance } from './pages/Attendance';
import { CustomerDetail, Customers } from './celu/Customers';
import { Deliveries, NewOrder, OrderDetail, Orders } from './celu/Orders';
import { NewRepair, PublicRepair, RepairDetail, Repairs } from './celu/Repairs';
import { PhoneReports } from './celu/Reports';
import { Deposits, SerialDetail, Serials } from './celu/Serials';
import { NewTradeIn, TradeInDetail, TradeInPrices, TradeIns } from './celu/TradeIns';

export function App() {
  const location = useLocation();
  const isPos = location.pathname.startsWith('/pos');
  // Seguimiento de una reparación: el cliente lo abre sin cuenta.
  const isPublic = location.pathname.startsWith('/r/');
  const me = useQuery({ ...meQuery, enabled: !isPos && !isPublic });

  useEffect(() => {
    if (me.data) {
      setLang(me.data.user.lang);
      setCurrency(me.data.store.currency);
    }
  }, [me.data]);

  if (isPublic) {
    return (
      <>
        <Toaster />
        <Routes>
          <Route path="/r/:token" element={<PublicRepair />} />
        </Routes>
      </>
    );
  }
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
          <Route path="products/import" element={<ImportProducts />} />
          <Route path="products/:id" element={<ProductDetail />} />
          <Route path="labels" element={<Labels />} />
          <Route path="suppliers" element={<Suppliers />} />
          <Route path="stock" element={<Stock />} />
          <Route path="stock/scan" element={<ScanInvoice />} />
          <Route path="messages" element={<Messages />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="offers" element={<Offers />} />
          <Route path="counts/:id" element={<CountPage />} />
          <Route path="reorder" element={<Reorder />} />
          <Route path="sales" element={<Sales />} />
          <Route path="team" element={<Team />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="settings" element={<Settings />} />
          {/* Casa de celulares */}
          <Route path="serials" element={<Serials />} />
          <Route path="serials/:id" element={<SerialDetail />} />
          <Route path="deposits" element={<Deposits />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/:id" element={<CustomerDetail />} />
          <Route path="tradeins" element={<TradeIns />} />
          <Route path="tradeins/new" element={<NewTradeIn />} />
          <Route path="tradeins/prices" element={<TradeInPrices />} />
          <Route path="tradeins/:id" element={<TradeInDetail />} />
          <Route path="repairs" element={<Repairs />} />
          <Route path="repairs/new" element={<NewRepair />} />
          <Route path="repairs/:id" element={<RepairDetail />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/new" element={<NewOrder />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="deliveries" element={<Deliveries />} />
          <Route path="reports" element={<PhoneReports />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </MeContext.Provider>
  );
}

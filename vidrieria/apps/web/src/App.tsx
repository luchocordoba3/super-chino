import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Loading, Toaster } from './components/ui';
import { PanelLayout } from './components/PanelLayout';
import { Landing } from './pages/Landing';
import { Login, Signup } from './pages/Auth';
import { PublicQuotePage } from './pages/PublicQuote';
import { Site } from './site/Site';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Leads = lazy(() => import('./pages/Leads'));
const Quotes = lazy(() => import('./pages/Quotes'));
const QuoteEditor = lazy(() => import('./pages/QuoteEditor'));
const Customers = lazy(() => import('./pages/Customers'));
const Prices = lazy(() => import('./pages/Prices'));
const MySite = lazy(() => import('./pages/MySite'));
const Settings = lazy(() => import('./pages/Settings'));

declare global {
  interface Window {
    /** Lo pone el servidor cuando la vidriería entra por su dominio propio. */
    __SLUG__?: string;
  }
}

function SiteBySlug() {
  const { slug } = useParams();
  return <Site slug={slug!} />;
}

export function App() {
  return (
    <>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={window.__SLUG__ ? <Site slug={window.__SLUG__} /> : <Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/crear-cuenta" element={<Signup />} />
          <Route path="/p/:token" element={<PublicQuotePage />} />
          <Route path="/panel" element={<PanelLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="consultas" element={<Leads />} />
            <Route path="presupuestos" element={<Quotes />} />
            <Route path="presupuestos/nuevo" element={<QuoteEditor />} />
            <Route path="presupuestos/:id" element={<QuoteEditor />} />
            <Route path="clientes" element={<Customers />} />
            <Route path="precios" element={<Prices />} />
            <Route path="mi-web" element={<MySite />} />
            <Route path="ajustes" element={<Settings />} />
            <Route path="*" element={<Navigate to="/panel" replace />} />
          </Route>
          <Route path="/:slug" element={<SiteBySlug />} />
        </Routes>
      </Suspense>
      <Toaster />
    </>
  );
}

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Gate } from './components/Locked';
import { Loading, Toaster } from './components/ui';
import { PanelLayout } from './components/PanelLayout';
import { Landing } from './pages/Landing';
import { Login, Signup } from './pages/Auth';
// Medir va en el paquete principal: tiene que abrir sin señal aunque nunca se haya entrado antes.
import Measure from './pages/Measure';
import { CrewSheetPage } from './pages/CrewSheet';
import { PublicQuotePage } from './pages/PublicQuote';
import { WarrantyPage } from './pages/Warranty';
import { Site } from './site/Site';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Leads = lazy(() => import('./pages/Leads'));
const Quotes = lazy(() => import('./pages/Quotes'));
const QuoteEditor = lazy(() => import('./pages/QuoteEditor'));
const Customers = lazy(() => import('./pages/Customers'));
const MySite = lazy(() => import('./pages/MySite'));
const Settings = lazy(() => import('./pages/Settings'));
const Materials = lazy(() => import('./pages/Materials'));
const Jobs = lazy(() => import('./pages/Jobs'));
const LuminaAdmin = lazy(() => import('./pages/LuminaAdmin'));

declare global {
  interface Window {
    /** Lo pone el servidor cuando la vidriería entra por su dominio propio. */
    __SLUG__?: string;
  }
}

/** Mientras se termina una sección. */
function Soon({ title }: { title: string }) {
  return (
    <section className="card locked">
      <h1>{title}</h1>
      <p className="muted">Esta sección se está terminando y aparece acá en los próximos días.</p>
    </section>
  );
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
          <Route path="/o/:token" element={<CrewSheetPage />} />
          <Route path="/g/:token" element={<WarrantyPage />} />
          <Route path="/panel" element={<PanelLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="consultas" element={<Leads />} />
            <Route path="presupuestos" element={<Quotes />} />
            <Route path="presupuestos/nuevo" element={<QuoteEditor />} />
            <Route path="presupuestos/:id" element={<QuoteEditor />} />
            <Route path="medir" element={<Gate feature="measure"><Measure /></Gate>} />
            <Route path="trabajos" element={<Gate feature="jobs"><Jobs /></Gate>} />
            <Route path="materiales/:tab?" element={<Materials />} />
            <Route path="precios" element={<Navigate to="/panel/materiales" replace />} />
            <Route path="compras" element={<Navigate to="/panel/materiales/compras" replace />} />
            <Route path="clientes" element={<Customers />} />
            <Route path="lumina" element={<LuminaAdmin />} />
            <Route path="caja" element={<Soon title="Caja" />} />
            <Route path="numeros" element={<Soon title="Números" />} />
            <Route path="marketing" element={<Soon title="Marketing" />} />
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

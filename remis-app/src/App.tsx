import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Toaster } from './components/ui';
import { DataGate } from './lib/data';
import { Car } from './pages/Car';
import { History } from './pages/History';
import { Home } from './pages/Home';
import { SettingsPage } from './pages/Settings';
import { Summary } from './pages/Summary';

export function App() {
  return (
    <>
      <DataGate>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="movimientos" element={<History />} />
            <Route path="auto" element={<Navigate to="/auto/mantenimiento" replace />} />
            <Route path="auto/:tab" element={<Car />} />
            <Route path="resumen" element={<Summary />} />
            <Route path="ajustes" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </DataGate>
      <Toaster />
    </>
  );
}

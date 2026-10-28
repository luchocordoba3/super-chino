import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Toaster } from './components/ui';
import { DataGate } from './lib/data';
import { Activate } from './pages/Activate';
import { AddCar } from './pages/AddCar';
import { Car } from './pages/Car';
import { History } from './pages/History';
import { Home } from './pages/Home';
import { Seller } from './pages/Seller';
import { SettingsPage } from './pages/Settings';
import { Summary } from './pages/Summary';

function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="movimientos" element={<History />} />
        <Route path="auto" element={<Navigate to="/auto/mantenimiento" replace />} />
        <Route path="auto/:tab" element={<Car />} />
        <Route path="resumen" element={<Summary />} />
        <Route path="ajustes" element={<SettingsPage />} />
        <Route path="autos/nuevo" element={<AddCar />} />
        <Route path="vendedor" element={<Seller />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <>
      <Routes>
        {/* El link de activación anda aunque la app todavía no esté configurada. */}
        <Route path="activar" element={<Activate />} />
        <Route
          path="*"
          element={
            <DataGate>
              <AppRoutes />
            </DataGate>
          }
        />
      </Routes>
      <Toaster />
    </>
  );
}

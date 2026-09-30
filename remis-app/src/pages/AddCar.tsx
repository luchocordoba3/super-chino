import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CarSections, carInput, emptyCar, type CarForm } from '../components/forms/vehicle';
import { toast } from '../components/ui';
import { addVehicle } from '../db/repo';

/** Sumar otro auto: tuyo o para un chofer. Queda como el auto que estás viendo. */
export function AddCar() {
  const nav = useNavigate();
  const [car, setCar] = useState<CarForm>(() => ({ ...emptyCar(), driver: 'chofer' }));
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const input = carInput(car);
    if (typeof input === 'string') return toast(input);
    setBusy(true);
    try {
      await addVehicle(input);
      toast('Auto agregado. Lo cambiás tocando la patente de arriba.');
      nav('/');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <h1>Otro auto</h1>
      <CarSections form={car} set={(patch) => setCar((c) => ({ ...c, ...patch }))} title="El auto" withDriver />
      <button type="button" className="primary big" onClick={() => void add()} disabled={busy}>
        Agregar auto
      </button>
      <button type="button" className="link" onClick={() => nav(-1)} style={{ alignSelf: 'center' }}>
        Cancelar
      </button>
    </div>
  );
}

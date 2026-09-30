import { useRef, useState } from 'react';
import { CarSections, carInput, emptyCar, type CarForm } from '../components/forms/vehicle';
import { Field, MoneyField, QtyField, Seg, toast } from '../components/ui';
import { importBackup } from '../db/backup';
import { loadDemo } from '../db/demo';
import { setup } from '../db/repo';
import type { AgencyConfig, AgencyMode, AgencyPeriod } from '../db/types';
import { parseNum } from '../lib/format';

export function agencyFrom(mode: AgencyMode, amount: string, period: AgencyPeriod, percent: string): AgencyConfig | string {
  if (mode === 'fixed') {
    const a = parseNum(amount);
    return a && a > 0 ? { mode, amount: a, period } : 'Poné cuánto pagás de base';
  }
  if (mode === 'percent') {
    const p = parseNum(percent);
    return p && p > 0 && p < 100 ? { mode, percent: p } : 'Poné el porcentaje que se lleva la agencia';
  }
  return { mode: 'none' };
}

export function AgencyFields(p: {
  mode: AgencyMode;
  setMode: (m: AgencyMode) => void;
  amount: string;
  setAmount: (v: string) => void;
  period: AgencyPeriod;
  setPeriod: (v: AgencyPeriod) => void;
  percent: string;
  setPercent: (v: string) => void;
}) {
  return (
    <>
      <Seg
        label="Cómo le pagás a la agencia"
        options={[
          { id: 'none', label: 'Ya descontado' },
          { id: 'percent', label: 'Porcentaje' },
          { id: 'fixed', label: 'Base fija' },
        ]}
        value={p.mode}
        onChange={p.setMode}
      />
      {p.mode === 'none' && <p className="hint">La agencia se queda su parte antes. Lo que te pasan ya es tuyo.</p>}
      {p.mode === 'fixed' && (
        <div className="grid2">
          <MoneyField label="Monto de la base" value={p.amount} onChange={p.setAmount} />
          <Field label="Cada">
            <select value={p.period} onChange={(e) => p.setPeriod(e.target.value as AgencyPeriod)}>
              <option value="day">Día</option>
              <option value="week">Semana</option>
              <option value="month">Mes</option>
            </select>
          </Field>
        </div>
      )}
      {p.mode === 'percent' && <QtyField label="Porcentaje de lo recaudado (%)" value={p.percent} onChange={p.setPercent} hint="Se descuenta solo de cada ingreso." />}
    </>
  );
}

export function Onboarding() {
  const [car, setCar] = useState<CarForm>(emptyCar);
  const [mode, setMode] = useState<AgencyMode>('none');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<AgencyPeriod>('week');
  const [percent, setPercent] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const start = async () => {
    const input = carInput(car);
    if (typeof input === 'string') return toast(input);
    const agency = agencyFrom(mode, amount, period, percent);
    if (typeof agency === 'string') return toast(agency);
    setBusy(true);
    try {
      await setup({ ...input, agency });
      void navigator.storage?.persist?.();
      toast('¡Listo! Ya podés empezar tu primer turno');
    } finally {
      setBusy(false);
    }
  };
  const demo = async () => {
    setBusy(true);
    await loadDemo();
    void navigator.storage?.persist?.();
    toast('Datos de ejemplo cargados. Los borrás en Ajustes.');
  };

  const restore = async (f: File) => {
    try {
      await importBackup(await f.text());
      toast('Copia restaurada');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div className="onb stack">
      <div className="row" style={{ gap: 14 }}>
        <img className="onb-logo" src="/icon.svg" alt="" />
        <div>
          <h1>Mi Remis</h1>
          <p className="muted">Km, service, combustible, peajes y lo que ganás de verdad.</p>
        </div>
      </div>
      <p className="muted small">Todo queda guardado en este celular y anda sin internet. Cargá tu auto y arrancá.</p>

      <CarSections form={car} set={(patch) => setCar((c) => ({ ...c, ...patch }))} />

      <section className="card stack">
        <h2>La agencia</h2>
        <AgencyFields mode={mode} setMode={setMode} amount={amount} setAmount={setAmount} period={period} setPeriod={setPeriod} percent={percent} setPercent={setPercent} />
      </section>

      <button type="button" className="primary big" onClick={() => void start()} disabled={busy}>
        Empezar
      </button>
      <button type="button" className="link" onClick={() => void demo()} disabled={busy} style={{ alignSelf: 'center' }}>
        Primero quiero verla con datos de ejemplo
      </button>
      <button type="button" className="link" onClick={() => file.current?.click()} disabled={busy} style={{ alignSelf: 'center' }}>
        Tengo una copia de seguridad
      </button>
      <input ref={file} type="file" accept="application/json,.json" hidden data-testid="restore-onb" onChange={(e) => e.target.files?.[0] && void restore(e.target.files[0])} />
    </div>
  );
}

import { useRef, useState } from 'react';
import { KmField, MoneyField, QtyField, Seg, Field, toast } from '../components/ui';
import { importBackup } from '../db/backup';
import { loadDemo } from '../db/demo';
import { setup } from '../db/repo';
import type { AgencyConfig, AgencyMode, AgencyPeriod, DocType, FuelType } from '../db/types';
import { DOC_TYPES, defaultDocTypes } from '../domain/documents';
import { FUEL_LABEL } from '../domain/fuel';
import { parseKm, parseNum } from '../lib/format';

const FUELS: FuelType[] = ['nafta', 'gnc', 'gasoil'];
const MAIN_DOCS: DocType[] = ['vtv', 'seguro', 'licencia', 'habilitacion', 'oblea_gnc'];

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
          { id: 'fixed', label: 'Base fija' },
          { id: 'percent', label: 'Porcentaje' },
          { id: 'none', label: 'No pago' },
        ]}
        value={p.mode}
        onChange={p.setMode}
      />
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
  const [name, setName] = useState('');
  const [plate, setPlate] = useState('');
  const [year, setYear] = useState('');
  const [fuels, setFuels] = useState<FuelType[]>(['nafta', 'gnc']);
  const [km, setKm] = useState('');
  const [shared, setShared] = useState(false);
  const [oilKm, setOilKm] = useState('');
  const [oilDate, setOilDate] = useState('');
  const [mode, setMode] = useState<AgencyMode>('fixed');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<AgencyPeriod>('week');
  const [percent, setPercent] = useState('');
  const [docs, setDocs] = useState<Partial<Record<DocType, string>>>({});
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const toggleFuel = (f: FuelType) => setFuels((x) => (x.includes(f) ? x.filter((y) => y !== f) : [...x, f]));
  const docTypes = defaultDocTypes(fuels).filter((t) => MAIN_DOCS.includes(t));

  const start = async () => {
    const k = parseKm(km);
    if (k == null) return toast('Poné los km que marca el odómetro');
    if (!fuels.length) return toast('Elegí al menos un combustible');
    const agency = agencyFrom(mode, amount, period, percent);
    if (typeof agency === 'string') return toast(agency);
    setBusy(true);
    try {
      await setup({
        vehicle: { name: name.trim() || 'Mi auto', plate: plate.trim().toUpperCase(), year: Number(year) || undefined, fuels: FUELS.filter((f) => fuels.includes(f)), initialKm: k, shared },
        oil: { km: parseKm(oilKm) ?? undefined, date: oilDate || undefined },
        agency,
        docs: Object.fromEntries(Object.entries(docs).filter(([t]) => docTypes.includes(t as DocType))),
      });
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

      <section className="card stack">
        <h2>Tu auto</h2>
        <Field label="Marca y modelo">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Chevrolet Prisma" />
        </Field>
        <div className="grid2">
          <Field label="Patente">
            <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="AB 123 CD" autoCapitalize="characters" />
          </Field>
          <Field label="Año">
            <input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="2019" />
          </Field>
        </div>
        <Field label="Combustible">
          <div className="chips">
            {FUELS.map((f) => (
              <button key={f} type="button" aria-pressed={fuels.includes(f)} className={fuels.includes(f) ? 'on' : ''} onClick={() => toggleFuel(f)}>
                {FUEL_LABEL[f]}
              </button>
            ))}
          </div>
        </Field>
        <KmField label="Km que marca hoy el odómetro" value={km} onChange={setKm} big />
        <label className="check">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          Lo comparto con otro chofer (día y noche)
        </label>
      </section>

      <section className="card stack">
        <h2>Último cambio de aceite</h2>
        <p className="muted small">Para avisarte cuándo toca el próximo. Si no te acordás, dejalo vacío y lo cargás después.</p>
        <div className="grid2">
          <KmField label="A los km" value={oilKm} onChange={setOilKm} />
          <Field label="Fecha">
            <input type="date" value={oilDate} onChange={(e) => setOilDate(e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="card stack">
        <h2>La agencia</h2>
        <AgencyFields mode={mode} setMode={setMode} amount={amount} setAmount={setAmount} period={period} setPeriod={setPeriod} percent={percent} setPercent={setPercent} />
      </section>

      <section className="card stack">
        <h2>Vencimientos</h2>
        <p className="muted small">Opcional. Te avisamos 30 días antes.</p>
        {docTypes.map((t) => (
          <Field key={t} label={DOC_TYPES[t].label}>
            <input type="date" value={docs[t] ?? ''} onChange={(e) => setDocs((x) => ({ ...x, [t]: e.target.value }))} />
          </Field>
        ))}
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

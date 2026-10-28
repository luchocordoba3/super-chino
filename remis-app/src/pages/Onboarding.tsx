import { useRef, useState } from 'react';
import { CarSections, carInput, emptyCar, type CarForm } from '../components/forms/vehicle';
import { Field, MoneyField, QtyField, Seg, toast } from '../components/ui';
import { BRAND } from '../brand';
import { CONFIG, licensing } from '../config';
import { MONO_CATS, MONO_TABLE } from '../domain/monotributo';
import { PLATFORM_IDS, PLATFORM_LABEL, platformsFrom } from '../domain/platforms';
import { newInstallId } from '../domain/license';
import { localTrial, pendingCode } from '../lib/install';
import { importBackup } from '../db/backup';
import { loadDemo } from '../db/demo';
import { setup } from '../db/repo';
import type { AgencyConfig, AgencyMode, AgencyPeriod, MonoCat, PlatformId } from '../db/types';
import { money, parseNum } from '../lib/format';

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
  const [apps, setApps] = useState<PlatformId[]>([]);
  const [goal, setGoal] = useState('');
  const [mono, setMono] = useState<MonoCat | ''>('');
  const [mode, setMode] = useState<AgencyMode>('none');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<AgencyPeriod>('week');
  const [percent, setPercent] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const remis = apps.includes('agencia');
  const start = async () => {
    if (!apps.length) return toast('Elegí con qué manejás');
    const input = carInput(car);
    if (typeof input === 'string') return toast(input);
    const agency = remis ? agencyFrom(mode, amount, period, percent) : { mode: 'none' as const };
    if (typeof agency === 'string') return toast(agency);
    setBusy(true);
    try {
      const local = localTrial();
      const g = parseNum(goal);
      await setup({
        ...input,
        agency,
        extra: {
          platforms: platformsFrom(apps),
          goal: g ? { day: g } : undefined,
          monotributo: mono ? { cat: mono, monthly: Math.round(MONO_TABLE[mono].monthly), limit: Math.round(MONO_TABLE[mono].limit) } : undefined,
          installId: local.installId ?? newInstallId(),
          trialStart: local.trialStart ?? new Date().toISOString(),
          license: pendingCode(),
        },
      });
      pendingCode(null);
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
          <h1>{BRAND.name}</h1>
          <p className="muted">{BRAND.tagline}.</p>
        </div>
      </div>
      <ul className="pitch">
        <li>Lo que te queda de verdad por día, por hora y por km, después de nafta, comisiones y gastos.</li>
        <li>¿Te conviene el viaje? Ponés lo que te pagan y los km, y te dice si rinde.</li>
        <li>Avisos de service, VTV, seguro y licencia, y el monotributo al día.</li>
        <li>Anda sin internet y tus datos no salen de tu celular.</li>
      </ul>
      {licensing() && (
        <p className="small">
          <strong>{CONFIG.trialDays} días gratis.</strong> Después, {money(CONFIG.prices.mes)} por mes o {money(CONFIG.prices.anual)} por año.
        </p>
      )}

      <section className="card stack">
        <h2>¿Con qué manejás?</h2>
        <div className="chips" role="group" aria-label="Con qué manejás">
          {PLATFORM_IDS.map((id) => (
            <button key={id} type="button" aria-pressed={apps.includes(id)} className={apps.includes(id) ? 'on' : ''} onClick={() => setApps((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))}>
              {id === 'agencia' ? 'Remis (agencia)' : PLATFORM_LABEL[id]}
            </button>
          ))}
        </div>
        <p className="hint">Al terminar cada turno anotás lo que hiciste en cada una (lo que la app te muestra como ganancia).</p>
      </section>

      <CarSections form={car} set={(patch) => setCar((c) => ({ ...c, ...patch }))} />

      {remis && (
        <section className="card stack">
          <h2>La agencia</h2>
          <AgencyFields mode={mode} setMode={setMode} amount={amount} setAmount={setAmount} period={period} setPeriod={setPeriod} percent={percent} setPercent={setPercent} />
        </section>
      )}

      <section className="card stack">
        <h2>Opcional</h2>
        <MoneyField label="¿Cuánto querés hacer por día?" value={goal} onChange={setGoal} hint="Tu meta: la ves en Hoy con lo que te falta." />
        <Field label="Monotributo" hint="Te avisa cuándo vence la cuota y si te acercás al tope.">
          <select value={mono} onChange={(e) => setMono(e.target.value as MonoCat | '')}>
            <option value="">No soy monotributista / después</option>
            {MONO_CATS.map((c) => (
              <option key={c} value={c}>
                Categoría {c}
              </option>
            ))}
          </select>
        </Field>
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

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/icons';
import { Field, KmField, MoneyField, Seg, toast } from '../components/ui';
import { backupFileName, exportBackup, importBackup } from '../db/backup';
import { db, newId } from '../db/db';
import { loadDemo } from '../db/demo';
import { ensureFuelDefaults, saveSettings, wipeAll } from '../db/repo';
import type { AgencyMode, AgencyPeriod, FuelType, Settings } from '../db/types';
import { FUEL_LABEL } from '../domain/fuel';
import { useData } from '../lib/data';
import { dateTimeFmt, money, numFmt, numInput, parseKm, parseNum } from '../lib/format';
import { canShareFiles, download, shareFiles } from '../lib/share';
import { AgencyFields, agencyFrom } from './Onboarding';
import { moneyInput } from '../components/forms/money';

const FUELS: FuelType[] = ['nafta', 'gnc', 'gasoil'];
const intFmt = new Intl.NumberFormat('es-AR');

function VehicleCard() {
  const d = useData();
  const v = d.vehicle;
  const [name, setName] = useState(v.name);
  const [plate, setPlate] = useState(v.plate);
  const [year, setYear] = useState(v.year ? String(v.year) : '');
  const [fuels, setFuels] = useState<FuelType[]>(v.fuels);
  const [shared, setShared] = useState(v.shared);
  const [initialKm, setInitialKm] = useState(intFmt.format(v.initialKm));
  const save = async () => {
    const k = parseKm(initialKm);
    if (!fuels.length) return toast('Elegí al menos un combustible');
    if (k == null) return toast('Poné el km inicial');
    const next = { ...v, name: name.trim() || 'Mi auto', plate: plate.trim().toUpperCase(), year: Number(year) || undefined, fuels: FUELS.filter((f) => fuels.includes(f)), shared, initialKm: k };
    await db.vehicles.put(next);
    await ensureFuelDefaults(next);
    toast('Auto guardado');
  };
  return (
    <section className="card stack">
      <h2>Tu auto</h2>
      <Field label="Marca y modelo">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid2">
        <Field label="Patente">
          <input value={plate} onChange={(e) => setPlate(e.target.value)} autoCapitalize="characters" />
        </Field>
        <Field label="Año">
          <input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        </Field>
      </div>
      <Field label="Combustible">
        <div className="chips">
          {FUELS.map((f) => (
            <button key={f} type="button" aria-pressed={fuels.includes(f)} className={fuels.includes(f) ? 'on' : ''} onClick={() => setFuels((x) => (x.includes(f) ? x.filter((y) => y !== f) : [...x, f]))}>
              {FUEL_LABEL[f]}
            </button>
          ))}
        </div>
      </Field>
      <label className="check">
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
        Lo comparto con otro chofer
      </label>
      <KmField label="Km cuando empezaste a usar la app" value={initialKm} onChange={setInitialKm} hint="El km actual sale solo de lo que vas anotando." />
      <button type="button" className="primary" onClick={() => void save()}>
        Guardar auto
      </button>
    </section>
  );
}

function AgencyCard({ settings }: { settings: Settings }) {
  const a = settings.agency;
  const [mode, setMode] = useState<AgencyMode>(a.mode);
  const [amount, setAmount] = useState(moneyInput(a.amount));
  const [period, setPeriod] = useState<AgencyPeriod>(a.period ?? 'week');
  const [percent, setPercent] = useState(numInput(a.percent));
  const save = async () => {
    const agency = agencyFrom(mode, amount, period, percent);
    if (typeof agency === 'string') return toast(agency);
    await saveSettings({ agency });
    toast('Guardado. Los ingresos nuevos usan esta forma de pago.');
  };
  return (
    <section className="card stack">
      <h2>La agencia</h2>
      <AgencyFields mode={mode} setMode={setMode} amount={amount} setAmount={setAmount} period={period} setPeriod={setPeriod} percent={percent} setPercent={setPercent} />
      <button type="button" className="primary" onClick={() => void save()}>
        Guardar
      </button>
    </section>
  );
}

function TollsCard({ settings }: { settings: Settings }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const add = async () => {
    const amt = parseNum(amount);
    if (!name.trim() || !amt) return toast('Poné nombre y monto');
    await saveSettings({ tolls: [...settings.tolls, { id: newId(), name: name.trim(), amount: amt }] });
    setName('');
    setAmount('');
  };
  return (
    <section className="card stack">
      <h2>Mis peajes</h2>
      <p className="muted small">Aparecen como botones al anotar un peaje: un toque y listo.</p>
      {settings.tolls.length > 0 && (
        <div className="list">
          {settings.tolls.map((t) => (
            <div key={t.id} className="item">
              <span className="grow t">{t.name}</span>
              <span className="amt">{money(t.amount)}</span>
              <button type="button" className="ghost small" aria-label={`Sacar ${t.name}`} onClick={() => void saveSettings({ tolls: settings.tolls.filter((x) => x.id !== t.id) })}>
                <Icon name="x" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="grid2">
        <Field label="Nombre">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Autopista" />
        </Field>
        <MoneyField label="Monto" value={amount} onChange={setAmount} />
      </div>
      <button type="button" onClick={() => void add()}>
        <Icon name="plus" /> Agregar peaje
      </button>
    </section>
  );
}

function BackupCard({ settings }: { settings: Settings }) {
  const [photos, setPhotos] = useState(true);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const make = async () => new File([await exportBackup(photos)], backupFileName(), { type: 'application/json' });
  const done = () => saveSettings({ lastBackupAt: new Date().toISOString() }).then(() => toast('Copia guardada'));
  const share = async () => {
    setBusy(true);
    try {
      const f = await make();
      if (await shareFiles([f], 'Copia de Mi Remis', f.name)) await done();
    } catch {
      toast('No se pudo compartir. Probá con "Descargar".');
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const f = await make();
      download(f, f.name);
      await done();
    } finally {
      setBusy(false);
    }
  };
  const restore = async (f: File) => {
    if (!confirm('Esto reemplaza todo lo que hay en este celular por lo de la copia. ¿Seguir?')) return;
    try {
      await importBackup(await f.text());
      toast('Copia restaurada');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const sharable = canShareFiles([new File(['{}'], 'x.json', { type: 'application/json' })]);
  return (
    <section className="card stack">
      <h2>Copia de seguridad</h2>
      <p className="muted small">
        Tus datos están solo en este celular. Guardá una copia seguido (por ejemplo, mandala a tu WhatsApp o a Drive) para no perder nada si cambiás o perdés el
        teléfono.
      </p>
      <p className="small">{settings.lastBackupAt ? `Última copia: ${dateTimeFmt(settings.lastBackupAt)}` : 'Todavía no hiciste ninguna copia.'}</p>
      <label className="check">
        <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} />
        Incluir las fotos (el archivo pesa más)
      </label>
      <div className="grid2">
        {sharable && (
          <button type="button" className="primary" onClick={() => void share()} disabled={busy}>
            <Icon name="share" /> Compartir
          </button>
        )}
        <button type="button" className={sharable ? '' : 'primary'} onClick={() => void save()} disabled={busy}>
          <Icon name="download" /> Descargar
        </button>
      </div>
      <button type="button" onClick={() => file.current?.click()}>
        <Icon name="upload" /> Restaurar una copia
      </button>
      <input ref={file} type="file" accept="application/json,.json" hidden data-testid="restore" onChange={(e) => e.target.files?.[0] && void restore(e.target.files[0]).finally(() => (e.target.value = ''))} />
    </section>
  );
}

function StorageCard() {
  const [info, setInfo] = useState<{ persisted: boolean; used?: number } | null>(null);
  const load = async () => {
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    const est = await navigator.storage?.estimate?.();
    setInfo({ persisted, used: est?.usage });
  };
  useEffect(() => {
    void load();
  }, []);
  const ask = async () => {
    const ok = await navigator.storage?.persist?.();
    toast(ok ? 'Listo: el navegador no va a borrar tus datos' : 'El navegador no lo permitió. Instalá la app en la pantalla de inicio y probá de nuevo.');
    void load();
  };
  if (!info) return null;
  return (
    <section className="card stack-s">
      <h2>Almacenamiento</h2>
      <p className="small">
        {info.persisted ? 'Protegido: el navegador no borra tus datos solo.' : 'Sin proteger: si el celular se queda sin lugar, el navegador podría borrar los datos.'}
        {info.used != null && ` Ocupa ${numFmt(info.used / 1_048_576)} MB.`}
      </p>
      {!info.persisted && (
        <button type="button" onClick={() => void ask()}>
          Proteger mis datos
        </button>
      )}
    </section>
  );
}

export function SettingsPage() {
  const d = useData();
  return (
    <div className="stack">
      <h1>Ajustes</h1>
      <BackupCard settings={d.settings} />
      <VehicleCard key={d.vehicle.id} />
      <AgencyCard settings={d.settings} />
      <TollsCard settings={d.settings} />
      <section className="card stack-s">
        <h2>Pantalla</h2>
        <Seg
          label="Tema"
          options={[
            { id: 'auto', label: 'Automático' },
            { id: 'light', label: 'Claro' },
            { id: 'dark', label: 'Oscuro' },
          ]}
          value={d.settings.theme}
          onChange={(theme) => void saveSettings({ theme })}
        />
      </section>
      <StorageCard />
      <section className="card stack-s">
        <h2>Empezar de nuevo</h2>
        <button
          type="button"
          onClick={() => confirm('Se reemplaza todo por datos de ejemplo. ¿Seguir?') && void loadDemo().then(() => toast('Datos de ejemplo cargados'))}
        >
          Cargar datos de ejemplo
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => confirm('¿Borrar TODO lo que hay en la app? No se puede deshacer.') && confirm('¿Seguro? Si no tenés una copia, se pierde todo.') && void wipeAll()}
        >
          Borrar todo
        </button>
      </section>
      <p className="hint" style={{ textAlign: 'center' }}>
        Mi Remis 0.1 · Anda sin internet · Tus datos no salen de este celular
      </p>
    </div>
  );
}

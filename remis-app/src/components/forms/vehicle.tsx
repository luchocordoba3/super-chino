import type { DocType, Driver, FuelType, SettlePeriod } from '../../db/types';
import type { VehicleInput } from '../../db/repo';
import { DOC_TYPES, defaultDocTypes } from '../../domain/documents';
import { FUEL_LABEL } from '../../domain/fuel';
import { SETTLE_LABEL } from '../../domain/settlement';
import { parseKm, parseNum } from '../../lib/format';
import { Field, KmField, QtyField, Seg } from '../ui';

// Formulario de un auto: lo usan la bienvenida y "Agregar otro auto".

export const FUELS: FuelType[] = ['nafta', 'gnc', 'gasoil'];
const MAIN_DOCS: DocType[] = ['vtv', 'seguro', 'licencia', 'habilitacion', 'oblea_gnc'];

export interface DriverForm {
  driver: Driver;
  choferName: string;
  percent: string;
  period: SettlePeriod;
}

export interface CarForm extends DriverForm {
  name: string;
  plate: string;
  year: string;
  fuels: FuelType[];
  km: string;
  shared: boolean;
  oilKm: string;
  oilDate: string;
  docs: Partial<Record<DocType, string>>;
}

export const emptyCar = (): CarForm => ({
  name: '',
  plate: '',
  year: '',
  fuels: ['nafta', 'gnc'],
  km: '',
  shared: false,
  oilKm: '',
  oilDate: '',
  docs: {},
  driver: 'me',
  choferName: '',
  percent: '50',
  period: 'quincena',
});

/** Quién lo maneja, listo para guardar en el auto. Devuelve un texto si falta algo. */
export function driverFrom(f: DriverForm) {
  if (f.driver === 'me') return { driver: 'me' as const };
  const percent = parseNum(f.percent);
  if (!percent || percent <= 0 || percent >= 100) return 'Poné qué porcentaje se lleva el chofer (por ejemplo 50)';
  return { driver: 'chofer' as const, chofer: { name: f.choferName.trim(), percent, period: f.period } };
}

/** Valida el formulario y arma lo que necesita addVehicle. Devuelve un texto si falta algo. */
export function carInput(f: CarForm): VehicleInput | string {
  const km = parseKm(f.km);
  if (km == null) return 'Poné los km que marca el odómetro';
  if (!f.fuels.length) return 'Elegí al menos un combustible';
  const who = driverFrom(f);
  if (typeof who === 'string') return who;
  const docTypes = docTypesFor(f.fuels);
  return {
    vehicle: {
      name: f.name.trim() || 'Mi auto',
      plate: f.plate.trim().toUpperCase(),
      year: Number(f.year) || undefined,
      fuels: FUELS.filter((x) => f.fuels.includes(x)),
      initialKm: km,
      shared: who.driver === 'me' && f.shared,
      ...who,
    },
    oil: { km: parseKm(f.oilKm) ?? undefined, date: f.oilDate || undefined },
    docs: Object.fromEntries(Object.entries(f.docs).filter(([t]) => docTypes.includes(t as DocType))),
  };
}

const docTypesFor = (fuels: FuelType[]) => defaultDocTypes(fuels).filter((t) => MAIN_DOCS.includes(t));

export function FuelChips({ value, onChange }: { value: FuelType[]; onChange: (v: FuelType[]) => void }) {
  return (
    <Field label="Combustible">
      <div className="chips">
        {FUELS.map((f) => (
          <button key={f} type="button" aria-pressed={value.includes(f)} className={value.includes(f) ? 'on' : ''} onClick={() => onChange(value.includes(f) ? value.filter((y) => y !== f) : [...value, f])}>
            {FUEL_LABEL[f]}
          </button>
        ))}
      </div>
    </Field>
  );
}

/** ¿Quién lo maneja? Vos, o un chofer con el que van a porcentaje. */
export function DriverFields({ form, set }: { form: DriverForm; set: (patch: Partial<DriverForm>) => void }) {
  return (
    <>
      <Seg
        label="Quién lo maneja"
        options={[
          { id: 'me', label: 'Lo manejo yo' },
          { id: 'chofer', label: 'Un chofer' },
        ]}
        value={form.driver}
        onChange={(driver) => set({ driver })}
      />
      {form.driver === 'chofer' && (
        <>
          <Field label="Nombre del chofer">
            <input value={form.choferName} onChange={(e) => set({ choferName: e.target.value })} placeholder="Ej.: Juan" autoCapitalize="words" />
          </Field>
          <div className="grid2">
            <QtyField label="Parte del chofer (%)" value={form.percent} onChange={(percent) => set({ percent })} />
            <Field label="Se liquida cada">
              <select value={form.period} onChange={(e) => set({ period: e.target.value as SettlePeriod })}>
                {(Object.keys(SETTLE_LABEL) as SettlePeriod[]).map((k) => (
                  <option key={k} value={k}>
                    {SETTLE_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="hint">Primero se le devuelven los peajes con pasajero y lo que queda se divide. El combustible, el lavado y los peajes sin pasajero los paga él.</p>
        </>
      )}
    </>
  );
}

/** Datos del auto, último cambio de aceite y vencimientos. */
export function CarSections({ form, set, title = 'Tu auto', withDriver }: { form: CarForm; set: (patch: Partial<CarForm>) => void; title?: string; withDriver?: boolean }) {
  const docTypes = docTypesFor(form.fuels);
  return (
    <>
      <section className="card stack">
        <h2>{title}</h2>
        <Field label="Marca y modelo">
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ej.: Chevrolet Prisma" />
        </Field>
        <div className="grid2">
          <Field label="Patente">
            <input value={form.plate} onChange={(e) => set({ plate: e.target.value })} placeholder="AB 123 CD" autoCapitalize="characters" />
          </Field>
          <Field label="Año">
            <input inputMode="numeric" value={form.year} onChange={(e) => set({ year: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="2019" />
          </Field>
        </div>
        <FuelChips value={form.fuels} onChange={(fuels) => set({ fuels })} />
        <KmField label="Km que marca hoy el odómetro" value={form.km} onChange={(km) => set({ km })} big />
        {withDriver && <DriverFields form={form} set={set} />}
        {form.driver === 'me' && (
          <label className="check">
            <input type="checkbox" checked={form.shared} onChange={(e) => set({ shared: e.target.checked })} />
            Lo comparto con otro chofer (día y noche)
          </label>
        )}
      </section>

      <section className="card stack">
        <h2>Último cambio de aceite</h2>
        <p className="muted small">Para avisarte cuándo toca el próximo. Si no te acordás, dejalo vacío y lo cargás después.</p>
        <div className="grid2">
          <KmField label="A los km" value={form.oilKm} onChange={(oilKm) => set({ oilKm })} />
          <Field label="Fecha">
            <input type="date" value={form.oilDate} onChange={(e) => set({ oilDate: e.target.value })} />
          </Field>
        </div>
      </section>

      <section className="card stack">
        <h2>Vencimientos</h2>
        <p className="muted small">Opcional. Te avisamos 30 días antes.</p>
        {docTypes.map((t) => (
          <Field key={t} label={DOC_TYPES[t].label}>
            <input type="date" value={form.docs[t] ?? ''} onChange={(e) => set({ docs: { ...form.docs, [t]: e.target.value } })} />
          </Field>
        ))}
      </section>
    </>
  );
}

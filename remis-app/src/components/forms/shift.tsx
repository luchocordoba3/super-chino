import { useState } from 'react';
import { db, newId } from '../../db/db';
import { removeRecord } from '../../db/repo';
import type { FuelLevel, Shift } from '../../db/types';
import { fromLocalInput, toLocalInput } from '../../domain/dates';
import { kmWarning, shiftKm } from '../../domain/km';
import { agencyFeeFor } from '../../domain/money';
import { useData } from '../../lib/data';
import { kmFmt, money, parseKm, parseNum } from '../../lib/format';
import { PhotoPicker, usePhotos } from '../photos';
import { Field, KmField, MoneyField, SaveBar, Seg, Sheet, toast } from '../ui';

const nf = new Intl.NumberFormat('es-AR');
const kmStr = (n?: number) => (n == null ? '' : nf.format(n));

export const FUEL_LEVELS: { id: FuelLevel; label: string }[] = [
  { id: 0, label: 'Reserva' },
  { id: 1, label: '¼' },
  { id: 2, label: '½' },
  { id: 3, label: '¾' },
  { id: 4, label: 'Lleno' },
];

export function FuelLevelField({ value, onChange }: { value: FuelLevel | undefined; onChange: (v: FuelLevel) => void }) {
  return (
    <Field label="Combustible">
      <Seg label="Nivel de combustible" options={FUEL_LEVELS} value={value ?? (-1 as FuelLevel)} onChange={onChange} />
    </Field>
  );
}

export function ShiftStartSheet({ onClose, onStarted }: { onClose: () => void; onStarted?: () => void }) {
  const d = useData();
  const [km, setKm] = useState(kmStr(d.km));
  const [fuel, setFuel] = useState<FuelLevel>();
  const [note, setNote] = useState('');
  const photos = usePhotos();
  const n = parseKm(km);
  const warning = n != null ? kmWarning(n, d.km) : null;
  const cancel = () => {
    void photos.cancel();
    onClose();
  };
  const save = async () => {
    if (n == null) return toast('Poné los km del odómetro');
    await photos.commit();
    await db.shifts.add({
      id: newId(),
      vehicleId: d.vehicle.id,
      startAt: new Date().toISOString(),
      startKm: n,
      startFuel: fuel,
      startPhotos: photos.ids.length ? photos.ids : undefined,
      startNote: note.trim() || undefined,
    });
    toast('¡Buen turno!');
    onClose();
    onStarted?.();
  };
  return (
    <Sheet title="Empezar turno" onClose={cancel} footer={<SaveBar onSave={save} label="Empezar" />}>
      <KmField label="Km del odómetro" value={km} onChange={setKm} big />
      {warning && <p className="warn-text">{warning}</p>}
      {d.vehicle.shared && (
        <>
          <p className="muted small">Cómo recibís el auto del otro chofer:</p>
          <FuelLevelField value={fuel} onChange={setFuel} />
          <Field label="Fotos del auto" hint="Frente, atrás y costados, por si hay un golpe nuevo.">
            <PhotoPicker photos={photos} />
          </Field>
          <Field label="Algún detalle">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: rayón en la puerta trasera" />
          </Field>
        </>
      )}
    </Sheet>
  );
}

export function ShiftEndSheet({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const d = useData();
  const [km, setKm] = useState(kmStr(Math.max(d.km, shift.startKm)));
  const [fuel, setFuel] = useState<FuelLevel>();
  const [note, setNote] = useState('');
  const [gross, setGross] = useState('');
  const [trips, setTrips] = useState('');
  const [cash, setCash] = useState('');
  const [tips, setTips] = useState('');
  const photos = usePhotos();
  const n = parseKm(km);
  const g = parseNum(gross) ?? 0;
  const fee = agencyFeeFor(g, d.settings.agency);
  const cancel = () => {
    void photos.cancel();
    onClose();
  };
  const save = async () => {
    if (n == null) return toast('Poné los km del odómetro');
    if (n < shift.startKm) return toast(`No puede ser menos que al empezar (${kmFmt(shift.startKm)})`);
    await photos.commit();
    const endAt = new Date().toISOString();
    await db.transaction('rw', db.shifts, db.incomes, async () => {
      await db.shifts.update(shift.id, {
        endAt,
        endKm: n,
        endFuel: fuel,
        endPhotos: photos.ids.length ? photos.ids : undefined,
        endNote: note.trim() || undefined,
      });
      const t = parseNum(tips) ?? 0;
      if (g > 0 || t > 0)
        await db.incomes.add({
          id: newId(),
          vehicleId: d.vehicle.id,
          at: endAt,
          shiftId: shift.id,
          gross: g,
          trips: parseNum(trips) ?? undefined,
          cash: parseNum(cash) ?? undefined,
          tips: t || undefined,
          agencyFee: fee,
        });
    });
    toast(`Turno terminado: ${kmFmt(n - shift.startKm)}`);
    onClose();
  };
  return (
    <Sheet title="Terminar turno" onClose={cancel} footer={<SaveBar onSave={save} label="Terminar" />}>
      <KmField label="Km del odómetro" value={km} onChange={setKm} big hint={n != null && n >= shift.startKm ? `Hiciste ${kmFmt(n - shift.startKm)} en este turno.` : undefined} />
      {n != null && n < shift.startKm && <p className="error-text">Arrancaste con {kmFmt(shift.startKm)}: revisá el número.</p>}
      <h3>¿Cuánto hiciste?</h3>
      <MoneyField label="Recaudado en viajes" value={gross} onChange={setGross} hint={fee ? `La agencia se lleva ${money(fee)} (${d.settings.agency.percent}%).` : undefined} />
      <div className="grid2">
        <Field label="Viajes">
          <input inputMode="numeric" value={trips} onChange={(e) => setTrips(e.target.value.replace(/\D/g, ''))} placeholder="0" />
        </Field>
        <MoneyField label="Propinas" value={tips} onChange={setTips} />
      </div>
      <MoneyField label="De lo recaudado, en efectivo" value={cash} onChange={setCash} hint="Opcional. El resto se toma como transferencia o app." />
      {d.vehicle.shared && (
        <>
          <p className="muted small">Cómo entregás el auto:</p>
          <FuelLevelField value={fuel} onChange={setFuel} />
          <Field label="Fotos del auto">
            <PhotoPicker photos={photos} />
          </Field>
          <Field label="Algún detalle">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </>
      )}
    </Sheet>
  );
}

/** Corregir un turno ya cargado. */
export function ShiftEditSheet({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const d = useData();
  const [startAt, setStartAt] = useState(toLocalInput(shift.startAt));
  const [startKm, setStartKm] = useState(kmStr(shift.startKm));
  const [endAt, setEndAt] = useState(shift.endAt ? toLocalInput(shift.endAt) : '');
  const [endKm, setEndKm] = useState(kmStr(shift.endKm));
  const [startFuel, setStartFuel] = useState(shift.startFuel);
  const [endFuel, setEndFuel] = useState(shift.endFuel);
  const [startNote, setStartNote] = useState(shift.startNote ?? '');
  const [endNote, setEndNote] = useState(shift.endNote ?? '');
  const startPhotos = usePhotos(shift.startPhotos);
  const endPhotos = usePhotos(shift.endPhotos);
  const cancel = () => {
    void startPhotos.cancel();
    void endPhotos.cancel();
    onClose();
  };
  const save = async () => {
    const s = parseKm(startKm);
    const e = parseKm(endKm);
    if (s == null) return toast('Faltan los km del inicio');
    if (e != null && e < s) return toast('Los km del final no pueden ser menos que los del inicio');
    if (e != null && !endAt) return toast('Falta la hora del final');
    await startPhotos.commit();
    await endPhotos.commit();
    const closed = e != null && endAt;
    const next: Shift = {
      ...shift,
      startAt: fromLocalInput(startAt),
      startKm: s,
      startFuel,
      startNote: startNote.trim() || undefined,
      startPhotos: startPhotos.ids.length ? startPhotos.ids : undefined,
      endAt: closed ? fromLocalInput(endAt) : undefined,
      endKm: closed ? e : undefined,
      endFuel: closed ? endFuel : undefined,
      endNote: closed ? endNote.trim() || undefined : undefined,
      endPhotos: closed && endPhotos.ids.length ? endPhotos.ids : undefined,
    };
    await db.shifts.put(next);
    toast('Turno guardado');
    onClose();
  };
  const remove = async () => {
    if (!confirm('¿Borrar este turno? Lo recaudado en ese turno queda en Movimientos.')) return;
    await startPhotos.cancel();
    await endPhotos.cancel();
    await removeRecord('shifts', shift.id);
    toast('Turno borrado');
    onClose();
  };
  return (
    <Sheet title={shift.endAt ? `Turno · ${kmFmt(shiftKm(shift))}` : 'Turno en curso'} onClose={cancel} footer={<SaveBar onSave={save} onDelete={remove} />}>
      <h3>Inicio</h3>
      <div className="grid2">
        <Field label="Fecha y hora">
          <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </Field>
        <KmField label="Km" value={startKm} onChange={setStartKm} />
      </div>
      {d.vehicle.shared && (
        <>
          <FuelLevelField value={startFuel} onChange={setStartFuel} />
          <PhotoPicker photos={startPhotos} />
          <textarea aria-label="Detalle al recibir el auto" value={startNote} onChange={(e) => setStartNote(e.target.value)} placeholder="Detalle al recibir el auto" />
        </>
      )}
      <h3>Final</h3>
      <div className="grid2">
        <Field label="Fecha y hora">
          <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </Field>
        <KmField label="Km" value={endKm} onChange={setEndKm} />
      </div>
      {d.vehicle.shared && (
        <>
          <FuelLevelField value={endFuel} onChange={setEndFuel} />
          <PhotoPicker photos={endPhotos} />
          <textarea aria-label="Detalle al entregar el auto" value={endNote} onChange={(e) => setEndNote(e.target.value)} placeholder="Detalle al entregar el auto" />
        </>
      )}
    </Sheet>
  );
}

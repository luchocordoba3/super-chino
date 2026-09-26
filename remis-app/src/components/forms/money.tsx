import { useMemo, useState } from 'react';
import { db, newId } from '../../db/db';
import { removeRecord, saveSettings } from '../../db/repo';
import type { Expense, ExpenseCategory, FuelLoad, FuelType, Income } from '../../db/types';
import { fromLocalInput, toLocalInput } from '../../domain/dates';
import { FUEL_LABEL, FUEL_UNIT } from '../../domain/fuel';
import { EXPENSE_LABEL, agencyFeeFor } from '../../domain/money';
import { useData } from '../../lib/data';
import { money, money2, numInput, parseKm, parseNum } from '../../lib/format';
import { PhotoPicker, usePhotos } from '../photos';
import { Field, KmField, MoneyField, QtyField, SaveBar, Seg, Sheet, toast } from '../ui';

const intFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const kmStr = (n?: number) => (n == null ? '' : intFmt.format(n));
/** Monto guardado -> texto del campo ("15.000" o "15.000,5"). */
export const moneyInput = (n?: number) => {
  if (n == null) return '';
  const [i, dec] = n.toFixed(2).split('.');
  return intFmt.format(Number(i)) + (dec !== '00' ? `,${dec.replace(/0$/, '')}` : '');
};
const nowInput = () => toLocalInput(new Date().toISOString());

function WhenField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Fecha y hora">
      <input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function FuelSheet({ load, onClose }: { load?: FuelLoad; onClose: () => void }) {
  const d = useData();
  const fuels = d.vehicle.fuels;
  const [fuel, setFuel] = useState<FuelType>(load?.fuel ?? (fuels.includes('gnc') ? 'gnc' : fuels[0]));
  const lastStation = useMemo(
    () => [...d.fuel].sort((a, b) => b.at.localeCompare(a.at)).find((f) => f.fuel === fuel && f.station)?.station ?? '',
    [d.fuel, fuel],
  );
  const [qty, setQty] = useState(load ? numInput(load.qty) : '');
  const [total, setTotal] = useState(moneyInput(load?.total));
  const [km, setKm] = useState(kmStr(load ? load.km : d.km));
  const [full, setFull] = useState(load?.full ?? true);
  const [station, setStation] = useState<string | null>(load ? (load.station ?? '') : null);
  const [at, setAt] = useState(load ? toLocalInput(load.at) : nowInput());
  const photos = usePhotos(load?.photoId ? [load.photoId] : []);
  const q = parseNum(qty);
  const t = parseNum(total);
  const unit = FUEL_UNIT[fuel];
  const cancel = () => {
    void photos.cancel();
    onClose();
  };
  const save = async () => {
    if (!q || q <= 0) return toast(`Poné cuántos ${unit === 'L' ? 'litros' : 'm³'} cargaste`);
    if (!t || t <= 0) return toast('Poné cuánto pagaste');
    await photos.commit();
    const st = (station ?? lastStation).trim();
    await db.fuel.put({
      id: load?.id ?? newId(),
      vehicleId: d.vehicle.id,
      at: fromLocalInput(at),
      km: parseKm(km) ?? undefined,
      fuel,
      qty: q,
      total: t,
      full,
      station: st || undefined,
      photoId: photos.ids[0],
    });
    toast(`${FUEL_LABEL[fuel]}: ${money(t)} anotado`);
    onClose();
  };
  const remove = async () => {
    if (!load || !confirm('¿Borrar esta carga?')) return;
    await photos.cancel();
    await removeRecord('fuel', load.id);
    onClose();
  };
  return (
    <Sheet title={load ? 'Carga de combustible' : 'Cargar combustible'} onClose={cancel} footer={<SaveBar onSave={save} onDelete={load ? remove : undefined} />}>
      {fuels.length > 1 && <Seg label="Combustible" options={fuels.map((f) => ({ id: f, label: FUEL_LABEL[f] }))} value={fuel} onChange={setFuel} />}
      <div className="grid2">
        <QtyField label={unit === 'L' ? 'Litros' : 'm³'} value={qty} onChange={setQty} />
        <MoneyField label="Total pagado" value={total} onChange={setTotal} />
      </div>
      {q && t ? <p className="muted small">Precio: {money2(t / q)} por {unit}</p> : null}
      <KmField label="Km del odómetro" value={km} onChange={setKm} hint="Con el km se calcula cuánto rinde el auto." />
      <label className="check">
        <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
        Llené el tanque
      </label>
      <Field label="Estación">
        <input value={station ?? lastStation} onChange={(e) => setStation(e.target.value)} placeholder="Ej.: YPF Av. San Martín" />
      </Field>
      <WhenField value={at} onChange={setAt} />
      <Field label="Foto del ticket">
        <PhotoPicker photos={photos} max={1} label="Ticket" />
      </Field>
    </Sheet>
  );
}

export function TollSheet({ onClose }: { onClose: () => void }) {
  const d = useData();
  const presets = d.settings.tolls;
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [fav, setFav] = useState(false);
  const add = async (amt: number, note?: string) => {
    await db.expenses.add({ id: newId(), vehicleId: d.vehicle.id, at: new Date().toISOString(), category: 'peaje', amount: amt, note });
    toast(`Peaje ${money(amt)} anotado`);
    onClose();
  };
  const save = async () => {
    const amt = parseNum(amount);
    if (!amt || amt <= 0) return toast('Poné el monto del peaje');
    if (fav && name.trim()) await saveSettings({ tolls: [...presets, { id: newId(), name: name.trim(), amount: amt }] });
    await add(amt, name.trim() || undefined);
  };
  return (
    <Sheet title="Peaje" onClose={onClose} footer={<SaveBar onSave={save} />}>
      {presets.length > 0 && (
        <div className="stack-s">
          <span className="label">Tus peajes: un toque y queda anotado</span>
          <div className="toll-grid">
            {presets.map((p) => (
              <button key={p.id} type="button" className="toll-btn" onClick={() => void add(p.amount, p.name)}>
                <span>{p.name}</span>
                <strong>{money(p.amount)}</strong>
              </button>
            ))}
          </div>
        </div>
      )}
      <MoneyField label={presets.length ? 'Otro monto' : 'Monto'} value={amount} onChange={setAmount} />
      <Field label="Dónde">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Autopista" />
      </Field>
      <label className="check">
        <input type="checkbox" checked={fav} onChange={(e) => setFav(e.target.checked)} />
        Guardarlo en mis peajes
      </label>
    </Sheet>
  );
}

const CATEGORIES = Object.keys(EXPENSE_LABEL) as ExpenseCategory[];

export function ExpenseSheet({ expense, category, onClose }: { expense?: Expense; category?: ExpenseCategory; onClose: () => void }) {
  const d = useData();
  const [cat, setCat] = useState<ExpenseCategory | undefined>(expense?.category ?? category);
  const [amount, setAmount] = useState(moneyInput(expense?.amount));
  const [note, setNote] = useState(expense?.note ?? '');
  const [at, setAt] = useState(expense ? toLocalInput(expense.at) : nowInput());
  const photos = usePhotos(expense?.photoId ? [expense.photoId] : []);
  const cancel = () => {
    void photos.cancel();
    onClose();
  };
  const save = async () => {
    const amt = parseNum(amount);
    if (!cat) return toast('Elegí en qué gastaste');
    if (!amt || amt <= 0) return toast('Poné el monto');
    await photos.commit();
    await db.expenses.put({ id: expense?.id ?? newId(), vehicleId: d.vehicle.id, at: fromLocalInput(at), category: cat, amount: amt, note: note.trim() || undefined, photoId: photos.ids[0] });
    toast(`${EXPENSE_LABEL[cat]}: ${money(amt)} anotado`);
    onClose();
  };
  const remove = async () => {
    if (!expense || !confirm('¿Borrar este gasto?')) return;
    await photos.cancel();
    await removeRecord('expenses', expense.id);
    onClose();
  };
  return (
    <Sheet title={expense ? 'Gasto' : 'Nuevo gasto'} onClose={cancel} footer={<SaveBar onSave={save} onDelete={expense ? remove : undefined} />}>
      <div className="chips" role="radiogroup" aria-label="En qué gastaste">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={cat === c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
            {EXPENSE_LABEL[c]}
          </button>
        ))}
      </div>
      <MoneyField label="Monto" value={amount} onChange={setAmount} big />
      <Field label="Detalle">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={cat === 'agencia' ? 'Ej.: base de la semana' : 'Opcional'} />
      </Field>
      <WhenField value={at} onChange={setAt} />
      <Field label="Foto del comprobante">
        <PhotoPicker photos={photos} max={1} label="Comprobante" />
      </Field>
    </Sheet>
  );
}

export function IncomeSheet({ income, onClose }: { income?: Income; onClose: () => void }) {
  const d = useData();
  const cfg = d.settings.agency;
  const [gross, setGross] = useState(moneyInput(income?.gross));
  const [trips, setTrips] = useState(income?.trips != null ? String(income.trips) : '');
  const [cash, setCash] = useState(moneyInput(income?.cash));
  const [tips, setTips] = useState(moneyInput(income?.tips));
  const [note, setNote] = useState(income?.note ?? '');
  const [at, setAt] = useState(income ? toLocalInput(income.at) : nowInput());
  const g = parseNum(gross) ?? 0;
  const fee = cfg.mode === 'percent' ? agencyFeeFor(g, cfg) : (income?.agencyFee ?? 0);
  const save = async () => {
    const t = parseNum(tips) ?? 0;
    if (g <= 0 && t <= 0) return toast('Poné cuánto recaudaste');
    await db.incomes.put({
      id: income?.id ?? newId(),
      vehicleId: d.vehicle.id,
      at: fromLocalInput(at),
      shiftId: income?.shiftId,
      gross: g,
      trips: parseNum(trips) ?? undefined,
      cash: parseNum(cash) ?? undefined,
      tips: t || undefined,
      agencyFee: fee,
      note: note.trim() || undefined,
    });
    toast(`Ingreso de ${money(g + t)} anotado`);
    onClose();
  };
  const remove = async () => {
    if (!income || !confirm('¿Borrar este ingreso?')) return;
    await removeRecord('incomes', income.id);
    onClose();
  };
  return (
    <Sheet title={income ? 'Ingreso' : 'Nuevo ingreso'} onClose={onClose} footer={<SaveBar onSave={save} onDelete={income ? remove : undefined} />}>
      <MoneyField label="Recaudado en viajes" value={gross} onChange={setGross} big hint={fee ? `La agencia se lleva ${money(fee)}.` : undefined} />
      <div className="grid2">
        <Field label="Viajes">
          <input inputMode="numeric" value={trips} onChange={(e) => setTrips(e.target.value.replace(/\D/g, ''))} placeholder="0" />
        </Field>
        <MoneyField label="Propinas" value={tips} onChange={setTips} />
      </div>
      <MoneyField label="De lo recaudado, en efectivo" value={cash} onChange={setCash} />
      <Field label="Detalle">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
      </Field>
      <WhenField value={at} onChange={setAt} />
    </Sheet>
  );
}

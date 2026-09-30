import { useState } from 'react';
import { db, newId } from '../../db/db';
import { removeRecord } from '../../db/repo';
import type { Settlement } from '../../db/types';
import { kmWarning } from '../../domain/km';
import { settle, settlementText } from '../../domain/settlement';
import { useData } from '../../lib/data';
import { money, parseKm, parseNum } from '../../lib/format';
import { shareText } from '../../lib/share';
import { Icon } from '../icons';
import { Field, KmField, MoneyField, SaveBar, Sheet, toast } from '../ui';
import { moneyInput } from './money';

const intFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

/** Liquidación con el chofer: lo facturado, los peajes que se le devuelven y cómo se reparte el resto. */
export function SettlementSheet({ settlement, period, onClose }: { settlement?: Settlement; period?: { from: string; to: string }; onClose: () => void }) {
  const d = useData();
  const [from, setFrom] = useState(settlement?.from ?? period?.from ?? '');
  const [to, setTo] = useState(settlement?.to ?? period?.to ?? '');
  const [gross, setGross] = useState(moneyInput(settlement?.gross));
  const [tolls, setTolls] = useState(moneyInput(settlement?.tolls));
  const [km, setKm] = useState(settlement?.km != null ? intFmt.format(settlement.km) : '');
  const [note, setNote] = useState(settlement?.note ?? '');
  const percent = settlement?.percent ?? d.vehicle.chofer?.percent ?? 50;
  const g = parseNum(gross);
  const t = parseNum(tolls) ?? 0;
  const k = parseKm(km);
  const r = settle({ gross: g ?? 0, tolls: t, percent });
  const warn = !settlement && k != null ? kmWarning(k, d.km) : null;
  const name = d.vehicle.chofer?.name.trim();
  const toWho = name ? `a ${name}` : 'al chofer';

  const current = (): Omit<Settlement, 'id' | 'vehicleId'> => ({ from, to, gross: g ?? 0, tolls: t, km: k ?? undefined, percent, note: note.trim() || undefined });
  const check = () => {
    if (!from || !to || from > to) return 'Revisá las fechas';
    if (g == null) return 'Poné lo que facturó';
    if (t > g) return 'Los peajes no pueden ser más que lo facturado';
    return null;
  };
  const save = async () => {
    const err = check();
    if (err) return toast(err);
    await db.settlements.put({ id: settlement?.id ?? newId(), vehicleId: d.vehicle.id, ...current() });
    toast(`Liquidación guardada: te quedan ${money(r.owner)}`);
    onClose();
  };
  const send = async () => {
    const err = check();
    if (err) return toast(err);
    await shareText(settlementText(d.vehicle, current()));
  };
  const remove = async () => {
    if (!settlement || !confirm('¿Borrar esta liquidación?')) return;
    await removeRecord('settlements', settlement.id);
    onClose();
  };

  return (
    <Sheet title="Liquidación del chofer" onClose={onClose} footer={<SaveBar onSave={save} onDelete={settlement ? remove : undefined} />}>
      <div className="grid2">
        <Field label="Desde">
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Hasta">
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <MoneyField label="Lo que facturó" value={gross} onChange={setGross} big hint="Con los peajes con pasajero incluidos: vienen sumados a la tarifa." />
      <MoneyField label="Peajes con pasajero" value={tolls} onChange={setTolls} hint={`Se le devuelven ${toWho}. El combustible, el lavado y los peajes sin pasajero los paga él.`} />
      <KmField label="Km del odómetro al cierre" value={km} onChange={setKm} hint={warn ?? 'Opcional. Sirve para los avisos de service.'} />

      <div className="calc" aria-label="Cómo se reparte">
        <div className="row between">
          <span>Facturado</span>
          <span>{money(g ?? 0)}</span>
        </div>
        <div className="row between">
          <span>Se le devuelven los peajes</span>
          <span>− {money(r.returned)}</span>
        </div>
        <div className="row between">
          <span>Queda para dividir</span>
          <span>{money(r.toSplit)}</span>
        </div>
        <div className="row between">
          <span>Parte {name ? `de ${name}` : 'del chofer'} ({percent}%)</span>
          <span>{money(r.chofer)}</span>
        </div>
        <div className="row between total">
          <span>{name ? `A ${name}` : 'Al chofer'} le corresponden</span>
          <strong data-testid="chofer-total">{money(r.choferTotal)}</strong>
        </div>
        <div className="row between total">
          <span>A vos te quedan</span>
          <strong data-testid="owner-total">{money(r.owner)}</strong>
        </div>
      </div>

      <Field label="Nota">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
      </Field>
      <button type="button" onClick={() => void send()}>
        <Icon name="share" /> Mandarle la cuenta {toWho}
      </button>
    </Sheet>
  );
}

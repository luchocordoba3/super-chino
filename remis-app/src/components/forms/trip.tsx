import { useMemo, useState } from 'react';
import { saveSettings } from '../../db/repo';
import { costPerKm, tripVerdict, type Verdict } from '../../domain/trip';
import { useData } from '../../lib/data';
import { money, money2, numFmt, parseNum } from '../../lib/format';
import { Icon, type IconName } from '../icons';
import { Field, MoneyField, QtyField, Sheet, toast } from '../ui';
import { moneyInput } from './money';

const VERDICT: Record<Verdict, { text: string; icon: IconName }> = {
  good: { text: 'Conviene', icon: 'check' },
  meh: { text: 'Más o menos', icon: 'alert' },
  bad: { text: 'No conviene', icon: 'x' },
};

/** "¿Me conviene este viaje?": lo que te pagan menos la nafta y el desgaste de todos los km (incluido ir a buscarlo). */
export function TripSheet({ onClose }: { onClose: () => void }) {
  const d = useData();
  const auto = useMemo(() => costPerKm(d, d.now), [d]);
  const cfg = d.settings.trip ?? {};
  const [pay, setPay] = useState('');
  const [kmPickup, setKmPickup] = useState('');
  const [kmTrip, setKmTrip] = useState('');
  const [minutes, setMinutes] = useState('');
  const [adjust, setAdjust] = useState(false);
  const [costIn, setCostIn] = useState(moneyInput(cfg.costKm));
  const [minKmIn, setMinKmIn] = useState(moneyInput(cfg.minKm));
  const [minHourIn, setMinHourIn] = useState(moneyInput(cfg.minHour));

  const costKm = cfg.costKm ?? auto;
  // Por defecto: que te quede por km al menos lo que te cuesta, y por hora tu meta del día en 8 horas.
  const minKm = cfg.minKm ?? (costKm != null ? Math.round(costKm) : undefined);
  const minHour = cfg.minHour ?? (d.settings.goal?.day ? Math.round(d.settings.goal.day / 8) : undefined);
  const p = parseNum(pay) ?? 0;
  const km = (parseNum(kmPickup) ?? 0) + (parseNum(kmTrip) ?? 0);
  const r = costKm != null && p > 0 && km > 0 ? tripVerdict({ pay: p, kmPickup: parseNum(kmPickup) ?? 0, kmTrip: parseNum(kmTrip) ?? 0, minutes: parseNum(minutes) ?? undefined, costKm, minKm, minHour }) : null;

  const saveAdjust = async () => {
    await saveSettings({ trip: { costKm: parseNum(costIn) ?? undefined, minKm: parseNum(minKmIn) ?? undefined, minHour: parseNum(minHourIn) ?? undefined } });
    setAdjust(false);
    toast('Guardado');
  };

  return (
    <Sheet title="¿Me conviene este viaje?" onClose={onClose}>
      <MoneyField label="Te pagan" value={pay} onChange={setPay} big hint="Lo que te queda a vos según la app (sin la comisión)." autoFocus />
      <div className="grid2">
        <QtyField label="Km hasta el pasajero" value={kmPickup} onChange={setKmPickup} />
        <QtyField label="Km del viaje" value={kmTrip} onChange={setKmTrip} />
      </div>
      <Field label="Minutos en total (opcional)">
        <input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} placeholder="0" />
      </Field>

      {costKm == null ? (
        <p className="notice">Todavía no tengo tus gastos por km (hacen falta un par de semanas de turnos y cargas). Tocá "Ajustar" y poné cuánto te cuesta cada km.</p>
      ) : r ? (
        <div className={`verdict v-${r.verdict}`} role="status" aria-label={`${VERDICT[r.verdict].text}: te quedan ${money(r.net)}`}>
          <div className="v-head">
            <span className="v-ic" aria-hidden="true">
              <Icon name={VERDICT[r.verdict].icon} />
            </span>
            <strong>{VERDICT[r.verdict].text}</strong>
            <span className="v-net">{money(r.net)}</span>
          </div>
          <div className="row between">
            <span>Km en total</span>
            <span>{numFmt(r.km)} km</span>
          </div>
          <div className="row between">
            <span>Nafta y desgaste ({money2(costKm)} por km)</span>
            <span>− {money(r.cost)}</span>
          </div>
          <div className="row between">
            <span>Te queda por km</span>
            <span>
              {money2(r.perKm ?? 0)}
              {minKm != null ? ` (mín. ${money(minKm)})` : ''}
            </span>
          </div>
          {r.perHour != null && (
            <div className="row between">
              <span>Te queda por hora</span>
              <span>
                {money(r.perHour)}
                {minHour != null ? ` (mín. ${money(minHour)})` : ''}
              </span>
            </div>
          )}
          {r.pickupShare >= 0.4 && <p className="small">Ojo: {Math.round(r.pickupShare * 100)}% de los km son para ir a buscarlo.</p>}
        </div>
      ) : (
        <p className="muted small">
          Tu costo: {money2(costKm)} por km {cfg.costKm == null ? '(sale de tus datos de los últimos 60 días)' : '(lo cargaste a mano)'}.
        </p>
      )}

      <button type="button" className="link" onClick={() => setAdjust((x) => !x)}>
        {adjust ? 'Cerrar ajustes' : 'Ajustar costo y mínimos'}
      </button>
      {adjust && (
        <div className="stack-s">
          <MoneyField
            label="Lo que te cuesta cada km"
            value={costIn}
            onChange={setCostIn}
            hint={auto != null ? `Vacío: uso el de tus datos (${money2(auto)}).` : 'Ej.: nafta a $ 1.780 ÷ 12 km por litro = $ 148, más unos $ 40 de service y cubiertas.'}
          />
          <div className="grid2">
            <MoneyField label="Mínimo por km" value={minKmIn} onChange={setMinKmIn} hint={minKm != null && cfg.minKm == null ? `Ahora: ${money(minKm)}` : undefined} />
            <MoneyField label="Mínimo por hora" value={minHourIn} onChange={setMinHourIn} hint={minHour != null && cfg.minHour == null ? `Ahora: ${money(minHour)}` : undefined} />
          </div>
          <button type="button" className="primary" onClick={() => void saveAdjust()}>
            Guardar
          </button>
        </div>
      )}
    </Sheet>
  );
}

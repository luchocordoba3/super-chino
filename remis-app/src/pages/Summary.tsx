import { useMemo, useState } from 'react';
import { CostBars, KmChart } from '../components/charts';
import { Icon } from '../components/icons';
import { Field, Seg, Stat } from '../components/ui';
import { addDays, dayKey, eachDay, inRange } from '../domain/dates';
import { FUEL_LABEL, FUEL_UNIT, avgKmPerUnit, segments } from '../domain/fuel';
import { gapsBetweenShifts, kmByDay } from '../domain/km';
import { movements, movementsCsv } from '../domain/movements';
import { COST_LABEL, type CostKey, periodRange, splitByKm, summarize } from '../domain/money';
import { useData } from '../lib/data';
import { dayFmt, hoursFmt, kmFmt, money, money2, numFmt } from '../lib/format';
import { download } from '../lib/share';

type Kind = 'week' | 'month' | 'custom';
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function Summary() {
  const d = useData();
  const today = dayKey(d.now);
  const [kind, setKind] = useState<Kind>('week');
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const range = kind === 'custom' ? custom : periodRange(kind, anchor);
  const s = useMemo(() => summarize(d, range.from, range.to, d.now), [d, range.from, range.to]);
  const days = eachDay(range.from, range.to);
  const byDay = useMemo(() => kmByDay(d.shifts, range.from, range.to), [d.shifts, range.from, range.to]);
  const breaks = useMemo(() => (d.vehicle.shared ? gapsBetweenShifts(d.shifts).map((g) => g.at) : []), [d.shifts, d.vehicle.shared]);

  const title =
    kind === 'month'
      ? `${MONTHS[Number(range.from.slice(5, 7)) - 1]} ${range.from.slice(0, 4)}`
      : `Del ${dayFmt(range.from)} al ${dayFmt(range.to)}`;
  const move = (dir: -1 | 1) => setAnchor(dir < 0 ? addDays(range.from, -1) : addDays(range.to, 1));
  const split = d.vehicle.shared ? splitByKm(s.costs.by.mantenimiento ?? 0, s.km) : null;
  const costRows = (Object.entries(s.costs.by) as [CostKey, number][]).map(([k, v]) => ({ label: COST_LABEL[k], value: v }));

  const exportCsv = () => {
    const csv = movementsCsv(movements(d), range.from, range.to);
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `mi-remis-${range.from}-a-${range.to}.csv`);
  };

  return (
    <div className="stack">
      <h1>Resumen</h1>
      <Seg
        label="Período"
        options={[
          { id: 'week', label: 'Semana' },
          { id: 'month', label: 'Mes' },
          { id: 'custom', label: 'Elegir fechas' },
        ]}
        value={kind}
        onChange={setKind}
      />
      {kind === 'custom' ? (
        <div className="grid2">
          <Field label="Desde">
            <input type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} />
          </Field>
          <Field label="Hasta">
            <input type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} />
          </Field>
        </div>
      ) : (
        <div className="row between">
          <button type="button" className="ghost" onClick={() => move(-1)} aria-label="Período anterior">
            <Icon name="left" />
          </button>
          <strong style={kind === 'month' ? { textTransform: 'capitalize' } : undefined}>{title}</strong>
          <button type="button" className="ghost" onClick={() => move(1)} disabled={range.to >= today} aria-label="Período siguiente">
            <Icon name="right" />
          </button>
        </div>
      )}

      <section className="card">
        <div className="label">Ganancia</div>
        <div className={`hero ${s.profit < 0 ? 'bad' : ''}`}>{money(s.profit)}</div>
        <p className="muted small">
          Recaudaste {money(s.income.gross + s.income.tips)}
          {s.income.agency ? `, la agencia se llevó ${money(s.income.agency)}` : ''} y gastaste {money(s.costs.total)}.
        </p>
      </section>

      <div className="stats" style={{ marginTop: 0 }}>
        <Stat label="Km tuyos" value={kmFmt(s.km.mine)} sub={d.vehicle.shared && s.km.other ? `+ ${kmFmt(s.km.other)} del otro chofer` : !d.vehicle.shared && s.km.other ? `+ ${kmFmt(s.km.other)} fuera de turno` : undefined} />
        <Stat label="Horas" value={hoursFmt(s.hours)} sub={`${s.shifts} turnos en ${s.days} días`} />
        <Stat label="Ganancia por km" value={s.perKm.profit != null ? money2(s.perKm.profit) : '—'} />
        <Stat label="Ganancia por hora" value={s.perHour != null ? money(s.perHour) : '—'} />
        <Stat label="Costo por km" value={s.perKm.cost != null ? money2(s.perKm.cost) : '—'} sub="Todo lo que gastaste / tus km" />
        <Stat label="Viajes" value={numFmt(s.income.trips, 0)} sub={s.income.trips ? `${money((s.income.gross) / s.income.trips)} por viaje` : undefined} />
      </div>

      <section className="card">
        <h2 style={{ marginBottom: 8 }}>Km por día</h2>
        <KmChart days={days} mine={byDay.mine} other={d.vehicle.shared ? byDay.other : undefined} />
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 8 }}>En qué se fue la plata</h2>
        {costRows.some((r) => r.value > 0) ? <CostBars rows={costRows} /> : <p className="muted">No hay gastos en este período.</p>}
        {split && (
          <p className="muted small" style={{ marginTop: 8 }}>
            Si dividen el service por km con el otro chofer: vos {money(split.mine)} ({Math.round(split.share * 100)}%), el otro {money(split.other)}.
          </p>
        )}
      </section>

      <section className="card stack-s">
        <h2 style={{ marginBottom: 4 }}>Combustible</h2>
        {d.vehicle.fuels.map((f) => {
          const qty = s.fuel.qty[f] ?? 0;
          const spent = d.fuel.filter((x) => x.fuel === f && inRange(dayKey(x.at), range.from, range.to)).reduce((a, x) => a + x.total, 0);
          const segs = segments(d.fuel, f, breaks).filter((g) => inRange(dayKey(g.at), range.from, range.to));
          const avg = avgKmPerUnit(segs);
          return (
            <div key={f} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
              <div>
                <div style={{ fontWeight: 650 }}>{FUEL_LABEL[f]}</div>
                <div className="muted small">
                  {qty ? `${numFmt(qty)} ${FUEL_UNIT[f]} · ${money2(spent / qty)} por ${FUEL_UNIT[f]}` : 'Sin cargas en este período'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {qty > 0 && <div style={{ fontWeight: 700 }}>{money(spent)}</div>}
                <div className="muted small">{avg ? `Rinde ${numFmt(avg)} km/${FUEL_UNIT[f]}` : ''}</div>
              </div>
            </div>
          );
        })}
        <p className="hint">El rendimiento sale de dos cargas seguidas con tanque lleno y el km anotado.</p>
      </section>

      <button type="button" onClick={exportCsv}>
        <Icon name="download" /> Bajar en Excel (CSV)
      </button>
    </div>
  );
}

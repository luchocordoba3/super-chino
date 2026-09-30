import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckRunSheet, ServiceSheet } from '../components/forms/car';
import { ExpenseSheet, FuelSheet, IncomeSheet, TollSheet } from '../components/forms/money';
import { SettlementSheet } from '../components/forms/settlement';
import { ShiftEndSheet, ShiftStartSheet } from '../components/forms/shift';
import { Icon, type IconName } from '../components/icons';
import { Empty, Stat, toast } from '../components/ui';
import { db, newId } from '../db/db';
import { saveSettings } from '../db/repo';
import type { Settlement } from '../db/types';
import type { Alert } from '../domain/alerts';
import { dayKey } from '../domain/dates';
import { shiftHours } from '../domain/km';
import { agencyDue, summarize } from '../domain/money';
import { isChofer, pendingPeriod, periodPhrase, rangeText, settle, settlePeriod } from '../domain/settlement';
import { useData } from '../lib/data';
import { dayFmt, hoursFmt, kmFmt, money, timeFmt } from '../lib/format';

type SheetKind = 'start' | 'end' | 'fuel' | 'toll' | 'expense' | 'income' | 'check';

const SYM = { danger: '!', warn: '!', info: 'i' } as const;
const PERIOD_NAME = { day: 'del día', week: 'de la semana', month: 'del mes' } as const;

function AlertRow({ a }: { a: Alert }) {
  const d = useData();
  const nav = useNavigate();
  const body = (
    <>
      <span className="sym" aria-hidden="true">
        {SYM[a.level]}
      </span>
      <div className="grow">
        <div className="t">{a.title}</div>
        {a.detail && <div className="d">{a.detail}</div>}
      </div>
    </>
  );
  // Aviso de otro auto: primero cambia a ese auto.
  if (a.vehicleId && a.vehicleId !== d.vehicle.id)
    return (
      <button type="button" className={`alert ${a.level}`} onClick={() => void saveSettings({ vehicleId: a.vehicleId }).then(() => nav(a.to ?? '/'))}>
        {body}
      </button>
    );
  return a.to ? (
    <Link to={a.to} className={`alert ${a.level}`}>
      {body}
    </Link>
  ) : (
    <div className={`alert ${a.level}`}>{body}</div>
  );
}

function Alerts() {
  const d = useData();
  return (
    <>
      <div className="section-title">
        <h2>Avisos</h2>
        {d.alerts.length > 0 && <span className="muted small">{d.alerts.length}</span>}
      </div>
      <div className="list">{d.alerts.length ? d.alerts.map((a) => <AlertRow key={a.id} a={a} />) : <Empty text="Todo en orden. Buen viaje." />}</div>
    </>
  );
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);

/** Hoy, para el auto que maneja un chofer: la liquidación, los gastos del dueño y los avisos. */
function ChoferHome() {
  const d = useData();
  const [sheet, setSheet] = useState<'settle' | 'expense' | 'service' | null>(null);
  const [edit, setEdit] = useState<Settlement | null>(null);
  const close = () => setSheet(null);
  const today = dayKey(d.now);
  const deal = d.vehicle.chofer ?? { name: '', percent: 50, period: 'quincena' as const };
  const target = pendingPeriod(d.vehicle, d.settlements, today) ?? { kind: deal.period, ...settlePeriod(deal.period, today) };
  const list = [...d.settlements].sort((a, b) => b.to.localeCompare(a.to));
  const last = list[0];
  const name = deal.name.trim();

  return (
    <div className="stack" style={{ gap: 0 }}>
      <section className="card shift-card">
        <div className="label">
          {name ? `Lo maneja ${name}` : 'Lo maneja un chofer'} · {deal.percent}% para el chofer
        </div>
        <div className="hero km">{kmFmt(d.km)}</div>
        <p className="muted small">
          {last ? `Última liquidación, ${rangeText(last.from, last.to)}: te quedaron ${money(settle(last).owner)}` : 'Todavía no cargaste ninguna liquidación.'}
        </p>
        <button type="button" className="primary big" onClick={() => setSheet('settle')}>
          <Icon name="cash" /> Cargar {periodPhrase(target.kind, target.from, target.to)}
        </button>
      </section>

      <div className="actions two">
        <Action icon="receipt" label="Gasto" onClick={() => setSheet('expense')} />
        <Action icon="wrench" label="Service" onClick={() => setSheet('service')} />
      </div>

      <div className="section-title">
        <h2>Liquidaciones</h2>
      </div>
      <div className="list">
        {list.length ? (
          list.slice(0, 6).map((s) => {
            const r = settle(s);
            return (
              <button key={s.id} type="button" className="item" onClick={() => setEdit(s)}>
                <span className="ic">
                  <Icon name="user" />
                </span>
                <span className="grow">
                  <div className="t">{cap(rangeText(s.from, s.to))}</div>
                  <div className="d">
                    Facturó {money(s.gross)} · {name ? `a ${name}` : 'al chofer'} {money(r.choferTotal)}
                  </div>
                </span>
                <span className="amt good">+{money(r.owner)}</span>
              </button>
            );
          })
        ) : (
          <Empty text="Cuando cargues la primera, aparece acá." />
        )}
      </div>

      <Alerts />

      {sheet === 'settle' && <SettlementSheet period={target} onClose={close} />}
      {edit && <SettlementSheet settlement={edit} onClose={() => setEdit(null)} />}
      {sheet === 'expense' && <ExpenseSheet onClose={close} />}
      {sheet === 'service' && <ServiceSheet onClose={close} />}
    </div>
  );
}

function Action({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}>
      <Icon name={icon} />
      {label}
    </button>
  );
}

export function Home() {
  const d = useData();
  return isChofer(d.vehicle) ? <ChoferHome key={d.vehicle.id} /> : <DriverHome key={d.vehicle.id} />;
}

/** Hoy, para el auto que manejás vos: el turno, lo del día y los avisos. */
function DriverHome() {
  const d = useData();
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const close = () => setSheet(null);
  const today = dayKey(d.now);
  const s = useMemo(() => summarize(d, today, today, d.now), [d, today]);
  const due = agencyDue(d.settings.agency, d.expenses, today);
  const open = d.open;
  const kmToday = s.km.mine + (open && dayKey(open.startAt) === today ? Math.max(0, d.km - open.startKm) : 0);
  const checkedToday = d.checks.some((c) => dayKey(c.at) === today);

  const payBase = async () => {
    if (!due) return;
    await db.expenses.add({ id: newId(), vehicleId: d.vehicle.id, at: new Date().toISOString(), category: 'agencia', amount: due.left, note: `Base ${PERIOD_NAME[d.settings.agency.period ?? 'week']}` });
    toast(`Base de ${money(due.left)} anotada`);
  };

  return (
    <div className="stack" style={{ gap: 0 }}>
      <section className={`card shift-card ${open ? 'open' : ''}`}>
        {open ? (
          <>
            <div className="label">
              <span className="live-dot" aria-hidden="true" />
              Turno en curso
            </div>
            <div className="hero km">{hoursFmt(shiftHours(open, d.now))}</div>
            <p className="muted small">
              Desde las {timeFmt(open.startAt)}
              {dayKey(open.startAt) !== today ? ` del ${dayFmt(dayKey(open.startAt))}` : ''} · arrancaste con {kmFmt(open.startKm)}
            </p>
            <button type="button" className="primary big" onClick={() => setSheet('end')}>
              <Icon name="stop" /> Terminar turno
            </button>
            {!checkedToday && d.checkItems.some((c) => c.enabled) && (
              <button type="button" onClick={() => setSheet('check')}>
                <Icon name="check" /> Hacer el checklist antes de salir
              </button>
            )}
          </>
        ) : (
          <>
            <div className="label">Km del auto</div>
            <div className="hero km">{kmFmt(d.km)}</div>
            {d.kmRate && <p className="muted small">El auto hace unos {kmFmt(Math.round(d.kmRate))} por día</p>}
            <button type="button" className="primary big" onClick={() => setSheet('start')}>
              <Icon name="play" /> Empezar turno
            </button>
          </>
        )}
      </section>

      <div className="section-title">
        <h2>Hoy</h2>
      </div>
      <div className="stats" style={{ marginTop: 0 }}>
        <Stat label="Km hoy" value={kmFmt(kmToday)} sub={s.km.other ? `+ ${kmFmt(s.km.other)} del otro chofer` : undefined} />
        <Stat label="Recaudado" value={money(s.income.gross + s.income.tips)} sub={s.income.trips ? `${s.income.trips} viajes` : undefined} />
        <Stat label="Gastos" value={money(s.costs.total)} />
        <Stat label="Ganancia" value={money(s.profit)} tone={s.profit < 0 ? 'bad' : undefined} sub={s.income.agency ? `Agencia: ${money(s.income.agency)}` : undefined} />
      </div>

      {due && (
        <section className="card row between" style={{ marginTop: 12 }}>
          <div>
            <div className="label">Base {PERIOD_NAME[d.settings.agency.period ?? 'week']}</div>
            <div className="t" style={{ fontWeight: 650 }}>
              {due.left > 0 ? `Falta pagar ${money(due.left)}` : `Pagada (${money(due.paid)})`}
            </div>
          </div>
          {due.left > 0 && (
            <button type="button" className="nowrap" onClick={() => void payBase()}>
              Pagué la base
            </button>
          )}
        </section>
      )}

      <div className="actions">
        <Action icon="fuel" label="Combustible" onClick={() => setSheet('fuel')} />
        <Action icon="toll" label="Peaje" onClick={() => setSheet('toll')} />
        <Action icon="receipt" label="Gasto" onClick={() => setSheet('expense')} />
        <Action icon="cash" label="Ingreso" onClick={() => setSheet('income')} />
      </div>

      <Alerts />

      {sheet === 'start' && <ShiftStartSheet onClose={close} />}
      {sheet === 'end' && open && <ShiftEndSheet shift={open} onClose={close} />}
      {sheet === 'fuel' && <FuelSheet onClose={close} />}
      {sheet === 'toll' && <TollSheet onClose={close} />}
      {sheet === 'expense' && <ExpenseSheet onClose={close} />}
      {sheet === 'income' && <IncomeSheet onClose={close} />}
      {sheet === 'check' && <CheckRunSheet onClose={close} />}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { ServiceSheet } from '../components/forms/car';
import { ExpenseSheet, FuelSheet, IncomeSheet } from '../components/forms/money';
import { ShiftEditSheet } from '../components/forms/shift';
import { Icon, type IconName } from '../components/icons';
import { Empty } from '../components/ui';
import { addDays, dayKey } from '../domain/dates';
import { type Movement, type MovementKind, movements } from '../domain/movements';
import { useData } from '../lib/data';
import { dayShort, kmFmt, money, timeFmt } from '../lib/format';

const FILTERS: { id: 'all' | MovementKind; label: string }[] = [
  { id: 'all', label: 'Todo' },
  { id: 'shift', label: 'Turnos' },
  { id: 'fuel', label: 'Combustible' },
  { id: 'expense', label: 'Gastos' },
  { id: 'income', label: 'Ingresos' },
  { id: 'service', label: 'Services' },
];

const ICON: Record<MovementKind, IconName> = { shift: 'car', fuel: 'fuel', expense: 'receipt', income: 'cash', service: 'wrench' };

export function History() {
  const d = useData();
  const [filter, setFilter] = useState<'all' | MovementKind>('all');
  const [limit, setLimit] = useState(80);
  const [edit, setEdit] = useState<Movement | null>(null);
  const list = useMemo(() => movements(d), [d]);
  const shown = list.filter((m) => filter === 'all' || m.kind === filter);
  const today = dayKey(d.now);
  const yesterday = addDays(today, -1);

  const groups: { day: string; rows: Movement[] }[] = [];
  for (const m of shown.slice(0, limit)) {
    const day = dayKey(m.at);
    if (groups[groups.length - 1]?.day !== day) groups.push({ day, rows: [] });
    groups[groups.length - 1].rows.push(m);
  }
  const expense = (id: string) => d.expenses.find((e) => e.id === id);
  const close = () => setEdit(null);
  const pick = <T extends { id: string }>(kind: MovementKind, rows: T[]) => (edit?.kind === kind ? rows.find((x) => x.id === edit.id) : undefined);
  const shiftRec = pick('shift', d.shifts);
  const fuelRec = pick('fuel', d.fuel);
  const expenseRec = pick('expense', d.expenses);
  const incomeRec = pick('income', d.incomes);
  const serviceRec = pick('service', d.services);

  return (
    <div className="stack">
      <h1>Movimientos</h1>
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={filter === f.id ? 'on' : ''} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {!groups.length && <div className="list"><Empty text="Todavía no hay nada anotado." /></div>}
      {groups.map((g) => {
        const net = g.rows.reduce((a, m) => a + (m.amount ?? 0), 0);
        return (
          <div key={g.day}>
            <div className="day-head">
              <span>{g.day === today ? 'Hoy' : g.day === yesterday ? 'Ayer' : dayShort(g.day)}</span>
              {net !== 0 && <span className={net > 0 ? 'good' : ''}>{net > 0 ? '+' : '−'}{money(Math.abs(net))}</span>}
            </div>
            <div className="list">
              {g.rows.map((m) => (
                <button key={`${m.kind}-${m.id}`} type="button" className="item" onClick={() => setEdit(m)}>
                  <span className="ic">
                    <Icon name={m.kind === 'expense' && expense(m.id)?.category === 'peaje' ? 'toll' : ICON[m.kind]} />
                  </span>
                  <span className="grow">
                    <div className="t">{m.title}</div>
                    <div className="d">{[m.kind !== 'service' ? timeFmt(m.at) : '', m.detail].filter(Boolean).join(' · ')}</div>
                  </span>
                  {m.amount != null ? (
                    <span className={`amt ${m.amount > 0 ? 'good' : ''}`}>
                      {m.amount > 0 ? '+' : '−'}
                      {money(Math.abs(m.amount))}
                    </span>
                  ) : m.km != null ? (
                    <span className="amt">{kmFmt(m.km)}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {shown.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + 120)}>
          Ver más
        </button>
      )}

      {shiftRec && <ShiftEditSheet shift={shiftRec} onClose={close} />}
      {fuelRec && <FuelSheet load={fuelRec} onClose={close} />}
      {expenseRec && <ExpenseSheet expense={expenseRec} onClose={close} />}
      {incomeRec && <IncomeSheet income={incomeRec} onClose={close} />}
      {serviceRec && <ServiceSheet service={serviceRec} onClose={close} />}
    </div>
  );
}

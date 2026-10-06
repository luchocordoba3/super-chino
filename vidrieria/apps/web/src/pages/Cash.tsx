import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { EXPENSE_CATEGORIES, EXPENSE_LABEL, PAY_METHODS, PAY_METHOD_LABEL, type ExpenseCategory, type PayMethod } from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Field, Loading, Modal, NumInput, toast } from '../components/ui';
import { ago, dateFmt, dayMonth, money } from '../lib/format';
import { useFeature } from '../lib/plan';
import type { Business, Crew, Expense, Invoice, Job, Payment, Receivable, WorkDay } from '../lib/types';
import { waLink } from '../lib/whatsapp';

const TABS = ['Cobros', 'Por cobrar', 'Gastos', 'Jornales', 'Cheques', 'Facturas'] as const;
type Tab = (typeof TABS)[number];
const KIND = { SENA: 'Seña', SALDO: 'Saldo', OTRO: 'Otro' } as const;

const monthRange = (offset: number) => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  return { from, to, label: new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(from) };
};
const qs = (r: { from: Date; to: Date }) => `from=${r.from.toISOString()}&to=${r.to.toISOString()}`;

/** Caja: cobros, gastos, jornales, cheques, cuentas por cobrar y facturas. */
export default function Cash() {
  const [tab, setTab] = useState<Tab>('Cobros');
  const [offset, setOffset] = useState(0);
  const range = monthRange(offset);
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Caja</h1>
          <p className="muted small">Lo que entra y lo que sale, sin cuaderno.</p>
        </div>
        {(tab === 'Cobros' || tab === 'Gastos') && (
          <div className="row month-nav">
            <button type="button" className="btn small" onClick={() => setOffset(offset - 1)} aria-label="Mes anterior">
              ←
            </button>
            <strong className="month-label">{range.label}</strong>
            <button type="button" className="btn small" disabled={offset >= 0} onClick={() => setOffset(offset + 1)} aria-label="Mes siguiente">
              →
            </button>
          </div>
        )}
      </div>
      <div className="seg" role="tablist">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Cobros' && <Payments range={range} />}
      {tab === 'Por cobrar' && <Receivables />}
      {tab === 'Gastos' && <Expenses range={range} />}
      {tab === 'Jornales' && <Wages />}
      {tab === 'Cheques' && <Cheques />}
      {tab === 'Facturas' && <Invoices />}
    </div>
  );
}

function Payments({ range }: { range: { from: Date; to: Date } }) {
  const q = useQuery({ queryKey: ['payments', range.from.toISOString()], queryFn: () => api<Payment[]>(`/payments?${qs(range)}`) });
  const [adding, setAdding] = useState(false);
  const [invoicing, setInvoicing] = useState<Payment | null>(null);
  const canArca = useFeature('arca');
  const list = q.data ?? [];
  const total = list.reduce((a, p) => a + Number(p.amount), 0);
  const net = list.reduce((a, p) => a + Number(p.net), 0);
  return (
    <section className="card">
      <div className="row between wrap">
        <div>
          <h2>Cobros</h2>
          <p className="muted small">
            Entró {money(total)} · te queda {money(net)} después de comisiones.
          </p>
        </div>
        <button type="button" className="btn primary" onClick={() => setAdding(true)}>
          + Registrar cobro
        </button>
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading ? (
        <Loading />
      ) : !list.length ? (
        <Empty>No hay cobros este mes. Las señas que confirmes y los pagos de Mercado Pago aparecen solos.</Empty>
      ) : (
        <ul className="list">
          {list.map((p) => (
            <li key={p.id} className="list-row">
              <span className="mono muted small">{dayMonth(p.date)}</span>
              <span className="grow">
                <strong>{p.quote?.customer?.name ?? p.note ?? 'Cobro'}</strong>
                <span className="muted small block">
                  {KIND[p.kind]}
                  {p.quote && ` · N° ${p.quote.number}`} · {PAY_METHOD_LABEL[p.method]}
                  {Number(p.feePct) > 0 && ` · comisión ${Number(p.feePct)} %`}
                </span>
              </span>
              <span className="num">
                {money(p.amount)}
                {Number(p.feePct) > 0 && <span className="muted small block">neto {money(p.net)}</span>}
              </span>
              {canArca &&
                (p.invoiceId ? (
                  <span className="pill good small-pill">facturado</span>
                ) : (
                  <button type="button" className="btn small" onClick={() => setInvoicing(p)}>
                    Facturar
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
      {adding && <PaymentForm onClose={() => setAdding(false)} />}
      {invoicing && <InvoiceForm payment={invoicing} onClose={() => setInvoicing(null)} />}
    </section>
  );
}

export function PaymentForm({ onClose, quoteId, amount, kind }: { onClose: () => void; quoteId?: string; amount?: number; kind?: Payment['kind'] }) {
  const qc = useQueryClient();
  const rec = useQuery({ queryKey: ['receivables'], queryFn: () => api<Receivable[]>('/receivables') });
  const open = useMemo(() => (rec.data ?? []).flatMap((c) => c.quotes.map((q) => ({ ...q, customer: c.customer?.name ?? 'Sin cliente' }))), [rec.data]);
  const [f, setF] = useState({
    quoteId: quoteId ?? '',
    kind: kind ?? ('SALDO' as Payment['kind']),
    method: 'TRANSFERENCIA' as PayMethod,
    amount: amount ?? (null as number | null),
    date: new Date().toISOString().slice(0, 10),
    note: '',
    chequeBank: '',
    chequeNumber: '',
    chequeDueAt: '',
  });
  const isCheque = f.method === 'CHEQUE' || f.method === 'ECHEQ';
  const m = useMutation({
    mutationFn: () =>
      api('/payments', {
        body: {
          quoteId: f.quoteId || null,
          kind: f.kind,
          method: f.method,
          amount: f.amount,
          date: new Date(`${f.date}T12:00:00`).toISOString(),
          note: f.note,
          ...(isCheque ? { chequeBank: f.chequeBank, chequeNumber: f.chequeNumber, chequeDueAt: f.chequeDueAt ? new Date(`${f.chequeDueAt}T12:00:00`).toISOString() : null } : {}),
        },
      }),
    onSuccess: () => {
      for (const k of ['payments', 'receivables', 'cheques', 'numbers', 'dashboard', 'quote']) qc.invalidateQueries({ queryKey: [k] });
      toast('Cobro registrado');
      onClose();
    },
    onError: (e) => toast(errMsg(e)),
  });
  return (
    <Modal title="Registrar cobro" onClose={onClose}>
      <div className="form-grid">
        <Field label="Trabajo" wide>
          <select
            value={f.quoteId}
            onChange={(e) => {
              const q = open.find((x) => x.id === e.target.value);
              setF({ ...f, quoteId: e.target.value, amount: q ? q.due : f.amount });
            }}
          >
            <option value="">Sin trabajo (otro ingreso)</option>
            {open.map((q) => (
              <option key={q.id} value={q.id}>
                N° {q.number} · {q.customer} · debe {money(q.due)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Qué es">
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Payment['kind'] })}>
            <option value="SENA">Seña</option>
            <option value="SALDO">Saldo</option>
            <option value="OTRO">Otro</option>
          </select>
        </Field>
        <Field label="Cómo pagó">
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as PayMethod })}>
            {PAY_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAY_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Monto ($)">
          <NumInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        </Field>
        <Field label="Fecha">
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        {isCheque && (
          <>
            <Field label="Banco">
              <input value={f.chequeBank} onChange={(e) => setF({ ...f, chequeBank: e.target.value })} />
            </Field>
            <Field label="Número">
              <input value={f.chequeNumber} onChange={(e) => setF({ ...f, chequeNumber: e.target.value })} />
            </Field>
            <Field label="Vence">
              <input type="date" value={f.chequeDueAt} onChange={(e) => setF({ ...f, chequeDueAt: e.target.value })} />
            </Field>
          </>
        )}
        <Field label="Nota" wide>
          <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <div className="actions wide">
          <button type="button" className="btn primary" disabled={m.isPending || !f.amount} onClick={() => m.mutate()}>
            Guardar cobro
          </button>
        </div>
      </div>
    </Modal>
  );
}

function InvoiceForm({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ concepto: 3 as 1 | 2 | 3, docTipo: 99 as 99 | 80, docNro: '', condicionIva: 5, customerName: payment.quote?.customer?.name ?? '' });
  const m = useMutation({
    mutationFn: () => api<Invoice>('/invoices/arca', { body: { paymentId: payment.id, amount: Number(payment.amount), ...f } }),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['numbers'] });
      toast(`Factura C N° ${inv.number} emitida (CAE ${inv.cae})`);
      onClose();
    },
    onError: (e) => toast(errMsg(e)),
  });
  return (
    <Modal title={`Facturar ${money(payment.amount)}`} onClose={onClose}>
      <p className="muted small">Se emite la factura C en ARCA con tu certificado. Si tenés dudas sobre el concepto, consultalo con tu contador.</p>
      <div className="form-grid">
        <Field label="Concepto">
          <select value={f.concepto} onChange={(e) => setF({ ...f, concepto: Number(e.target.value) as 1 | 2 | 3 })}>
            <option value={1}>Productos</option>
            <option value={2}>Servicios</option>
            <option value={3}>Productos y servicios</option>
          </select>
        </Field>
        <Field label="Cliente">
          <select value={f.docTipo} onChange={(e) => setF({ ...f, docTipo: Number(e.target.value) as 99 | 80 })}>
            <option value={99}>Consumidor final</option>
            <option value={80}>Con CUIT</option>
          </select>
        </Field>
        {f.docTipo === 80 && (
          <>
            <Field label="CUIT">
              <input value={f.docNro} inputMode="numeric" onChange={(e) => setF({ ...f, docNro: e.target.value })} />
            </Field>
            <Field label="Condición">
              <select value={f.condicionIva} onChange={(e) => setF({ ...f, condicionIva: Number(e.target.value) })}>
                <option value={1}>Responsable inscripto</option>
                <option value={6}>Monotributista</option>
                <option value={4}>Exento</option>
              </select>
            </Field>
          </>
        )}
        <Field label="Nombre (para tu registro)" wide>
          <input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} />
        </Field>
        <div className="actions wide">
          <button type="button" className="btn primary" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? 'Emitiendo…' : 'Emitir factura C'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Receivables() {
  const q = useQuery({ queryKey: ['receivables'], queryFn: () => api<Receivable[]>('/receivables') });
  const [paying, setPaying] = useState<{ quoteId: string; amount: number } | null>(null);
  if (q.isLoading) return <Loading />;
  const list = q.data ?? [];
  const total = list.reduce((a, c) => a + c.due, 0);
  return (
    <section className="card">
      <h2>Por cobrar</h2>
      <p className="muted small">Trabajos aceptados menos lo que ya te pagaron. Total: {money(total)}.</p>
      {!list.length ? (
        <Empty>No te deben nada.</Empty>
      ) : (
        <ul className="list">
          {list.map((c) => (
            <li key={c.customer?.id ?? 'none'} className="receivable">
              <div className="row between wrap">
                <span>
                  <strong>{c.customer?.name ?? 'Sin cliente'}</strong>
                  <span className="muted small block">{c.oldest ? `el más viejo, aceptado ${ago(c.oldest)}` : ''}</span>
                </span>
                <span className="num strong">{money(c.due)}</span>
              </div>
              {c.quotes.map((q) => (
                <div key={q.id} className="row between wrap small receivable-q">
                  <span>
                    N° {q.number} · {q.title || 'Trabajo'} · pagó {money(q.paid)} de {money(q.total)}
                  </span>
                  <span className="row">
                    {c.customer?.phone && (
                      <a
                        className="btn wa small"
                        href={waLink(c.customer.phone, `¡Hola ${c.customer.name.split(' ')[0]}! Te paso el saldo del trabajo N° ${q.number}${q.title ? ` (${q.title})` : ''}: ${money(q.due)}. Cualquier cosa avisame.`)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Recordar
                      </a>
                    )}
                    <button type="button" className="btn small" onClick={() => setPaying({ quoteId: q.id, amount: q.due })}>
                      Cobré
                    </button>
                  </span>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
      {paying && <PaymentForm quoteId={paying.quoteId} amount={paying.amount} onClose={() => setPaying(null)} />}
    </section>
  );
}

function Expenses({ range }: { range: { from: Date; to: Date } }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['expenses', range.from.toISOString()], queryFn: () => api<{ expenses: Expense[]; fixed: Expense[] }>(`/expenses?${qs(range)}`) });
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<Job[]>('/jobs') });
  const [f, setF] = useState({ category: 'COMBUSTIBLE' as ExpenseCategory, description: '', amount: null as number | null, date: new Date().toISOString().slice(0, 10), recurring: false, jobId: '' });
  const add = useMutation({
    mutationFn: () => api('/expenses', { body: { ...f, jobId: f.jobId || null, date: new Date(`${f.date}T12:00:00`).toISOString() } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['numbers'] });
      setF({ ...f, description: '', amount: null, jobId: '' });
      toast('Gasto guardado');
    },
    onError: (e) => toast(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/expenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
  if (q.isLoading) return <Loading />;
  const { expenses = [], fixed = [] } = q.data ?? {};
  const totalFixed = fixed.reduce((a, e) => a + Number(e.amount), 0);
  const totalVar = expenses.reduce((a, e) => a + Number(e.amount), 0);
  const row = (e: Expense) => (
    <li key={e.id} className="list-row">
      <span className="mono muted small">{e.recurring ? 'mensual' : dayMonth(e.date)}</span>
      <span className="grow">
        <strong>{EXPENSE_LABEL[e.category]}</strong>
        {e.description && <span className="muted"> · {e.description}</span>}
      </span>
      <span className="num">{money(e.amount)}</span>
      <button type="button" className="icon-btn" aria-label="Borrar gasto" onClick={() => del.mutate(e.id)}>
        ✕
      </button>
    </li>
  );
  return (
    <div className="stack">
      <section className="card">
        <h2>Cargar gasto</h2>
        <div className="form-grid">
          <Field label="Rubro">
            <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ExpenseCategory })}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {EXPENSE_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Monto ($)">
            <NumInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
          </Field>
          <Field label="Fecha">
            <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="Detalle">
            <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ej.: nafta para la obra de Mitre" />
          </Field>
          <Field label="Trabajo (opcional)">
            <select value={f.jobId} onChange={(e) => setF({ ...f, jobId: e.target.value })}>
              <option value="">—</option>
              {(jobs.data ?? []).map((j) => (
                <option key={j.id} value={j.id}>
                  N° {j.quote.number} · {j.quote.customer?.name ?? ''}
                </option>
              ))}
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" checked={f.recurring} onChange={(e) => setF({ ...f, recurring: e.target.checked })} /> Gasto fijo de todos los meses
          </label>
          <div className="actions wide">
            <button type="button" className="btn primary" disabled={add.isPending || !f.amount} onClick={() => add.mutate()}>
              Guardar gasto
            </button>
          </div>
        </div>
      </section>
      <section className="card">
        <h2>Fijos del mes · {money(totalFixed)}</h2>
        {!fixed.length ? <p className="muted small">Cargá alquiler, luz, contador, seguro… marcando "gasto fijo".</p> : <ul className="list">{fixed.map(row)}</ul>}
      </section>
      <section className="card">
        <h2>Otros gastos del mes · {money(totalVar)}</h2>
        {!expenses.length ? <p className="muted small">Sin gastos cargados este mes.</p> : <ul className="list">{expenses.map(row)}</ul>}
      </section>
    </div>
  );
}

const weekStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};

function Wages() {
  const qc = useQueryClient();
  const from = weekStart();
  const to = new Date(from.getTime() + 7 * 86_400_000);
  const q = useQuery({ queryKey: ['workdays', from.toISOString()], queryFn: () => api<WorkDay[]>(`/workdays?from=${from.toISOString()}&to=${to.toISOString()}`) });
  const crews = useQuery({ queryKey: ['crews'], queryFn: () => api<Crew[]>('/crews') });
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<Job[]>('/jobs') });
  const [f, setF] = useState({ crewId: '', date: new Date().toISOString().slice(0, 10), jobId: '' });
  const [one, setOne] = useState({ worker: '', amount: null as number | null, advance: false });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['workdays'] });
    qc.invalidateQueries({ queryKey: ['numbers'] });
  };
  const crewDay = useMutation({
    mutationFn: () => api<{ count: number }>('/workdays/crew', { body: { crewId: f.crewId, jobId: f.jobId || null, date: new Date(`${f.date}T12:00:00`).toISOString() } }),
    onSuccess: (r) => (refresh(), toast(`Se cargaron ${r.count} jornales`)),
    onError: (e) => toast(errMsg(e)),
  });
  const single = useMutation({
    mutationFn: () => api('/workdays', { body: { worker: one.worker, amount: one.amount, advance: one.advance, date: new Date(`${f.date}T12:00:00`).toISOString(), jobId: f.jobId || null } }),
    onSuccess: () => (refresh(), setOne({ worker: '', amount: null, advance: false }), toast('Guardado')),
    onError: (e) => toast(errMsg(e)),
  });
  const pay = useMutation({
    mutationFn: (ids: string[]) => api('/workdays/pay', { body: { ids } }),
    onSuccess: () => (refresh(), toast('Semana liquidada')),
  });
  const days = q.data ?? [];
  const byWorker = new Map<string, { worker: string; days: number; earned: number; advances: number; ids: string[]; paid: boolean }>();
  for (const d of days) {
    const w = byWorker.get(d.worker) ?? { worker: d.worker, days: 0, earned: 0, advances: 0, ids: [], paid: true };
    if (d.advance) w.advances += Number(d.amount);
    else {
      w.days++;
      w.earned += Number(d.amount);
    }
    if (!d.paidAt) {
      w.ids.push(d.id);
      w.paid = false;
    }
    byWorker.set(d.worker, w);
  }
  const unpaid = days.filter((d) => !d.paidAt).map((d) => d.id);
  return (
    <div className="stack">
      <section className="card">
        <h2>Cargar jornales</h2>
        <div className="form-grid">
          <Field label="Día">
            <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="Trabajo (opcional)">
            <select value={f.jobId} onChange={(e) => setF({ ...f, jobId: e.target.value })}>
              <option value="">—</option>
              {(jobs.data ?? []).map((j) => (
                <option key={j.id} value={j.id}>
                  N° {j.quote.number} · {j.quote.customer?.name ?? ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Equipo completo">
            <select value={f.crewId} onChange={(e) => setF({ ...f, crewId: e.target.value })}>
              <option value="">Elegí el equipo…</option>
              {(crews.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {money(c.dayRate)} c/u
                </option>
              ))}
            </select>
          </Field>
          <div className="actions">
            <button type="button" className="btn primary" disabled={!f.crewId || crewDay.isPending} onClick={() => crewDay.mutate()}>
              Cargar el día del equipo
            </button>
          </div>
        </div>
        <details>
          <summary className="small">Cargar un jornal suelto o un adelanto</summary>
          <div className="form-grid">
            <Field label="Quién">
              <input value={one.worker} onChange={(e) => setOne({ ...one, worker: e.target.value })} />
            </Field>
            <Field label="Monto ($)">
              <NumInput value={one.amount} onChange={(v) => setOne({ ...one, amount: v })} />
            </Field>
            <label className="check">
              <input type="checkbox" checked={one.advance} onChange={(e) => setOne({ ...one, advance: e.target.checked })} /> Es un adelanto
            </label>
            <div className="actions">
              <button type="button" className="btn small" disabled={!one.worker || !one.amount} onClick={() => single.mutate()}>
                Guardar
              </button>
            </div>
          </div>
        </details>
      </section>
      <section className="card">
        <div className="row between wrap">
          <h2>Semana del {dayMonth(from)}</h2>
          {!!unpaid.length && (
            <button type="button" className="btn small primary" onClick={() => pay.mutate(unpaid)}>
              Liquidar semana
            </button>
          )}
        </div>
        {q.isLoading ? (
          <Loading />
        ) : !byWorker.size ? (
          <p className="muted">Sin jornales cargados esta semana.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Colocador</th>
                  <th className="num">Días</th>
                  <th className="num">Ganó</th>
                  <th className="num">Adelantos</th>
                  <th className="num">A pagar</th>
                </tr>
              </thead>
              <tbody>
                {[...byWorker.values()].map((w) => (
                  <tr key={w.worker}>
                    <td>
                      {w.worker} {w.paid && <span className="pill good small-pill">pagado</span>}
                    </td>
                    <td className="num">{w.days}</td>
                    <td className="num">{money(w.earned)}</td>
                    <td className="num">{w.advances ? `−${money(w.advances)}` : '—'}</td>
                    <td className="num strong">{money(w.earned - w.advances)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const CHEQUE_STATUS = { CARTERA: 'En cartera', DEPOSITADO: 'Depositado', COBRADO: 'Cobrado', ENDOSADO: 'Endosado', RECHAZADO: 'Rechazado' } as const;

function Cheques() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['cheques'], queryFn: () => api<Payment[]>('/cheques') });
  const m = useMutation({
    mutationFn: ({ id, chequeStatus }: { id: string; chequeStatus: string }) => api(`/payments/${id}`, { method: 'PATCH', body: { chequeStatus } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cheques'] }),
  });
  if (q.isLoading) return <Loading />;
  const list = q.data ?? [];
  const inHand = list.filter((c) => c.chequeStatus === 'CARTERA' || c.chequeStatus === 'DEPOSITADO');
  return (
    <section className="card">
      <h2>Cheques y echeqs</h2>
      <p className="muted small">En cartera: {money(inHand.reduce((a, c) => a + Number(c.amount), 0))}. Se cargan como cobro con medio "Cheque" o "Echeq".</p>
      {!list.length ? (
        <Empty>No hay cheques cargados.</Empty>
      ) : (
        <ul className="list">
          {list.map((c) => {
            const late = c.chequeDueAt && new Date(c.chequeDueAt).getTime() < Date.now() && c.chequeStatus === 'CARTERA';
            return (
              <li key={c.id} className="list-row">
                <span className={'mono small ' + (late ? 'bad-text' : 'muted')}>{c.chequeDueAt ? `vence ${dateFmt(c.chequeDueAt)}` : 'sin fecha'}</span>
                <span className="grow">
                  <strong>{c.quote?.customer?.name ?? 'Cheque'}</strong>
                  <span className="muted small block">
                    {PAY_METHOD_LABEL[c.method]} {c.chequeBank} {c.chequeNumber && `N° ${c.chequeNumber}`}
                  </span>
                </span>
                <span className="num">{money(c.amount)}</span>
                <select value={c.chequeStatus ?? 'CARTERA'} aria-label="Estado del cheque" onChange={(e) => m.mutate({ id: c.id, chequeStatus: e.target.value })}>
                  {Object.entries(CHEQUE_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Invoices() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['invoices'], queryFn: () => api<Invoice[]>('/invoices') });
  const biz = useQuery({ queryKey: ['business'], queryFn: () => api<Business>('/business') });
  const [f, setF] = useState({ ptoVta: 1, number: null as number | null, date: new Date().toISOString().slice(0, 10), amount: null as number | null, customerName: '' });
  const add = useMutation({
    mutationFn: () => api('/invoices/manual', { body: { ...f, date: new Date(`${f.date}T12:00:00`).toISOString() } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['numbers'] });
      setF({ ...f, number: null, amount: null, customerName: '' });
      toast('Factura cargada');
    },
    onError: (e) => toast(errMsg(e)),
  });
  const list = q.data ?? [];
  return (
    <div className="stack">
      {biz.data && !biz.data.arcaReady && (
        <p className="note">
          Para emitir la factura C desde acá, cargá tu CUIT y el certificado de ARCA en <a href="/panel/ajustes#arca">Ajustes</a>. Mientras tanto, cargá las facturas que hacés afuera para controlar el tope del monotributo.
        </p>
      )}
      <section className="card">
        <h2>Cargar factura hecha afuera</h2>
        <div className="form-grid">
          <Field label="Punto de venta">
            <NumInput value={f.ptoVta} onChange={(v) => setF({ ...f, ptoVta: Math.round(v ?? 1) })} />
          </Field>
          <Field label="Número">
            <NumInput value={f.number} onChange={(v) => setF({ ...f, number: v == null ? null : Math.round(v) })} />
          </Field>
          <Field label="Fecha">
            <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label="Monto ($)">
            <NumInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
          </Field>
          <Field label="Cliente">
            <input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} />
          </Field>
          <div className="actions">
            <button type="button" className="btn primary" disabled={!f.number || !f.amount || add.isPending} onClick={() => add.mutate()}>
              Guardar
            </button>
          </div>
        </div>
      </section>
      <section className="card">
        <h2>Facturas de los últimos 12 meses</h2>
        {!list.length ? (
          <p className="muted">Todavía no hay facturas.</p>
        ) : (
          <ul className="list">
            {list.map((i) => (
              <li key={i.id} className="list-row">
                <span className="mono small">
                  C {String(i.ptoVta).padStart(4, '0')}-{String(i.number).padStart(8, '0')}
                </span>
                <span className="grow">
                  {i.customerName || 'Consumidor final'}
                  <span className="muted small block">
                    {dateFmt(i.date)} · {i.manual ? 'cargada a mano' : `CAE ${i.cae}`}
                  </span>
                </span>
                <span className="num">{money(i.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

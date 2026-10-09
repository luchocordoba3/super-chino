// La caja de la casa de celulares: IMEI, dos monedas, cuotas, crédito de usados, señas, reparaciones y cadetes.
// Todo funciona sin internet: los datos vienen del último bootstrap y lo que está en la cola todavía no sincronizada.
import { type FormEvent, useMemo, useState } from 'react';
import { addMonthsYMD, type Payment, type StoreSettings, warrantyMonths } from '@super-chino/shared';
import { Field, Modal, toast, toNum } from '../components/ui';
import { money } from '../lib/format';
import { type CashSessionLocal, db, kvGet, kvSet, type LocalSale, normalize, type PhoneData, type PosUser, type StoreInfo } from '../pos/db';
import { enqueue } from '../pos/sync';
import { inCur, round2, usd } from './common';

const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

export type Serial = PhoneData['serials'][number];
export interface SaleCustomer {
  id: string;
  name: string;
  phone?: string | null;
  dni?: string | null;
  isNew?: boolean;
}

/** Datos del bootstrap menos lo que ya se usó en esta PC y todavía no se sincronizó. */
export async function loadPhone(): Promise<PhoneData | null> {
  const data = await kvGet<PhoneData | null>('phones');
  if (!data) return null;
  const sold = new Set<string>();
  const reserved = new Set<string>();
  const usedCredits = new Set<string>();
  const usedDeposits = new Set<string>();
  const charged = new Set<string>();
  const settled = new Set<string>();
  const newDeposits: PhoneData['deposits'] = [];
  const newCustomers: PhoneData['customers'] = [];
  await db.outbox.each(({ event: ev }) => {
    if (ev.type === 'SALE') {
      for (const it of ev.items) {
        if (it.serialItemId) sold.add(it.serialItemId);
        if (it.repairOrderId) charged.add(it.repairOrderId);
      }
      for (const p of ev.payments) {
        if (p.method === 'TRADE_IN' && p.ref) usedCredits.add(p.ref);
        if (p.method === 'DEPOSIT' && p.ref) usedDeposits.add(p.ref);
      }
      if (ev.newCustomer) newCustomers.push({ id: ev.newCustomer.id, name: ev.newCustomer.name, phone: ev.newCustomer.phone ?? null, dni: ev.newCustomer.dni ?? null });
    }
    if (ev.type === 'DEPOSIT_IN') {
      if (ev.serialItemId) reserved.add(ev.serialItemId);
      if (ev.newCustomer) newCustomers.push({ id: ev.newCustomer.id, name: ev.newCustomer.name, phone: ev.newCustomer.phone ?? null, dni: ev.newCustomer.dni ?? null });
      const custId = ev.customerId ?? ev.newCustomer?.id ?? null;
      newDeposits.push({
        id: ev.depositId,
        customerId: custId,
        customer: ev.newCustomer?.name ?? data.customers.find((c) => c.id === custId)?.name ?? null,
        serialItemId: ev.serialItemId ?? null,
        repairOrderId: ev.repairOrderId ?? null,
        orderId: ev.orderId ?? null,
        amount: ev.amount,
        currency: ev.currency,
        fx: ev.fx ?? null,
        expiresAt: ev.expiresAt ?? null,
      });
    }
    if (ev.type === 'CASH_MOVE' && ev.kind === 'PURCHASE' && ev.refId) usedCredits.add(ev.refId);
    if (ev.type === 'CASH_MOVE' && ev.kind === 'COURIER' && ev.refId) settled.add(`${ev.refId}:${ev.currency ?? 'ARS'}`);
  });
  const known = new Set(data.customers.map((c) => c.id));
  return {
    ...data,
    serials: data.serials.filter((s) => !sold.has(s.id)).map((s) => (reserved.has(s.id) ? { ...s, status: 'RESERVED' as const } : s)),
    tradeIns: data.tradeIns.filter((t) => !usedCredits.has(t.id)),
    deposits: [...data.deposits, ...newDeposits.filter((d) => !data.deposits.some((x) => x.id === d.id))].filter((d) => !usedDeposits.has(d.id)),
    repairs: data.repairs.filter((r) => !charged.has(r.id)),
    customers: [...newCustomers.filter((c) => !known.has(c.id)), ...data.customers],
    couriers: data.couriers.map((c) => ({ ...c, pendingArs: settled.has(`${c.id}:ARS`) ? 0 : c.pendingArs, pendingUsd: settled.has(`${c.id}:USD`) ? 0 : c.pendingUsd })),
  };
}

/** Busca un equipo por IMEI (cualquiera de los dos) o número de serie. */
export function findSerial(ph: PhoneData, code: string) {
  const digits = code.replace(/\D/g, '');
  const raw = code.trim().toUpperCase();
  return ph.serials.find((s) => (digits.length >= 8 && (s.imei1 === digits || s.imei2 === digits)) || (s.serial && s.serial.toUpperCase() === raw));
}

export const serialDetail = (s: Serial) =>
  [s.imei1 ? `IMEI ${s.imei1}` : s.serial, s.condition === 'NEW' ? 'Nuevo' : `Usado${s.grade ? ` ${s.grade}` : ''}${s.battery != null ? ` · ${s.battery}%` : ''}`, s.color].filter(Boolean).join(' · ');

/** Elegir qué equipo (IMEI) de un modelo se vende. */
export function UnitPicker({ ph, productId, onPick, onClose }: { ph: PhoneData; productId?: string; onPick: (s: Serial) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = ph.serials.filter((s) => (!productId || s.productId === productId) && (!q || normalize(`${s.name} ${s.imei1 ?? ''} ${s.serial ?? ''} ${s.color ?? ''}`).includes(normalize(q))));
  return (
    <Modal title="Elegir equipo" onClose={onClose}>
      <div className="stack">
        <input autoFocus placeholder="Buscar por IMEI, modelo o color" value={q} onChange={(e) => setQ(e.target.value)} />
        {list.length === 0 && <p className="muted">No hay equipos disponibles de este modelo.</p>}
        {list.slice(0, 40).map((s) => (
          <button key={s.id} className="small" style={{ justifyContent: 'space-between', textAlign: 'left' }} onClick={() => onPick(s)}>
            <span>
              <strong>{s.name}</strong>
              <br />
              <span className="muted">{serialDetail(s)}</span>
              {s.status === 'RESERVED' && <span className="badge gold"> Señado</span>}
            </span>
            <strong>{inCur(s.price, s.currency)}</strong>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** Cliente de la venta (de la lista guardada en la PC, o uno nuevo). */
export function CustomerModal({ ph, onPick, onClose }: { ph: PhoneData; onPick: (c: SaleCustomer | null) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState({ name: '', phone: '', dni: '' });
  const term = normalize(q);
  const digits = q.replace(/\D/g, '');
  const list = q.length >= 2 ? ph.customers.filter((c) => normalize(c.name).includes(term) || (digits.length >= 3 && ((c.dni ?? '').includes(digits) || (c.phone ?? '').includes(digits)))).slice(0, 12) : [];
  const create = (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    onPick({ id: uuid(), name: f.name.trim(), phone: f.phone.trim() || null, dni: f.dni.trim() || null, isNew: true });
  };
  return (
    <Modal title="Cliente" onClose={onClose}>
      <div className="stack">
        <input autoFocus placeholder="Buscar por nombre, DNI o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
        {list.map((c) => (
          <button key={c.id} className="small" style={{ justifyContent: 'flex-start' }} onClick={() => onPick(c)}>
            {c.name} <span className="muted">{[c.dni, c.phone].filter(Boolean).join(' · ')}</span>
          </button>
        ))}
        <form className="card stack" onSubmit={create}>
          <strong>Cliente nuevo</strong>
          <input placeholder="Nombre y apellido" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <div className="row">
            <input style={{ flex: 1 }} placeholder="DNI" inputMode="numeric" value={f.dni} onChange={(e) => setF({ ...f, dni: e.target.value })} />
            <input style={{ flex: 1 }} placeholder="WhatsApp" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </div>
          <button className="primary">Usar este cliente</button>
        </form>
        <button className="ghost" onClick={() => onPick(null)}>
          Venta sin cliente
        </button>
      </div>
    </Modal>
  );
}

type Method = 'CASH' | 'CASH_USD' | 'DEBIT' | 'CREDIT' | 'QR' | 'TRANSFER' | 'TRADE_IN' | 'DEPOSIT';
const METHOD_LABELS: Record<Method, string> = { CASH: 'Efectivo $', CASH_USD: 'Efectivo US$', DEBIT: 'Débito', CREDIT: 'Crédito / cuotas', QR: 'QR', TRANSFER: 'Transferencia', TRADE_IN: 'Usado tomado', DEPOSIT: 'Seña' };
interface Row {
  method: Method;
  amount: string;
  planId?: string;
  ref?: string;
}
export interface PhonePayResult {
  payments: Payment[];
  changeArs: number;
  changeUsd: number;
  cashArs: number;
  cashUsd: number;
}

/** Valor en pesos de un renglón de pago. */
function rowArs(r: Row, rate: number, ph: PhoneData) {
  if (r.method === 'TRADE_IN') return round2((ph.tradeIns.find((t) => t.id === r.ref)?.amountUsd ?? 0) * rate);
  if (r.method === 'DEPOSIT') {
    const d = ph.deposits.find((x) => x.id === r.ref);
    return d ? (d.currency === 'USD' && d.fx ? round2(d.fx * rate) : d.amount) : 0;
  }
  const n = toNum(r.amount) ?? 0;
  return r.method === 'CASH_USD' ? round2(n * rate) : n;
}

/** Reparte el total entre los pagos: en efectivo, con un usado o una seña puede sobrar (vuelto). */
export function settlePhone(total: number, rows: Row[], rate: number, ph: PhoneData, plans: StoreSettings['cardPlans'], changeIn: 'ARS' | 'USD'): PhonePayResult & { missing: number; surcharge: number } {
  let remaining = round2(total);
  let change = 0;
  let surcharge = 0;
  const payments: Payment[] = [];
  let arsIn = 0;
  let usdIn = 0;
  for (const r of rows) {
    const value = rowArs(r, rate, ph);
    if (r.method === 'CASH') arsIn += value;
    if (r.method === 'CASH_USD') usdIn += toNum(r.amount) ?? 0;
    if (value <= 0) continue;
    const applied = Math.min(value, remaining);
    if (value > applied && (r.method === 'CASH' || r.method === 'CASH_USD' || r.method === 'TRADE_IN' || r.method === 'DEPOSIT')) change = round2(change + value - applied);
    remaining = round2(remaining - applied);
    if (applied <= 0) continue;
    const p: Payment = { method: r.method === 'CASH_USD' ? 'CASH' : r.method, amount: round2(applied) };
    if (r.method === 'CASH_USD') Object.assign(p, { currency: 'USD', fx: round2(applied / rate) });
    if (r.ref) p.ref = r.ref;
    const plan = r.method === 'CREDIT' ? plans.find((x) => x.id === r.planId) : undefined;
    if (plan) {
      const s = round2((applied * plan.pct) / 100);
      Object.assign(p, { installments: plan.installments, surcharge: s });
      surcharge += s;
    }
    payments.push(p);
  }
  const changeUsd = changeIn === 'USD' ? round2(change / rate) : 0;
  return {
    payments: payments.length ? payments : [{ method: 'CASH', amount: 0 }],
    missing: remaining > 0 ? remaining : 0,
    changeArs: changeIn === 'ARS' ? change : 0,
    changeUsd,
    cashArs: round2(arsIn - (changeIn === 'ARS' ? change : 0)),
    cashUsd: round2(usdIn - changeUsd),
    surcharge: round2(surcharge),
  };
}

export function PhonePayModal(props: {
  total: number;
  rate: number;
  ph: PhoneData;
  customer: SaleCustomer | null;
  settings: StoreSettings;
  onClose: () => void;
  onConfirm: (r: PhonePayResult) => void;
}) {
  const { total, rate, ph, customer, settings } = props;
  const [rows, setRows] = useState<Row[]>([{ method: 'CASH', amount: String(total) }]);
  const [changeIn, setChangeIn] = useState<'ARS' | 'USD'>('ARS');
  const res = useMemo(() => settlePhone(total, rows, rate, ph, settings.cardPlans, changeIn), [total, rows, rate, ph, settings.cardPlans, changeIn]);
  const credits = ph.tradeIns.filter((t) => t.payout === 'CREDIT');
  const deposits = ph.deposits;
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pick = (i: number, m: Method) => {
    // Lo que falta sin contar este renglón.
    const rest = settlePhone(total, rows.filter((_, j) => j !== i), rate, ph, settings.cardPlans, changeIn).missing;
    if (m === 'TRADE_IN') {
      const mine = credits.find((t) => t.customerId === customer?.id) ?? credits[0];
      return setRow(i, { method: m, ref: mine?.id, amount: '' });
    }
    if (m === 'DEPOSIT') {
      const mine = deposits.find((d) => d.customerId === customer?.id) ?? deposits[0];
      return setRow(i, { method: m, ref: mine?.id, amount: '' });
    }
    setRow(i, { method: m, ref: undefined, planId: m === 'CREDIT' ? settings.cardPlans[0]?.id : undefined, amount: m === 'CASH_USD' ? String(round2(rest / rate)) : String(rest) });
  };
  const usdTotal = round2(total / rate);
  return (
    <Modal title={`Cobrar ${money(total)} · ${usd(usdTotal)}`} onClose={props.onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (res.missing <= 0) props.onConfirm(res);
        }}
      >
        {customer && <p className="small">Cliente: {customer.name}</p>}
        {rows.map((r, i) => {
          const plan = settings.cardPlans.find((p) => p.id === r.planId);
          const value = rowArs(r, rate, ph);
          return (
            <div key={i} className="card stack" style={{ padding: 10 }}>
              <div className="row">
                {(Object.keys(METHOD_LABELS) as Method[])
                  .filter((m) => (m !== 'TRADE_IN' || credits.length) && (m !== 'DEPOSIT' || deposits.length))
                  .map((m) => (
                    <button type="button" key={m} className={`small ${r.method === m ? 'primary' : ''}`} onClick={() => pick(i, m)}>
                      {METHOD_LABELS[m]}
                    </button>
                  ))}
                {i > 0 && (
                  <button type="button" className="small ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                )}
              </div>
              {r.method === 'TRADE_IN' ? (
                <select value={r.ref ?? ''} onChange={(e) => setRow(i, { ref: e.target.value })}>
                  {credits.map((t) => (
                    <option key={t.id} value={t.id}>
                      Toma #{t.number} · {t.customer} · {t.model} · {usd(t.amountUsd)} ({money(t.amountUsd * rate)})
                    </option>
                  ))}
                </select>
              ) : r.method === 'DEPOSIT' ? (
                <select value={r.ref ?? ''} onChange={(e) => setRow(i, { ref: e.target.value })}>
                  {deposits.map((d) => (
                    <option key={d.id} value={d.id}>
                      Seña de {d.customer ?? 'sin nombre'} · {d.currency === 'USD' ? usd(d.fx) : money(d.amount)}
                    </option>
                  ))}
                </select>
              ) : (
                <Field label={r.method === 'CASH_USD' ? 'Dólares recibidos' : r.method === 'CASH' ? 'Pesos recibidos' : 'Monto ($)'}>
                  <input autoFocus={i === 0} inputMode="decimal" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} style={{ fontSize: '1.4rem' }} />
                </Field>
              )}
              {r.method === 'CASH_USD' && <span className="small muted">= {money(value)} a {money(rate)}</span>}
              {r.method === 'CREDIT' && (
                <>
                  <select value={r.planId ?? ''} onChange={(e) => setRow(i, { planId: e.target.value })}>
                    {settings.cardPlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.installments === 1 ? '1 pago' : `${p.installments} cuotas`}, +{p.pct}%)
                      </option>
                    ))}
                  </select>
                  {plan && value > 0 && (
                    <p className="small">
                      Cobrar en la tarjeta <strong>{money(round2(value * (1 + plan.pct / 100)))}</strong> en {plan.installments} cuota{plan.installments > 1 ? 's' : ''} de{' '}
                      <strong>{money(round2((value * (1 + plan.pct / 100)) / plan.installments))}</strong>
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
        {res.missing > 0 && (
          <>
            <p className="warn">
              Falta: {money(res.missing)} ({usd(round2(res.missing / rate))})
            </p>
            <button type="button" onClick={() => setRows([...rows, { method: 'TRANSFER', amount: String(res.missing) }])}>
              + Otro medio de pago
            </button>
          </>
        )}
        {res.changeArs + res.changeUsd > 0 || rows.some((r) => rowArs(r, rate, ph) > total) ? (
          <div className="stack">
            <div className="row">
              <span>Vuelto en:</span>
              <button type="button" className={`small ${changeIn === 'ARS' ? 'primary' : ''}`} onClick={() => setChangeIn('ARS')}>
                Pesos
              </button>
              <button type="button" className={`small ${changeIn === 'USD' ? 'primary' : ''}`} onClick={() => setChangeIn('USD')}>
                Dólares
              </button>
            </div>
            <p className="pos-total" style={{ fontSize: '1.8rem', color: 'var(--ok)' }}>
              Vuelto: {changeIn === 'USD' ? usd(res.changeUsd) : money(res.changeArs)}
            </p>
          </div>
        ) : null}
        <button className="primary big" disabled={res.missing > 0}>
          Confirmar venta
        </button>
      </form>
    </Modal>
  );
}

/** Seña: reserva un equipo (o deja plata a cuenta de una reparación) hasta una fecha. */
export function DepositModal(props: { ph: PhoneData; rate: number; session: CashSessionLocal; cashier: PosUser; settings: StoreSettings; customer: SaleCustomer | null; onClose: () => void; onDone: () => void }) {
  const { ph, rate, session, cashier, settings } = props;
  const [customer, setCustomer] = useState<SaleCustomer | null>(props.customer);
  const [picking, setPicking] = useState<'customer' | 'unit' | null>(props.customer ? null : 'customer');
  const [unit, setUnit] = useState<Serial | null>(null);
  const [repairId, setRepairId] = useState('');
  const [f, setF] = useState({ currency: 'USD' as 'ARS' | 'USD', amount: '', method: 'CASH' as 'CASH' | 'TRANSFER' | 'QR' | 'DEBIT', days: String(settings.depositDays), note: '' });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = toNum(f.amount);
    if (!customer) return toast('Elegí el cliente');
    if (!n || n <= 0) return toast('Poné el monto');
    const amount = f.currency === 'USD' ? round2(n * rate) : n;
    const depositId = uuid();
    const occurredAt = nowIso();
    const days = Math.max(1, Number(f.days) || settings.depositDays);
    await enqueue({
      id: uuid(),
      type: 'DEPOSIT_IN',
      userId: cashier.id,
      occurredAt,
      cashSessionId: session.id,
      depositId,
      customerId: customer.isNew ? null : customer.id,
      newCustomer: customer.isNew ? { id: customer.id, name: customer.name, phone: customer.phone ?? undefined, dni: customer.dni ?? undefined } : undefined,
      serialItemId: unit?.id ?? null,
      repairOrderId: repairId || null,
      amount,
      currency: f.currency,
      fx: f.currency === 'USD' ? n : undefined,
      method: f.method,
      expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
      note: f.note || undefined,
    });
    if (f.method === 'CASH') {
      const key = `cashDeposits:${session.id}`;
      await kvSet(key, [...((await kvGet<{ currency: string; amount: number; fx?: number }[]>(key)) ?? []), { currency: f.currency, amount, fx: f.currency === 'USD' ? n : undefined }]);
    }
    toast(`Seña de ${f.currency === 'USD' ? usd(n) : money(n)} registrada`);
    props.onDone();
  };
  if (picking === 'customer') return <CustomerModal ph={ph} onPick={(c) => (setCustomer(c), setPicking(null))} onClose={props.onClose} />;
  if (picking === 'unit') return <UnitPicker ph={{ ...ph, serials: ph.serials.filter((s) => s.status === 'AVAILABLE') }} onPick={(s) => (setUnit(s), setPicking(null))} onClose={() => setPicking(null)} />;
  return (
    <Modal title="💵 Seña" onClose={props.onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="row between">
          <span>Cliente: {customer?.name ?? '—'}</span>
          <button type="button" className="small" onClick={() => setPicking('customer')}>
            Cambiar
          </button>
        </div>
        <div className="row between">
          <span>{unit ? `${unit.name} · ${serialDetail(unit)}` : 'Sin equipo reservado'}</span>
          <button type="button" className="small" onClick={() => setPicking('unit')}>
            Elegir equipo
          </button>
        </div>
        {!unit && ph.repairs.length > 0 && (
          <Field label="…o a cuenta de una reparación">
            <select value={repairId} onChange={(e) => setRepairId(e.target.value)}>
              <option value="">—</option>
              {ph.repairs.map((r) => (
                <option key={r.id} value={r.id}>
                  #{r.number} · {r.customer} · {r.device}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="row">
          <button type="button" className={`small ${f.currency === 'USD' ? 'primary' : ''}`} onClick={() => setF({ ...f, currency: 'USD' })}>
            Dólares
          </button>
          <button type="button" className={`small ${f.currency === 'ARS' ? 'primary' : ''}`} onClick={() => setF({ ...f, currency: 'ARS' })}>
            Pesos
          </button>
          <select style={{ width: 'auto' }} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as typeof f.method })}>
            <option value="CASH">Efectivo</option>
            <option value="TRANSFER">Transferencia</option>
            <option value="QR">QR</option>
            <option value="DEBIT">Débito</option>
          </select>
        </div>
        <Field label={`Monto (${f.currency === 'USD' ? 'US$' : '$'})`}>
          <input autoFocus inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} style={{ fontSize: '1.4rem' }} />
        </Field>
        <Field label="Días que lo reservamos">
          <input inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />
        </Field>
        <Field label="Nota">
          <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <button className="primary big">Cobrar seña</button>
      </form>
    </Modal>
  );
}

/** Reparaciones para cobrar en la caja (las listas primero). */
export function RepairChargeModal({ ph, rate, onPick, onClose }: { ph: PhoneData; rate: number; onPick: (r: PhoneData['repairs'][number], ars: number) => void; onClose: () => void }) {
  const list = [...ph.repairs].sort((a, b) => Number(b.status === 'READY') - Number(a.status === 'READY'));
  return (
    <Modal title="🔧 Cobrar reparación" onClose={onClose}>
      <div className="stack">
        {list.length === 0 && <p className="muted">No hay reparaciones para cobrar.</p>}
        {list.map((r) => (
          <button key={r.id} className="small" style={{ justifyContent: 'space-between', textAlign: 'left' }} disabled={r.status !== 'READY'} onClick={() => onPick(r, r.currency === 'USD' ? round2(r.amount * rate) : r.amount)}>
            <span>
              #{r.number} · {r.customer} · {r.device}
              {r.status !== 'READY' && <span className="muted"> (todavía no está lista)</span>}
            </span>
            <strong>{inCur(r.amount, r.currency)}</strong>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** Pagarle a quien nos vendió un usado (compra) desde la caja. */
export function PayTradeInModal({ ph, rate, session, cashier, onClose }: { ph: PhoneData; rate: number; session: CashSessionLocal; cashier: PosUser; onClose: () => void }) {
  const list = ph.tradeIns.filter((t) => t.payout === 'CASH');
  const [currency, setCurrency] = useState<'USD' | 'ARS'>('USD');
  const pay = async (t: PhoneData['tradeIns'][number]) => {
    const amount = currency === 'USD' ? t.amountUsd : round2(t.amountUsd * rate);
    if (!window.confirm(`¿Pagar ${currency === 'USD' ? usd(amount) : money(amount)} a ${t.customer}?`)) return;
    const id = uuid();
    const occurredAt = nowIso();
    const reason = `Usado #${t.number} ${t.model}`;
    await enqueue({ id, type: 'CASH_MOVE', userId: cashier.id, occurredAt, cashSessionId: session.id, kind: 'PURCHASE', amount, currency, reason, refId: t.id });
    const key = `cashMoves:${session.id}`;
    await kvSet(key, [...((await kvGet<object[]>(key)) ?? []), { id, kind: 'PURCHASE', amount, currency, reason, occurredAt }]);
    toast('Pago registrado');
    onClose();
  };
  return (
    <Modal title="♻️ Pagar usado comprado" onClose={onClose}>
      <div className="stack">
        <div className="row">
          <span>Pagar en:</span>
          <button className={`small ${currency === 'USD' ? 'primary' : ''}`} onClick={() => setCurrency('USD')}>
            Dólares
          </button>
          <button className={`small ${currency === 'ARS' ? 'primary' : ''}`} onClick={() => setCurrency('ARS')}>
            Pesos ({money(rate)})
          </button>
        </div>
        {list.length === 0 && <p className="muted">No hay compras de usados aceptadas para pagar.</p>}
        {list.map((t) => (
          <button key={t.id} className="small" style={{ justifyContent: 'space-between' }} onClick={() => void pay(t)}>
            <span>
              #{t.number} · {t.customer} · {t.model}
            </span>
            <strong>{currency === 'USD' ? usd(t.amountUsd) : money(t.amountUsd * rate)}</strong>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** Rendición del cadete: entrega en la caja lo que cobró en las entregas. */
export function CourierModal({ ph, session, cashier, onClose }: { ph: PhoneData; session: CashSessionLocal; cashier: PosUser; onClose: () => void }) {
  const [courierId, setCourierId] = useState(ph.couriers.find((c) => c.pendingArs || c.pendingUsd)?.id ?? ph.couriers[0]?.id ?? '');
  const c = ph.couriers.find((x) => x.id === courierId);
  const [ars, setArs] = useState('');
  const [usdAmt, setUsd] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!c) return;
    const key = `cashMoves:${session.id}`;
    const local = (await kvGet<object[]>(key)) ?? [];
    for (const [currency, raw] of [['ARS', ars], ['USD', usdAmt]] as const) {
      const n = toNum(raw);
      if (!n || n <= 0) continue;
      const id = uuid();
      const occurredAt = nowIso();
      await enqueue({ id, type: 'CASH_MOVE', userId: cashier.id, occurredAt, cashSessionId: session.id, kind: 'COURIER', amount: n, currency, reason: `Rendición ${c.name}`, refId: c.id });
      local.push({ id, kind: 'COURIER', amount: n, currency, reason: `Rendición ${c.name}`, occurredAt });
    }
    await kvSet(key, local);
    toast('Rendición registrada');
    onClose();
  };
  return (
    <Modal title="🛵 Rendición de cadete" onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <select value={courierId} onChange={(e) => setCourierId(e.target.value)}>
          {ph.couriers.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        {c && (
          <p className="small">
            Según las entregas tiene que rendir <strong>{money(c.pendingArs)}</strong>
            {c.pendingUsd ? (
              <>
                {' '}
                y <strong>{usd(c.pendingUsd)}</strong>
              </>
            ) : null}
            .
          </p>
        )}
        <Field label="Entrega en pesos">
          <input autoFocus inputMode="decimal" value={ars} onChange={(e) => setArs(e.target.value)} placeholder={c ? String(c.pendingArs) : ''} />
        </Field>
        <Field label="Entrega en dólares">
          <input inputMode="decimal" value={usdAmt} onChange={(e) => setUsd(e.target.value)} placeholder={c?.pendingUsd ? String(c.pendingUsd) : ''} />
        </Field>
        <button className="primary big">Registrar</button>
      </form>
    </Modal>
  );
}

/** Garantía (fecha hasta) de lo que se vende hoy, igual que la calcula el servidor. */
export function warrantyUntilFor(settings: StoreSettings, condition: 'NEW' | 'USED' | 'REFURB', productMonths?: number | null) {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return addMonthsYMD(ymd, warrantyMonths(settings, condition, productMonths));
}

/** Ticket y certificado de garantía de la casa de celulares (siempre en español). */
export function PhoneTicket({ sale, store }: { sale: LocalSale; store: StoreInfo | null }) {
  const fmtDay = (ymd: string) => ymd.split('-').reverse().join('/');
  const withWarranty = sale.lines.filter((l) => l.warrantyUntil);
  const methods: Record<string, string> = { CASH: 'Efectivo', DEBIT: 'Débito', CREDIT: 'Crédito', QR: 'QR', TRANSFER: 'Transferencia', TRADE_IN: 'Usado tomado', DEPOSIT: 'Seña' };
  return (
    <div className="print-area ticket print-only">
      <div style={{ textAlign: 'center', fontWeight: 700 }}>{store?.name}</div>
      <div>{new Date(sale.occurredAt).toLocaleString('es-AR')}</div>
      <div>#{sale.id.slice(0, 8)}</div>
      {sale.customerName && <div>Cliente: {sale.customerName}</div>}
      <hr />
      {sale.lines.map((l, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>
              {l.qty !== 1 ? `${l.qty} ` : ''}
              {l.name}
            </span>
            <span>{money(l.lineTotal)}</span>
          </div>
          {l.imei && <div style={{ fontSize: 10 }}>{l.imei}</div>}
        </div>
      ))}
      <hr />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
        <span>Total</span>
        <span>{money(sale.total)}</span>
      </div>
      {sale.rate ? <div style={{ fontSize: 10, textAlign: 'right' }}>({usd(round2(sale.total / sale.rate))} · dólar {money(sale.rate)})</div> : null}
      {sale.payments.map((p, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>
            {methods[p.method] ?? p.method}
            {p.currency === 'USD' ? ' US$' : ''}
            {p.installments && p.installments > 1 ? ` ${p.installments} cuotas` : ''}
          </span>
          <span>{p.currency === 'USD' ? usd(p.fx) : money(p.amount + (p.surcharge ?? 0))}</span>
        </div>
      ))}
      {sale.change > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Vuelto</span>
          <span>{sale.changeUsd ? usd(sale.changeUsd) : money(sale.change)}</span>
        </div>
      )}
      {withWarranty.length > 0 && (
        <>
          <hr />
          <div style={{ textAlign: 'center', fontWeight: 700 }}>CERTIFICADO DE GARANTÍA</div>
          {withWarranty.map((l, i) => (
            <div key={i} style={{ fontSize: 11 }}>
              {l.name} {l.imei ? `· ${l.imei}` : ''} {l.condition ? `· ${l.condition}` : ''}
              <br />
              Garantía hasta el <strong>{fmtDay(l.warrantyUntil!)}</strong>
            </div>
          ))}
          <div style={{ fontSize: 9, marginTop: 4 }}>
            Garantía legal según Ley 24.240 de Defensa del Consumidor. Conservá este comprobante.
            {store?.settings.warrantyTerms ? ` ${store.settings.warrantyTerms}` : ''}
          </div>
        </>
      )}
      <hr />
      <div style={{ textAlign: 'center' }}>¡Gracias por tu compra!</div>
    </div>
  );
}

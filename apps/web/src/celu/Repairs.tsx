// Servicio técnico: órdenes, presupuesto por WhatsApp con link para aprobar, repuestos y comprobante de ingreso.
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEVICE_CHECK_LABELS, DEVICE_CHECKS, type DeviceCheck, REPAIR_STATUS_LABELS, type RepairStatus } from '@super-chino/shared';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Field, Loading, Tabs, toast, toNum } from '../components/ui';
import { dateTimeFmt, dayFmt } from '../lib/format';
import { can, useMe } from '../lib/me';
import { Badge, type Customer, CustomerPicker, ImeiInput, inCur, PatternPad, PhotoButton, ProductPicker, uploadImage, WaButton } from './common';
import type { SerialRow } from './Serials';

interface QuoteLine {
  kind: 'PART' | 'LABOR';
  productId?: string | null;
  name: string;
  qty: number;
  price: number;
}
interface Repair {
  id: string;
  number: number;
  status: RepairStatus;
  customer: Customer;
  device: string;
  imei: string | null;
  problem: string;
  accessories: string | null;
  checklist: Partial<Record<DeviceCheck, 'ok' | 'bad' | 'na'>>;
  lockType: 'NONE' | 'PIN' | 'PATTERN' | 'PASSWORD';
  hasLock: boolean;
  lockSecret: string | null;
  technicianId: string | null;
  technician: string | null;
  promisedAt: string | null;
  diagnosis: string | null;
  quote: QuoteLine[];
  quoteTotal: number;
  currency: 'ARS' | 'USD';
  diagnosisFee: number;
  quoteApproved: boolean | null;
  quoteAnswerAt: string | null;
  quoteAnswerBy: string | null;
  partsUsed: boolean;
  partsCost: number;
  warrantyDays: number;
  warrantyOfId: string | null;
  publicToken: string;
  charge: number;
  daysOpen: number;
  stuck: boolean;
  photos: string[];
  createdAt: string;
  deliveredAt: string | null;
  user: string | null;
  serialItemId: string | null;
  events?: { id: string; status: RepairStatus | null; note: string | null; public: boolean; createdAt: string; user: string | null }[];
  deposits?: { id: string; amount: number; currency: string; fx: number | null; status: string }[];
}

const publicUrl = (r: Pick<Repair, 'publicToken'>) => `${window.location.origin}/r/${r.publicToken}`;
/** Siguiente paso habitual para cada estado. */
const NEXT: Partial<Record<RepairStatus, RepairStatus[]>> = {
  RECEIVED: ['DIAGNOSIS'],
  DIAGNOSIS: ['QUOTE_SENT', 'IN_REPAIR'],
  QUOTE_SENT: [],
  APPROVED: ['IN_REPAIR', 'WAITING_PART'],
  REJECTED: ['READY'],
  WAITING_PART: ['IN_REPAIR'],
  IN_REPAIR: ['READY', 'WAITING_PART'],
};

export function Repairs() {
  const me = useMe();
  const [tab, setTab] = useState<'open' | 'READY' | 'mine' | 'DELIVERED'>('open');
  const [q, setQ] = useState('');
  const query = tab === 'open' ? 'open=true' : tab === 'mine' ? 'open=true&mine=true' : `status=${tab}`;
  const list = useQuery({ queryKey: ['repairs', tab, q], queryFn: () => api<Repair[]>(`/repairs?${query}&q=${encodeURIComponent(q)}`) });
  return (
    <div className="stack">
      <div className="row between">
        <h1>Servicio técnico</h1>
        <Link className="btn btn-primary" to="/repairs/new">
          + Recibir equipo
        </Link>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'open', label: 'En curso' },
          ...(can(me, 'repairs') ? [{ id: 'mine' as const, label: 'Asignadas a mí' }] : []),
          { id: 'READY', label: 'Listas para retirar' },
          { id: 'DELIVERED', label: 'Entregadas' },
        ]}
      />
      <input placeholder="Buscar por número, cliente, modelo o IMEI" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.isLoading && <Loading />}
      <ErrorBox error={list.error} />
      {list.data?.length === 0 && <Empty />}
      {list.data?.map((r) => (
        <Link key={r.id} to={`/repairs/${r.id}`} className="card row between" style={{ textDecoration: 'none', color: 'inherit', borderLeft: r.stuck ? '4px solid var(--warn)' : undefined }}>
          <div className="grow">
            <strong>
              #{r.number} · {r.device}
            </strong>
            <div className="small muted">
              {r.customer.name} · {r.problem.slice(0, 60)} · hace {r.daysOpen} días{r.technician ? ` · ${r.technician}` : ''}
              {r.promisedAt ? ` · prometido ${dayFmt(r.promisedAt)}` : ''}
            </div>
          </div>
          <Badge status={r.status} label={REPAIR_STATUS_LABELS[r.status]} />
        </Link>
      ))}
    </div>
  );
}

export function NewRepair() {
  const nav = useNavigate();
  const loc = useLocation() as { state?: { serial?: SerialRow; customer?: Customer | null; warranty?: boolean } };
  const pre = loc.state;
  const techs = useQuery({ queryKey: ['technicians'], queryFn: () => api<{ id: string; name: string }[]>('/technicians') });
  const [customer, setCustomer] = useState<Customer | null>(pre?.customer ?? null);
  const [f, setF] = useState({
    device: pre?.serial?.product ?? '',
    imei: pre?.serial?.imei1 ?? '',
    problem: '',
    accessories: '',
    lockType: 'NONE' as Repair['lockType'],
    lockSecret: '',
    technicianId: '',
    promisedAt: '',
    diagnosisFee: '',
    currency: 'ARS' as 'ARS' | 'USD',
  });
  const [checks, setChecks] = useState<Partial<Record<DeviceCheck, 'ok' | 'bad' | 'na'>>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customer) return toast('Elegí o cargá el cliente');
    setBusy(true);
    try {
      const r = await api<Repair>('/repairs', {
        body: {
          customerId: customer.id,
          serialItemId: pre?.serial && !pre.customer ? pre.serial.id : null,
          device: f.device,
          imei: f.imei || null,
          problem: f.problem,
          accessories: f.accessories || null,
          checklist: checks,
          lockType: f.lockType,
          lockSecret: f.lockType === 'NONE' ? null : f.lockSecret || null,
          technicianId: f.technicianId || null,
          promisedAt: f.promisedAt ? new Date(`${f.promisedAt}T18:00:00`).toISOString() : null,
          diagnosisFee: toNum(f.diagnosisFee) ?? 0,
          currency: f.currency,
        },
      });
      nav(`/repairs/${r.id}?print=1`, { replace: true });
    } catch (err) {
      toast(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <Link to="/repairs">← Servicio técnico</Link>
      <h1>Recibir equipo{pre?.warranty ? ' (garantía)' : ''}</h1>
      <div className="card stack">
        <h3>Cliente</h3>
        <CustomerPicker value={customer} onChange={setCustomer} required />
      </div>
      <div className="card stack">
        <h3>Equipo</h3>
        <div className="grid2">
          <Field label="Marca y modelo *">
            <input required value={f.device} onChange={set('device')} placeholder="Samsung A54" />
          </Field>
          <Field label="Accesorios que deja">
            <input value={f.accessories} onChange={set('accessories')} placeholder="Funda, chip, cargador" />
          </Field>
        </div>
        <ImeiInput value={f.imei} onChange={(v) => setF({ ...f, imei: v })} />
        <Field label="Falla que cuenta el cliente *">
          <textarea required value={f.problem} onChange={set('problem')} />
        </Field>
      </div>
      <div className="card stack">
        <h3>Estado al recibirlo</h3>
        {DEVICE_CHECKS.map((k) => (
          <div key={k} className="row between small">
            <span>{DEVICE_CHECK_LABELS[k]}</span>
            <div className="row">
              {(['ok', 'bad', 'na'] as const).map((v) => (
                <button type="button" key={v} className={`small ${checks[k] === v ? 'primary' : ''}`} onClick={() => setChecks({ ...checks, [k]: v })}>
                  {v === 'ok' ? 'Anda' : v === 'bad' ? 'Falla' : 'No se puede probar'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="card stack">
        <h3>Desbloqueo</h3>
        <div className="row">
          {(['NONE', 'PIN', 'PASSWORD', 'PATTERN'] as const).map((l) => (
            <button type="button" key={l} className={`small ${f.lockType === l ? 'primary' : ''}`} onClick={() => setF({ ...f, lockType: l, lockSecret: '' })}>
              {{ NONE: 'Sin bloqueo', PIN: 'PIN', PASSWORD: 'Contraseña', PATTERN: 'Patrón' }[l]}
            </button>
          ))}
        </div>
        {(f.lockType === 'PIN' || f.lockType === 'PASSWORD') && <input value={f.lockSecret} onChange={set('lockSecret')} placeholder="Se guarda cifrado; lo ven solo el técnico y el dueño" />}
        {f.lockType === 'PATTERN' && <PatternPad value={f.lockSecret} onChange={(v) => setF({ ...f, lockSecret: v })} />}
      </div>
      <div className="card grid2">
        <Field label="Técnico">
          <select value={f.technicianId} onChange={set('technicianId')}>
            <option value="">Sin asignar</option>
            {techs.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fecha prometida">
          <input type="date" value={f.promisedAt} onChange={set('promisedAt')} />
        </Field>
        <Field label="Moneda del presupuesto">
          <select value={f.currency} onChange={set('currency')}>
            <option value="ARS">Pesos</option>
            <option value="USD">Dólares</option>
          </select>
        </Field>
        <Field label="Costo de diagnóstico" hint="Se cobra si rechaza el presupuesto">
          <input inputMode="decimal" value={f.diagnosisFee} onChange={set('diagnosisFee')} />
        </Field>
      </div>
      <button className="primary big" disabled={busy}>
        Guardar e imprimir comprobante
      </button>
    </form>
  );
}

export function RepairDetail() {
  const { id } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const loc = useLocation();
  const q = useQuery({ queryKey: ['repair', id], queryFn: () => api<Repair>(`/repairs/${id}`) });
  const techs = useQuery({ queryKey: ['technicians'], queryFn: () => api<{ id: string; name: string }[]>('/technicians') });
  const [quote, setQuote] = useState<QuoteLine[] | null>(null);
  const printNow = !!q.data && new URLSearchParams(loc.search).get('print') === '1';
  // Recién recibido: se imprime el comprobante para el cliente.
  useEffect(() => {
    if (printNow) setTimeout(() => window.print(), 300);
  }, [printNow]);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const r = q.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['repair', id] });
    void qc.invalidateQueries({ queryKey: ['repairs'] });
  };
  const patch = async (body: Record<string, unknown>) => {
    try {
      await api(`/repairs/${r.id}`, { method: 'PATCH', body });
      refresh();
      return true;
    } catch (e) {
      toast(errMsg(e));
      return false;
    }
  };
  const closed = r.status === 'DELIVERED' || r.status === 'CANCELLED';
  const lines = quote ?? r.quote;
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const link = publicUrl(r);
  const quoteMsg = `Hola ${r.customer.name}, te pasamos el presupuesto de tu ${r.device} (orden #${r.number}): ${inCur(r.quoteTotal, r.currency)}. Podés aprobarlo o rechazarlo acá: ${link}`;
  const readyMsg = `¡Hola ${r.customer.name}! Tu ${r.device} (orden #${r.number}) ya está listo para retirar.${r.charge > 0 ? ` Total: ${inCur(r.charge, r.currency)}.` : ''} Seguimiento: ${link}`;
  return (
    <div className="stack">
      <Link to="/repairs" className="no-print">
        ← Servicio técnico
      </Link>
      <div className="card stack no-print">
        <div className="row between">
          <h1>
            #{r.number} · {r.device}
          </h1>
          <Badge status={r.status} label={REPAIR_STATUS_LABELS[r.status]} />
        </div>
        {r.warrantyOfId && <p className="badge gold">Reingreso por garantía (sin cargo)</p>}
        <p>
          <Link to={`/customers/${r.customer.id}`}>{r.customer.name}</Link> {r.customer.phone && `· ${r.customer.phone}`} · recibido {dateTimeFmt(r.createdAt)} por {r.user}
        </p>
        <p>
          <strong>Falla:</strong> {r.problem}
        </p>
        {r.imei && <p className="small">IMEI {r.imei}</p>}
        {r.accessories && <p className="small">Dejó: {r.accessories}</p>}
        {r.hasLock && (
          <p className="small">
            Desbloqueo ({{ NONE: '', PIN: 'PIN', PASSWORD: 'contraseña', PATTERN: 'patrón' }[r.lockType]}): {r.lockSecret ? <strong>{r.lockSecret}</strong> : <span className="muted">solo lo ven el técnico asignado y el dueño</span>}
          </p>
        )}
        <div className="grid2">
          <Field label="Técnico">
            <select disabled={closed} value={r.technicianId ?? ''} onChange={(e) => void patch({ technicianId: e.target.value || null })}>
              <option value="">Sin asignar</option>
              {techs.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fecha prometida">
            <input type="date" disabled={closed} defaultValue={r.promisedAt?.slice(0, 10) ?? ''} onBlur={(e) => void patch({ promisedAt: e.target.value ? new Date(`${e.target.value}T18:00:00`).toISOString() : null })} />
          </Field>
        </div>
        <Field label="Diagnóstico">
          <textarea disabled={closed} defaultValue={r.diagnosis ?? ''} onBlur={(e) => e.target.value !== (r.diagnosis ?? '') && void patch({ diagnosis: e.target.value })} />
        </Field>
      </div>

      <div className="card stack no-print">
        <div className="row between">
          <h3>Presupuesto ({r.currency === 'USD' ? 'dólares' : 'pesos'})</h3>
          {r.quoteApproved != null && <span className={`badge ${r.quoteApproved ? 'green' : 'red'}`}>{r.quoteApproved ? 'Aprobado' : 'Rechazado'} {r.quoteAnswerBy === 'cliente' ? 'por el cliente (link)' : 'en el local'}{r.quoteAnswerAt ? ` · ${dateTimeFmt(r.quoteAnswerAt)}` : ''}</span>}
        </div>
        {lines.map((l, i) => (
          <div key={i} className="row small">
            <span className="badge">{l.kind === 'PART' ? 'Repuesto' : 'Mano de obra'}</span>
            <span className="grow">{l.name}</span>
            {quote && !r.partsUsed ? (
              <>
                <input style={{ width: 60 }} inputMode="numeric" value={l.qty} onChange={(e) => setQuote(lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 1 } : x)))} />
                <input style={{ width: 110 }} inputMode="decimal" value={l.price} onChange={(e) => setQuote(lines.map((x, j) => (j === i ? { ...x, price: toNum(e.target.value) ?? 0 } : x)))} />
                <button className="small ghost" onClick={() => setQuote(lines.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </>
            ) : (
              <span>
                {l.qty} × {inCur(l.price, r.currency)}
              </span>
            )}
          </div>
        ))}
        {quote && (
          <>
            <ProductPicker placeholder="+ Repuesto del stock" filter={(p) => !p.serialized && !p.isService} onPick={(p) => setQuote([...lines, { kind: 'PART', productId: p.id, name: p.name, qty: 1, price: p.currency === r.currency ? p.price : 0 }])} />
            <button className="small" onClick={() => setQuote([...lines, { kind: 'LABOR', name: 'Mano de obra', qty: 1, price: 0 }])}>
              + Mano de obra
            </button>
          </>
        )}
        <p>
          <strong>Total: {inCur(total, r.currency)}</strong> · diagnóstico si lo rechaza: {inCur(r.diagnosisFee, r.currency)}
          {can(me, 'owner') && r.partsUsed ? ` · costo repuestos ${inCur(r.partsCost, 'ARS')}` : ''}
        </p>
        {!closed && (
          <div className="row">
            {quote ? (
              <button className="primary" onClick={() => void patch({ quote: lines }).then((ok) => ok && setQuote(null))}>
                Guardar presupuesto
              </button>
            ) : (
              <button onClick={() => setQuote(r.quote)} disabled={r.partsUsed}>
                Editar presupuesto
              </button>
            )}
            {!quote && r.quote.length > 0 && ['RECEIVED', 'DIAGNOSIS', 'QUOTE_SENT'].includes(r.status) && (
              <>
                <WaButton phone={r.customer.phone} text={quoteMsg}>
                  Enviar presupuesto
                </WaButton>
                {r.status !== 'QUOTE_SENT' && <button onClick={() => void patch({ status: 'QUOTE_SENT' })}>Marcar enviado</button>}
                <button onClick={() => void patch({ quoteApproved: true })}>Aprobó (en el local)</button>
                <button className="danger" onClick={() => void patch({ quoteApproved: false })}>
                  Rechazó
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {!closed && (
        <div className="card stack no-print">
          <h3>Cambiar estado</h3>
          <div className="row">
            {(NEXT[r.status] ?? []).map((s) => (
              <button key={s} className="primary" onClick={() => void patch({ status: s })}>
                {REPAIR_STATUS_LABELS[s]}
              </button>
            ))}
            {r.status === 'READY' && (
              <>
                <WaButton phone={r.customer.phone} text={readyMsg}>
                  Avisar que está listo
                </WaButton>
                {r.charge > 0 ? <span className="small muted">Se entrega cobrando en la caja: “Cobrar reparación”.</span> : <button onClick={() => void patch({ status: 'DELIVERED' })}>Entregar (sin cargo)</button>}
              </>
            )}
            <button
              className="danger"
              onClick={() => {
                const note = window.prompt('Motivo de la cancelación');
                if (note !== null) void patch({ status: 'CANCELLED', note });
              }}
            >
              Cancelar orden
            </button>
          </div>
          <Field label="Nota para el historial">
            <input
              placeholder="Enter para guardar (la ve el cliente en el link)"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                  const note = e.currentTarget.value;
                  e.currentTarget.value = '';
                  void patch({ note });
                }
              }}
            />
          </Field>
        </div>
      )}

      <div className="card stack no-print">
        <h3>Fotos</h3>
        <div className="grid2">
          {r.photos.map((p) => (
            <img key={p} src={p} alt="" style={{ width: '100%', borderRadius: 8 }} />
          ))}
          <PhotoButton label="Agregar foto" upload={(f) => uploadImage(`/repairs/${r.id}/photo`, f).then(refresh)} />
        </div>
      </div>

      <div className="card no-print">
        <div className="row between">
          <h3>Historial</h3>
          <div className="row">
            <button className="small" onClick={() => void navigator.clipboard?.writeText(link).then(() => toast('Link copiado'))}>
              Copiar link de seguimiento
            </button>
            <button className="small" onClick={() => window.print()}>
              🖨 Comprobante
            </button>
          </div>
        </div>
        {r.events?.map((e) => (
          <div key={e.id} className="list-item small">
            <span className="muted">{dateTimeFmt(e.createdAt)}</span>
            <span className="grow">
              {e.status ? REPAIR_STATUS_LABELS[e.status] : ''} {e.note ? `· ${e.note}` : ''} {!e.public && <span className="badge">interno</span>}
            </span>
            <span className="muted">{e.user}</span>
          </div>
        ))}
      </div>
      <RepairReceipt r={r} />
    </div>
  );
}

/** Comprobante de ingreso para el cliente (se imprime). */
function RepairReceipt({ r }: { r: Repair }) {
  const me = useMe();
  return (
    <div className="print-area print-only ticket" style={{ width: '80mm' }}>
      <div style={{ textAlign: 'center', fontWeight: 700 }}>{me.store.name}</div>
      <div style={{ textAlign: 'center' }}>Orden de servicio técnico #{r.number}</div>
      <div>{new Date(r.createdAt).toLocaleString('es-AR')}</div>
      <hr />
      <div>Cliente: {r.customer.name}</div>
      {r.customer.phone && <div>Tel.: {r.customer.phone}</div>}
      <div>Equipo: {r.device}</div>
      {r.imei && <div>IMEI: {r.imei}</div>}
      <div>Falla: {r.problem}</div>
      {r.accessories && <div>Deja: {r.accessories}</div>}
      {r.diagnosisFee > 0 && <div>Diagnóstico: {inCur(r.diagnosisFee, r.currency)} (si no se aprueba el presupuesto)</div>}
      {r.promisedAt && <div>Fecha estimada: {dayFmt(r.promisedAt)}</div>}
      <hr />
      <div style={{ fontSize: 10 }}>
        Seguí tu reparación y aprobá el presupuesto en: {publicUrl(r)}
        <br />
        La reparación tiene {r.warrantyDays} días de garantía sobre el trabajo realizado. No nos responsabilizamos por datos no respaldados.
      </div>
      <br />
      <div>Firma del cliente: ______________________</div>
    </div>
  );
}

interface PublicRepair {
  store: string;
  number: number;
  device: string;
  problem: string;
  status: RepairStatus;
  statusLabel: string;
  diagnosis: string | null;
  quote: { name: string; qty: number; price: number }[];
  quoteTotal: number;
  diagnosisFee: number;
  currency: string;
  promisedAt: string | null;
  quoteApproved: boolean | null;
  canAnswer: boolean;
  warrantyDays: number;
  events: { status: RepairStatus | null; label: string | null; note: string | null; at: string }[];
}

/** Página pública (sin login) para que el cliente siga su reparación y apruebe el presupuesto. */
export function PublicRepair() {
  const { token } = useParams();
  const q = useQuery({ queryKey: ['public-repair', token], queryFn: () => api<PublicRepair>(`/public/repairs/${token}`), refetchInterval: 60_000 });
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <div className="main"><Loading /></div>;
  if (!q.data) return <div className="main"><p className="error">No encontramos esta orden.</p></div>;
  const r = q.data;
  const answer = async (approve: boolean) => {
    if (!window.confirm(approve ? '¿Aprobás el presupuesto?' : '¿Rechazás el presupuesto?')) return;
    setBusy(true);
    try {
      await api(`/public/repairs/${token}/answer`, { body: { approve } });
      await q.refetch();
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="main stack" style={{ maxWidth: 560 }}>
      <h1>{r.store}</h1>
      <div className="card stack">
        <div className="row between">
          <h2>
            {r.device} · orden #{r.number}
          </h2>
          <Badge status={r.status} label={r.statusLabel} />
        </div>
        <p className="small">Falla: {r.problem}</p>
        {r.diagnosis && <p>Diagnóstico: {r.diagnosis}</p>}
        {r.promisedAt && <p className="small">Fecha estimada: {dayFmt(r.promisedAt)}</p>}
      </div>
      {r.quote.length > 0 && (
        <div className="card stack">
          <h3>Presupuesto</h3>
          {r.quote.map((l, i) => (
            <div key={i} className="row between">
              <span>
                {l.qty > 1 ? `${l.qty} × ` : ''}
                {l.name}
              </span>
              <span>{inCur(l.qty * l.price, r.currency)}</span>
            </div>
          ))}
          <div className="row between">
            <strong>Total</strong>
            <strong>{inCur(r.quoteTotal, r.currency)}</strong>
          </div>
          <p className="small muted">Garantía de {r.warrantyDays} días sobre el trabajo. {r.diagnosisFee > 0 ? `Si no lo aprobás, se cobra el diagnóstico: ${inCur(r.diagnosisFee, r.currency)}.` : ''}</p>
          {r.canAnswer ? (
            <div className="row">
              <button className="primary big grow" disabled={busy} onClick={() => void answer(true)}>
                ✓ Aprobar
              </button>
              <button className="big danger" disabled={busy} onClick={() => void answer(false)}>
                Rechazar
              </button>
            </div>
          ) : (
            r.quoteApproved != null && <p className={r.quoteApproved ? 'ok' : 'error'}>{r.quoteApproved ? 'Presupuesto aprobado ✓' : 'Presupuesto rechazado'}</p>
          )}
        </div>
      )}
      <div className="card">
        <h3>Seguimiento</h3>
        {r.events.map((e, i) => (
          <div key={i} className="list-item small">
            <span className="muted">{dateTimeFmt(e.at)}</span>
            <span className="grow">
              {e.label} {e.note ? `· ${e.note}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

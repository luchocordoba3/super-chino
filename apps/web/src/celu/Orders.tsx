// Pedidos de WhatsApp / Instagram y entregas: alta, reserva de equipos, cadete, prueba de entrega y rendición.
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDER_CHANNEL_LABELS, ORDER_CHANNELS, ORDER_STATUS_LABELS, type OrderChannel, type OrderStatus } from '@super-chino/shared';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Field, Loading, Modal, Tabs, toast, toNum } from '../components/ui';
import { dateTimeFmt, dayFmt, money } from '../lib/format';
import { can, useMe } from '../lib/me';
import { Badge, type Customer, CustomerPicker, inCur, PhotoButton, ProductPicker, type ProductLite, toArs, usd, useFx, WaButton } from './common';
import type { SerialRow } from './Serials';

interface OrderItem {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  currency: string;
  serialized: boolean;
  serialItemId: string | null;
  imei: string | null;
}
interface DeliveryRow {
  id: string;
  status: 'ASSIGNED' | 'ON_THE_WAY' | 'DELIVERED' | 'FAILED';
  courier: string | null;
  courierId: string | null;
  collectAmount: number;
  collectCurrency: string;
  collected: number | null;
  fee: number;
  proofPhoto: string | null;
  receiverName: string | null;
  receiverDni: string | null;
  imeiConfirmed: boolean;
  failReason: string | null;
  doneAt: string | null;
  settledAt: string | null;
  createdAt: string;
}
interface Order {
  id: string;
  number: number;
  channel: OrderChannel;
  status: OrderStatus;
  customer: Customer;
  items: OrderItem[];
  total: number;
  rate: number | null;
  deliveryFee: number;
  paymentMode: 'PAID' | 'COD';
  codCurrency: 'ARS' | 'USD';
  paidMethod: string | null;
  delivery: boolean;
  address: string | null;
  addressNotes: string | null;
  window: string | null;
  scheduledFor: string | null;
  notes: string | null;
  saleId: string | null;
  withdrawalUntil: string | null;
  createdAt: string;
  user: string | null;
  lastDelivery: DeliveryRow | null;
  deliveries?: DeliveryRow[];
  deposits?: { id: string; amount: number; currency: string; fx: number | null; status: string }[];
}
const mapsLink = (addr: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
const DELIVERY_LABELS = { ASSIGNED: 'Asignada', ON_THE_WAY: 'En camino', DELIVERED: 'Entregada', FAILED: 'No se entregó' } as const;

export function Orders() {
  const [tab, setTab] = useState<'open' | 'DELIVERED' | 'CANCELLED'>('open');
  const list = useQuery({ queryKey: ['orders', tab], queryFn: () => api<Order[]>(`/orders?${tab === 'open' ? 'open=true' : `status=${tab}`}`) });
  return (
    <div className="stack">
      <div className="row between">
        <h1>Pedidos</h1>
        <div className="row">
          <Link className="btn" to="/deliveries">
            🛵 Entregas
          </Link>
          <Link className="btn btn-primary" to="/orders/new">
            + Pedido
          </Link>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'open', label: 'En curso' },
          { id: 'DELIVERED', label: 'Entregados' },
          { id: 'CANCELLED', label: 'Cancelados' },
        ]}
      />
      {list.isLoading && <Loading />}
      <ErrorBox error={list.error} />
      {list.data?.length === 0 && <Empty />}
      {list.data?.map((o) => (
        <Link key={o.id} to={`/orders/${o.id}`} className="card row between" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="grow">
            <strong>
              #{o.number} · {o.customer.name}
            </strong>
            <div className="small muted">
              {ORDER_CHANNEL_LABELS[o.channel]} · {o.items.map((i) => i.name).join(', ')}
              {o.scheduledFor ? ` · ${dayFmt(o.scheduledFor)}` : ''} {o.window ?? ''}
              {o.lastDelivery?.courier ? ` · 🛵 ${o.lastDelivery.courier}` : ''}
            </div>
          </div>
          <span>{money(o.total + o.deliveryFee)}</span>
          <Badge status={o.status} label={ORDER_STATUS_LABELS[o.status]} />
        </Link>
      ))}
    </div>
  );
}

/** Pedido nuevo: cliente, productos (con el IMEI que se reserva) y cómo se entrega y se cobra. */
export function NewOrder() {
  const nav = useNavigate();
  const fx = useFx();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<(OrderItem & { choices?: SerialRow[] })[]>([]);
  const [f, setF] = useState({
    channel: 'WHATSAPP' as OrderChannel,
    delivery: true,
    address: '',
    addressNotes: '',
    window: '',
    scheduledFor: '',
    deliveryFee: '',
    paymentMode: 'COD' as 'PAID' | 'COD',
    codCurrency: 'ARS' as 'ARS' | 'USD',
    paidMethod: 'TRANSFER',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const rate = fx.data?.rate;
  const add = async (p: ProductLite) => {
    const choices = p.serialized ? await api<SerialRow[]>(`/serials?status=AVAILABLE&productId=${p.id}`) : undefined;
    setItems([...items, { productId: p.id, name: p.name, qty: 1, unitPrice: p.price, currency: p.currency, serialized: p.serialized, serialItemId: null, imei: null, choices }]);
  };
  const total = items.reduce((s, i) => s + i.qty * toArs(i.unitPrice, i.currency, rate), 0) + (toNum(f.deliveryFee) ?? 0);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customer) return toast('Elegí el cliente');
    if (items.length === 0) return toast('Agregá al menos un producto');
    setBusy(true);
    try {
      const o = await api<Order>('/orders', {
        body: {
          channel: f.channel,
          customerId: customer.id,
          items: items.map((i) => ({ productId: i.productId, qty: i.qty, unitPrice: i.unitPrice, serialItemId: i.serialItemId })),
          deliveryFee: toNum(f.deliveryFee) ?? 0,
          paymentMode: f.paymentMode,
          codCurrency: f.codCurrency,
          paidMethod: f.paymentMode === 'PAID' ? f.paidMethod : null,
          delivery: f.delivery,
          address: f.address || null,
          addressNotes: f.addressNotes || null,
          window: f.window || null,
          scheduledFor: f.scheduledFor || null,
          notes: f.notes || null,
        },
      });
      nav(`/orders/${o.id}`, { replace: true });
    } catch (err) {
      toast(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <Link to="/orders">← Pedidos</Link>
      <h1>Pedido nuevo</h1>
      <div className="card stack">
        <div className="row">
          {ORDER_CHANNELS.map((c) => (
            <button type="button" key={c} className={`small ${f.channel === c ? 'primary' : ''}`} onClick={() => setF({ ...f, channel: c })}>
              {ORDER_CHANNEL_LABELS[c]}
            </button>
          ))}
        </div>
        <CustomerPicker value={customer} onChange={setCustomer} required />
      </div>
      <div className="card stack">
        <h3>Productos</h3>
        {items.map((it, i) => (
          <div key={i} className="stack" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
            <div className="row between">
              <strong>{it.name}</strong>
              <div className="row">
                {!it.serialized && <input style={{ width: 60 }} inputMode="numeric" value={it.qty} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 1 } : x)))} />}
                <input style={{ width: 100 }} inputMode="decimal" value={it.unitPrice} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, unitPrice: toNum(e.target.value) ?? 0 } : x)))} />
                <span className="small">{it.currency === 'USD' ? 'US$' : '$'}</span>
                <button type="button" className="small ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            </div>
            {it.serialized && (
              <select value={it.serialItemId ?? ''} onChange={(e) => {
                const s = it.choices?.find((c) => c.id === e.target.value);
                setItems(items.map((x, j) => (j === i ? { ...x, serialItemId: s?.id ?? null, imei: s?.imei1 ?? null, unitPrice: s ? s.price : x.unitPrice } : x)));
              }}>
                <option value="">Elegir el equipo (IMEI) — se reserva</option>
                {it.choices?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.imei1} · {c.condition === 'NEW' ? 'Nuevo' : `Usado ${c.grade ?? ''} ${c.battery ?? ''}%`} {c.color ?? ''} · {inCur(c.price, c.currency)}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
        <ProductPicker placeholder="+ Agregar producto" onPick={(p) => void add(p)} filter={(p) => !p.isService} />
      </div>
      <div className="card stack">
        <label className="check">
          <input type="checkbox" checked={f.delivery} onChange={(e) => setF({ ...f, delivery: e.target.checked })} /> Envío a domicilio (si no, retira en el local)
        </label>
        {f.delivery && (
          <div className="grid2">
            <Field label="Dirección">
              <input value={f.address} onChange={set('address')} placeholder="Calle 123, Localidad" />
            </Field>
            <Field label="Piso / referencias">
              <input value={f.addressNotes} onChange={set('addressNotes')} />
            </Field>
            <Field label="Día">
              <input type="date" value={f.scheduledFor} onChange={set('scheduledFor')} />
            </Field>
            <Field label="Franja horaria">
              <input value={f.window} onChange={set('window')} placeholder="14 a 18 hs" />
            </Field>
            <Field label="Costo de envío ($)">
              <input inputMode="decimal" value={f.deliveryFee} onChange={set('deliveryFee')} />
            </Field>
          </div>
        )}
        <div className="grid2">
          <Field label="Pago">
            <select value={f.paymentMode} onChange={set('paymentMode')}>
              <option value="COD">Paga al recibir</option>
              <option value="PAID">Ya pagó</option>
            </select>
          </Field>
          {f.paymentMode === 'COD' ? (
            <Field label="Paga en">
              <select value={f.codCurrency} onChange={set('codCurrency')}>
                <option value="ARS">Pesos</option>
                <option value="USD">Dólares</option>
              </select>
            </Field>
          ) : (
            <Field label="Cómo pagó">
              <select value={f.paidMethod} onChange={set('paidMethod')}>
                <option value="TRANSFER">Transferencia</option>
                <option value="QR">QR / Mercado Pago</option>
                <option value="CASH">Efectivo</option>
                <option value="CREDIT">Tarjeta</option>
              </select>
            </Field>
          )}
        </div>
        <Field label="Notas">
          <textarea value={f.notes} onChange={set('notes')} />
        </Field>
        <p>
          <strong>Total: {money(total)}</strong> {rate ? <span className="muted">({usd(total / rate)} a {money(rate)})</span> : null}
        </p>
      </div>
      <button className="primary big" disabled={busy}>
        Guardar pedido
      </button>
    </form>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api<Order>(`/orders/${id}`) });
  const couriers = useQuery({ queryKey: ['couriers'], queryFn: () => api<{ id: string; name: string }[]>('/couriers') });
  const [assign, setAssign] = useState(false);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const o = q.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['order', id] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  };
  const call = async (path: string, body: unknown = {}, method = 'POST') => {
    try {
      await api(path, { method, body });
      refresh();
    } catch (e) {
      toast(errMsg(e));
    }
  };
  const open = !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(o.status);
  const grand = o.total + o.deliveryFee;
  const deposited = (o.deposits ?? []).filter((d) => d.status === 'ACTIVE').reduce((s, d) => s + d.amount, 0);
  const summary = `${o.items.map((i) => `${i.qty > 1 ? `${i.qty} × ` : ''}${i.name}`).join(', ')}. Total ${money(grand)}`;
  return (
    <div className="stack">
      <Link to="/orders">← Pedidos</Link>
      <div className="card stack">
        <div className="row between">
          <h1>
            Pedido #{o.number} · {o.customer.name}
          </h1>
          <Badge status={o.status} label={ORDER_STATUS_LABELS[o.status]} />
        </div>
        <p className="small muted">
          {ORDER_CHANNEL_LABELS[o.channel]} · tomado por {o.user} el {dateTimeFmt(o.createdAt)}
          {o.rate ? ` · dólar a ${money(o.rate)}` : ''}
        </p>
        {o.items.map((i, n) => (
          <div key={n} className="row between small">
            <span>
              {i.qty > 1 ? `${i.qty} × ` : ''}
              {i.name} {i.imei ? <span className="muted">IMEI {i.imei}</span> : i.serialized ? <span className="warn">(falta elegir el IMEI)</span> : null}
            </span>
            <span>{inCur(i.unitPrice * i.qty, i.currency)}</span>
          </div>
        ))}
        {o.deliveryFee > 0 && (
          <div className="row between small">
            <span>Envío</span>
            <span>{money(o.deliveryFee)}</span>
          </div>
        )}
        <div className="row between">
          <strong>Total</strong>
          <strong>{money(grand)}</strong>
        </div>
        {deposited > 0 && <p className="small">Seña: {money(deposited)} · resta {money(grand - deposited)}</p>}
        <p className="small">{o.paymentMode === 'PAID' ? `Pagado (${o.paidMethod ?? ''})` : `Paga al recibir en ${o.codCurrency === 'USD' ? 'dólares' : 'pesos'}`}</p>
        {o.delivery ? (
          <p>
            📍 {o.address} {o.addressNotes ? `(${o.addressNotes})` : ''} {o.address && <a href={mapsLink(o.address)} target="_blank" rel="noreferrer">mapa</a>}
            {o.scheduledFor ? ` · ${dayFmt(o.scheduledFor)}` : ''} {o.window ?? ''}
          </p>
        ) : (
          <p>Retira en el local.</p>
        )}
        {o.notes && <p className="small">{o.notes}</p>}
        {o.withdrawalUntil && o.status === 'DELIVERED' && <p className="small muted">Puede arrepentirse hasta el {dayFmt(o.withdrawalUntil)} (10 días, Ley 24.240).</p>}
        <div className="row">
          <WaButton phone={o.customer.phone} text={`¡Hola ${o.customer.name}! Confirmamos tu pedido #${o.number}: ${summary}.${o.delivery && o.address ? ` Envío a ${o.address}${o.window ? ` (${o.window})` : ''}.` : ''}`}>
            Confirmar al cliente
          </WaButton>
          {o.status === 'ON_THE_WAY' && (
            <WaButton phone={o.customer.phone} text={`¡Hola ${o.customer.name}! Tu pedido #${o.number} está en camino 🛵`}>
              Avisar “en camino”
            </WaButton>
          )}
        </div>
      </div>

      {open && can(me, 'orders') && (
        <div className="card stack">
          <h3>Acciones</h3>
          <div className="row">
            {o.status === 'INQUIRY' && <button onClick={() => void call(`/orders/${o.id}`, { status: 'RESERVED' }, 'PATCH')}>Confirmar / reservar</button>}
            {o.paymentMode === 'COD' && <button onClick={() => void call(`/orders/${o.id}`, { status: 'PAID', paymentMode: 'PAID', paidMethod: 'TRANSFER' }, 'PATCH')}>Ya pagó (transferencia)</button>}
            {['INQUIRY', 'RESERVED', 'PAID'].includes(o.status) && <button onClick={() => void call(`/orders/${o.id}`, { status: 'PREPARING' }, 'PATCH')}>Preparando</button>}
            {o.delivery && <button className="primary" onClick={() => setAssign(true)}>🛵 Asignar cadete</button>}
            {!o.delivery && o.paymentMode === 'PAID' && <button className="primary" onClick={() => void call(`/orders/${o.id}/pickup`)}>Entregado en el local</button>}
            {!o.delivery && o.paymentMode === 'COD' && <span className="small muted">Retira y paga en el local: cobralo en la caja.</span>}
            <button onClick={() => void call(`/orders/${o.id}`, { refreshRate: true }, 'PATCH')}>Actualizar al dólar de hoy</button>
            <button
              className="danger"
              onClick={() => {
                if (window.confirm('¿Cancelar el pedido? Los equipos reservados vuelven a estar disponibles.')) void call(`/orders/${o.id}`, { status: 'CANCELLED' }, 'PATCH');
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {o.status === 'DELIVERED' && can(me, 'owner') && o.withdrawalUntil && new Date(o.withdrawalUntil) > new Date() && (
        <button
          className="danger"
          onClick={() => {
            const reason = window.prompt('Motivo de la devolución');
            if (reason !== null) void call(`/orders/${o.id}/return`, { reason });
          }}
        >
          Devolución por arrepentimiento
        </button>
      )}

      {(o.deliveries ?? []).length > 0 && (
        <div className="card">
          <h3>Entregas</h3>
          {o.deliveries!.map((d) => (
            <div key={d.id} className="list-item small">
              <span className="grow">
                🛵 {d.courier} · {DELIVERY_LABELS[d.status]}
                {d.failReason ? ` · ${d.failReason}` : ''}
                {d.receiverName ? ` · recibió ${d.receiverName}${d.receiverDni ? ` (DNI ${d.receiverDni})` : ''}` : ''}
                {d.imeiConfirmed ? ' · IMEI confirmado' : ''}
                {d.collected != null ? ` · cobró ${inCur(d.collected, d.collectCurrency)}` : ''}
                {d.settledAt ? ' · rendido ✓' : ''}
              </span>
              {d.proofPhoto && (
                <a href={d.proofPhoto} target="_blank" rel="noreferrer">
                  foto
                </a>
              )}
            </div>
          ))}
        </div>
      )}
      {assign && (
        <AssignModal
          couriers={couriers.data ?? []}
          onClose={() => setAssign(false)}
          onSave={(b) => void call(`/orders/${o.id}/assign`, b).then(() => setAssign(false))}
        />
      )}
    </div>
  );
}

function AssignModal({ couriers, onClose, onSave }: { couriers: { id: string; name: string }[]; onClose: () => void; onSave: (b: Record<string, unknown>) => void }) {
  const [courierId, setCourierId] = useState(couriers[0]?.id ?? '');
  const [name, setName] = useState('');
  const [fee, setFee] = useState('');
  return (
    <Modal title="Asignar cadete" onClose={onClose}>
      <div className="stack">
        <Field label="Cadete del equipo">
          <select value={courierId} onChange={(e) => setCourierId(e.target.value)}>
            <option value="">Otro (de afuera)</option>
            {couriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        {!courierId && (
          <Field label="Nombre del cadete / moto">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label="Se le paga por el envío ($)">
          <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
        <button className="primary" onClick={() => onSave({ courierId: courierId || null, courierName: courierId ? null : name, fee: toNum(fee) ?? 0 })}>
          Asignar
        </button>
      </div>
    </Modal>
  );
}

interface MyDelivery extends DeliveryRow {
  order: { id: string; number: number; address: string | null; addressNotes: string | null; window: string | null; items: OrderItem[]; notes: string | null; customer: Customer };
}

/** Pantalla del cadete (pensada para el celular): sus entregas, mapa, avisos y lo que tiene que rendir. */
export function Deliveries() {
  const me = useMe();
  const qc = useQueryClient();
  const mineOnly = !can(me, 'orders');
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ['deliveries', all], queryFn: () => api<MyDelivery[]>(`/deliveries${all || !mineOnly ? '' : '?mine=true'}`) });
  const [done, setDone] = useState<MyDelivery | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['deliveries'] });
  const act = async (path: string, body: unknown = {}) => {
    try {
      await api(path, { body });
      refresh();
    } catch (e) {
      toast(errMsg(e));
    }
  };
  const rows = q.data ?? [];
  const active = rows.filter((d) => d.status === 'ASSIGNED' || d.status === 'ON_THE_WAY');
  const pending = rows.filter((d) => d.status === 'DELIVERED' && !d.settledAt);
  const pendArs = pending.filter((d) => d.collectCurrency !== 'USD').reduce((s, d) => s + (d.collected ?? 0), 0);
  const pendUsd = pending.filter((d) => d.collectCurrency === 'USD').reduce((s, d) => s + (d.collected ?? 0), 0);
  return (
    <div className="stack">
      <div className="row between">
        <h1>Entregas</h1>
        {!mineOnly && (
          <label className="check small">
            <input type="checkbox" checked={!all} onChange={(e) => setAll(!e.target.checked)} /> Solo las mías
          </label>
        )}
      </div>
      {(pendArs > 0 || pendUsd > 0) && (
        <div className="card">
          Para rendir en la caja: <strong>{money(pendArs)}</strong>
          {pendUsd > 0 && (
            <>
              {' '}
              y <strong>{usd(pendUsd)}</strong>
            </>
          )}
        </div>
      )}
      {q.isLoading && <Loading />}
      {active.length === 0 && <Empty text="No tenés entregas pendientes" />}
      {active.map((d) => (
        <div key={d.id} className="card stack">
          <div className="row between">
            <strong>
              #{d.order.number} · {d.order.customer.name}
            </strong>
            <span className="badge gold">{DELIVERY_LABELS[d.status]}</span>
          </div>
          <div>
            📍 {d.order.address} {d.order.addressNotes ? `(${d.order.addressNotes})` : ''} {d.order.window ? `· ${d.order.window}` : ''}
          </div>
          <div className="small">{d.order.items.map((i) => `${i.name}${i.imei ? ` (IMEI …${i.imei.slice(-5)})` : ''}`).join(', ')}</div>
          {d.order.notes && <div className="small muted">{d.order.notes}</div>}
          <div>
            {d.collectAmount > 0 ? (
              <>
                Cobrar: <strong>{inCur(d.collectAmount, d.collectCurrency)}</strong>
              </>
            ) : (
              <span className="ok">Ya está pagado</span>
            )}
            {!mineOnly && d.courier ? ` · ${d.courier}` : ''}
          </div>
          <div className="row">
            {d.order.address && (
              <a className="btn" href={mapsLink(d.order.address)} target="_blank" rel="noreferrer">
                🗺 Mapa
              </a>
            )}
            {d.order.customer.phone && (
              <a className="btn" href={`tel:${d.order.customer.phone}`}>
                📞 Llamar
              </a>
            )}
            <WaButton phone={d.order.customer.phone} text={`¡Hola ${d.order.customer.name}! Soy el cadete, estoy llevando tu pedido #${d.order.number}.`}>
              Avisar
            </WaButton>
          </div>
          <div className="row">
            {d.status === 'ASSIGNED' && <button onClick={() => void act(`/deliveries/${d.id}/start`)}>▶ Salgo</button>}
            <button className="primary" onClick={() => setDone(d)}>
              ✓ Entregado
            </button>
            <button
              className="danger"
              onClick={() => {
                const reason = window.prompt('¿Por qué no se pudo entregar?');
                if (reason) void act(`/deliveries/${d.id}/fail`, { reason });
              }}
            >
              No se pudo
            </button>
          </div>
        </div>
      ))}
      {rows.filter((d) => d.status === 'DELIVERED' || d.status === 'FAILED').length > 0 && (
        <div className="card">
          <h3>Últimas</h3>
          {rows
            .filter((d) => d.status === 'DELIVERED' || d.status === 'FAILED')
            .map((d) => (
              <div key={d.id} className="list-item small">
                <span className="grow">
                  #{d.order.number} · {d.order.customer.name} · {DELIVERY_LABELS[d.status]}
                </span>
                {d.collected != null && <span>{inCur(d.collected, d.collectCurrency)}</span>}
                {d.settledAt ? <span className="badge green">Rendido</span> : d.status === 'DELIVERED' && d.collected ? <span className="badge gold">A rendir</span> : null}
              </div>
            ))}
        </div>
      )}
      {done && <DoneModal d={done} onClose={() => (setDone(null), refresh())} />}
    </div>
  );
}

function DoneModal({ d, onClose }: { d: MyDelivery; onClose: () => void }) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [f, setF] = useState({ receiverName: d.order.customer.name, receiverDni: '', imeiConfirmed: false, collected: String(d.collectAmount || '') });
  const hasImei = d.order.items.some((i) => i.imei);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (hasImei && !f.imeiConfirmed) return toast('Confirmá con el cliente el IMEI del equipo');
    setBusy(true);
    try {
      const form = new FormData();
      form.append('receiverName', f.receiverName);
      form.append('receiverDni', f.receiverDni);
      form.append('imeiConfirmed', String(f.imeiConfirmed));
      if (d.collectAmount > 0) form.append('collected', f.collected || '0');
      if (photo) form.append('photo', photo, 'entrega.jpg');
      if (photo) await api(`/deliveries/${d.id}/done`, { method: 'POST', form });
      else await api(`/deliveries/${d.id}/done`, { body: { receiverName: f.receiverName, receiverDni: f.receiverDni, imeiConfirmed: f.imeiConfirmed, collected: d.collectAmount > 0 ? toNum(f.collected) : null } });
      toast('¡Entregado!');
      onClose();
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Entrega #${d.order.number}`} onClose={onClose}>
      <div className="stack">
        <Field label="Recibió">
          <input value={f.receiverName} onChange={(e) => setF({ ...f, receiverName: e.target.value })} />
        </Field>
        <Field label="DNI de quien recibe">
          <input inputMode="numeric" value={f.receiverDni} onChange={(e) => setF({ ...f, receiverDni: e.target.value })} />
        </Field>
        {hasImei && (
          <label className="check">
            <input type="checkbox" checked={f.imeiConfirmed} onChange={(e) => setF({ ...f, imeiConfirmed: e.target.checked })} /> El cliente vio que el IMEI es {d.order.items.filter((i) => i.imei).map((i) => i.imei).join(', ')}
          </label>
        )}
        {d.collectAmount > 0 && (
          <Field label={`Cobré (${d.collectCurrency === 'USD' ? 'US$' : '$'})`} hint={`Tenía que cobrar ${inCur(d.collectAmount, d.collectCurrency)}`}>
            <input inputMode="decimal" value={f.collected} onChange={(e) => setF({ ...f, collected: e.target.value })} />
          </Field>
        )}
        <PhotoButton label={photo ? 'Foto lista' : 'Foto de la entrega (opcional)'} upload={async (file) => setPhoto(file)} />
        <button className="primary big" disabled={busy} onClick={() => void save()}>
          Confirmar entrega
        </button>
      </div>
    </Modal>
  );
}

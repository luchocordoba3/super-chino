// Clientes: lista, alta y ficha con compras, equipos, garantías, tomas, reparaciones, pedidos y señas.
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDER_STATUS_LABELS, type OrderStatus, REPAIR_STATUS_LABELS, type RepairStatus } from '@super-chino/shared';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Field, Loading, Modal, toast } from '../components/ui';
import { dayFmt, money } from '../lib/format';
import { Badge, type Customer, inCur, usd, WaButton } from './common';
import { conditionText, type SerialRow } from './Serials';

export function Customers() {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ['customers', 'list', q], queryFn: () => api<Customer[]>(`/customers?q=${encodeURIComponent(q)}`) });
  return (
    <div className="stack">
      <div className="row between">
        <h1>Clientes</h1>
        <button className="primary" onClick={() => setAdding(true)}>
          + Cliente
        </button>
      </div>
      <input placeholder="Buscar por nombre, DNI o teléfono" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.isLoading && <Loading />}
      {list.data?.length === 0 && <Empty />}
      <div className="card">
        {list.data?.map((c) => (
          <div key={c.id} className="list-item">
            <Link to={`/customers/${c.id}`} className="grow">
              <strong>{c.name}</strong>
            </Link>
            <span className="small muted">{[c.dni && `DNI ${c.dni}`, c.phone].filter(Boolean).join(' · ')}</span>
          </div>
        ))}
      </div>
      {adding && <CustomerForm onClose={() => setAdding(false)} />}
    </div>
  );
}

function CustomerForm({ c, onClose }: { c?: Customer; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: c?.name ?? '', dni: c?.dni ?? '', phone: c?.phone ?? '', email: c?.email ?? '', address: c?.address ?? '', notes: c?.notes ?? '' });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const body = { name: f.name, dni: f.dni || null, phone: f.phone || null, email: f.email || null, address: f.address || null, notes: f.notes || null };
      if (c) await api(`/customers/${c.id}`, { method: 'PATCH', body });
      else await api('/customers', { body });
      void qc.invalidateQueries({ queryKey: ['customers'] });
      void qc.invalidateQueries({ queryKey: ['customer'] });
      onClose();
    } catch (err) {
      toast(errMsg(err));
    }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={c ? 'Editar cliente' : 'Cliente nuevo'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)}>
        <Field label="Nombre y apellido">
          <input autoFocus required value={f.name} onChange={set('name')} />
        </Field>
        <div className="grid2">
          <Field label="DNI / CUIT">
            <input inputMode="numeric" value={f.dni} onChange={set('dni')} />
          </Field>
          <Field label="WhatsApp" hint="Con código de área, sin 0 ni 15">
            <input inputMode="tel" value={f.phone} onChange={set('phone')} />
          </Field>
          <Field label="Email">
            <input type="email" value={f.email} onChange={set('email')} />
          </Field>
          <Field label="Domicilio">
            <input value={f.address} onChange={set('address')} />
          </Field>
        </div>
        <Field label="Notas">
          <textarea value={f.notes} onChange={set('notes')} />
        </Field>
        <button className="primary">Guardar</button>
      </form>
    </Modal>
  );
}

interface CustomerDetailData extends Customer {
  totalSpent: number;
  sales: { id: string; occurredAt: string; status: string; total: number; rate: number | null; user: string | null; items: { name: string; qty: number; lineTotal: number; warrantyUntil: string | null }[] }[];
  items: (SerialRow & { underWarranty: boolean })[];
  tradeIns: { id: string; number: number; model: string; imei1: string; status: string; offeredUsd: number; createdAt: string }[];
  repairs: { id: string; number: number; device: string; status: RepairStatus; quoteTotal: number; currency: string; createdAt: string }[];
  orders: { id: string; number: number; status: OrderStatus; total: number; channel: string; createdAt: string }[];
  deposits: { id: string; amount: number; currency: string; fx: number | null; status: string; createdAt: string }[];
}

export function CustomerDetail() {
  const { id } = useParams();
  const [edit, setEdit] = useState(false);
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api<CustomerDetailData>(`/customers/${id}`) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const c = q.data;
  return (
    <div className="stack">
      <Link to="/customers">← Clientes</Link>
      <div className="card stack">
        <div className="row between">
          <h1>{c.name}</h1>
          <div className="row">
            {c.phone && <WaButton phone={c.phone} text={`¡Hola ${c.name}! `} />}
            <button onClick={() => setEdit(true)}>Editar</button>
          </div>
        </div>
        <div className="small muted">{[c.dni && `DNI ${c.dni}`, c.phone && `Tel. ${c.phone}`, c.email, c.address].filter(Boolean).join(' · ')}</div>
        {c.notes && <p className="small">{c.notes}</p>}
        <p>
          Compró en total <strong>{money(c.totalSpent)}</strong> en {c.sales.filter((s) => s.status === 'COMPLETED').length} compras.
        </p>
      </div>

      <div className="card">
        <h3>Equipos</h3>
        {c.items.length === 0 && <Empty />}
        {c.items.map((s) => (
          <div key={s.id} className="list-item">
            <Link to={`/serials/${s.id}`} className="grow">
              {s.product} <span className="muted small">{s.imei1}</span>
            </Link>
            <span className="small">{conditionText(s)}</span>
            {s.warrantyUntil && <span className={`badge ${s.underWarranty ? 'green' : 'gray'}`}>{s.underWarranty ? `Garantía hasta ${dayFmt(s.warrantyUntil)}` : 'Garantía vencida'}</span>}
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Compras</h3>
        {c.sales.length === 0 && <Empty />}
        {c.sales.map((s) => (
          <div key={s.id} className="list-item small">
            <span className="muted">{dayFmt(s.occurredAt)}</span>
            <span className="grow" style={{ textDecoration: s.status === 'VOIDED' ? 'line-through' : undefined }}>
              {s.items.map((i) => i.name).join(', ')}
            </span>
            <strong>{money(s.total)}</strong>
            {s.rate ? <span className="muted">{usd(s.total / s.rate)}</span> : null}
          </div>
        ))}
      </div>

      {c.repairs.length > 0 && (
        <div className="card">
          <h3>Reparaciones</h3>
          {c.repairs.map((r) => (
            <div key={r.id} className="list-item small">
              <Link to={`/repairs/${r.id}`} className="grow">
                #{r.number} · {r.device}
              </Link>
              <Badge status={r.status} label={REPAIR_STATUS_LABELS[r.status]} />
              <span>{inCur(r.quoteTotal, r.currency)}</span>
            </div>
          ))}
        </div>
      )}
      {c.tradeIns.length > 0 && (
        <div className="card">
          <h3>Usados que nos vendió / entregó</h3>
          {c.tradeIns.map((t) => (
            <div key={t.id} className="list-item small">
              <Link to={`/tradeins/${t.id}`} className="grow">
                #{t.number} · {t.model} ({t.imei1})
              </Link>
              <span>{usd(t.offeredUsd)}</span>
            </div>
          ))}
        </div>
      )}
      {c.orders.length > 0 && (
        <div className="card">
          <h3>Pedidos</h3>
          {c.orders.map((o) => (
            <div key={o.id} className="list-item small">
              <Link to={`/orders/${o.id}`} className="grow">
                #{o.number} · {dayFmt(o.createdAt)}
              </Link>
              <Badge status={o.status} label={ORDER_STATUS_LABELS[o.status]} />
              <span>{money(o.total)}</span>
            </div>
          ))}
        </div>
      )}
      {c.deposits.length > 0 && (
        <div className="card">
          <h3>Señas</h3>
          {c.deposits.map((d) => (
            <div key={d.id} className="list-item small">
              <span className="grow">{dayFmt(d.createdAt)}</span>
              <span>{d.currency === 'USD' ? usd(d.fx) : money(d.amount)}</span>
              <span className="badge">{d.status}</span>
            </div>
          ))}
        </div>
      )}
      {edit && <CustomerForm c={c} onClose={() => setEdit(false)} />}
    </div>
  );
}

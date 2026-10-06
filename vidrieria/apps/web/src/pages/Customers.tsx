import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CUSTOMER_TYPES, CUSTOMER_TYPE_LABEL, type CustomerType } from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Field, Loading, Modal, StatusChip, toast } from '../components/ui';
import { dateFmt, money } from '../lib/format';
import type { Customer, QuoteListItem } from '../lib/types';
import { waLink } from '../lib/whatsapp';

type Detail = Customer & { quotes: Pick<QuoteListItem, 'id' | 'number' | 'title' | 'status' | 'total' | 'createdAt'>[] };

export default function Customers() {
  const [term, setTerm] = useState('');
  const [edit, setEdit] = useState<Partial<Customer> | null>(null);
  const [view, setView] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['customers', term], queryFn: () => api<Customer[]>(`/customers?q=${encodeURIComponent(term)}`) });
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Clientes</h1>
        <button className="btn primary" type="button" onClick={() => setEdit({ type: 'PARTICULAR' })}>
          + Cliente
        </button>
      </div>
      <input type="search" placeholder="Buscar por nombre o teléfono" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar" />
      <ErrorBox error={q.error} />
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <Empty>Todavía no hay clientes. Se crean solos al armar un presupuesto.</Empty>
      ) : (
        <div className="table-wrap card flush">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th className="hide-sm">WhatsApp</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <button type="button" className="link-btn strong" onClick={() => setView(c.id)}>
                      {c.name}
                    </button>
                    {c.address && <span className="muted small block">{c.address}</span>}
                  </td>
                  <td>{CUSTOMER_TYPE_LABEL[c.type]}</td>
                  <td className="hide-sm mono">{c.phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <CustomerForm value={edit} onClose={() => setEdit(null)} />}
      {view && <CustomerView id={view} onClose={() => setView(null)} onEdit={(c) => (setView(null), setEdit(c))} />}
    </div>
  );
}

function CustomerView({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (c: Customer) => void }) {
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api<Detail>(`/customers/${id}`) });
  if (!q.data) return null;
  const c = q.data;
  return (
    <Modal title={c.name} onClose={onClose}>
      <p className="muted">
        {CUSTOMER_TYPE_LABEL[c.type]}
        {c.phone && ` · ${c.phone}`}
        {c.address && ` · ${c.address}`}
      </p>
      {c.notes && <p>{c.notes}</p>}
      <div className="actions">
        {c.phone && (
          <a className="btn wa small" href={waLink(c.phone, `¡Hola ${c.name.split(' ')[0]}!`)} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        )}
        <button className="btn small" type="button" onClick={() => onEdit(c)}>
          Editar
        </button>
      </div>
      <h3>Presupuestos</h3>
      {!c.quotes.length ? (
        <p className="muted">Sin presupuestos.</p>
      ) : (
        <ul className="list">
          {c.quotes.map((x) => (
            <li key={x.id}>
              <Link className="list-row" to={`/panel/presupuestos/${x.id}`} onClick={onClose}>
                <span className="mono muted">N° {x.number}</span>
                <span className="grow">{x.title || 'Presupuesto'}</span>
                <StatusChip status={x.status} />
                <span className="num">{money(x.total)}</span>
                <span className="muted small hide-sm">{dateFmt(x.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function CustomerForm({ value, onClose }: { value: Partial<Customer>; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: value.name ?? '', phone: value.phone ?? '', email: value.email ?? '', address: value.address ?? '', type: value.type ?? 'PARTICULAR', notes: value.notes ?? '' });
  const m = useMutation({
    mutationFn: () => (value.id ? api(`/customers/${value.id}`, { method: 'PATCH', body: f }) : api('/customers', { body: f })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer'] });
      toast('Cliente guardado');
      onClose();
    },
    onError: (e) => toast(errMsg(e)),
  });
  return (
    <Modal title={value.id ? 'Editar cliente' : 'Nuevo cliente'} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Nombre">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
        </Field>
        <Field label="Tipo">
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as CustomerType })}>
            {CUSTOMER_TYPES.map((t) => (
              <option key={t} value={t}>
                {CUSTOMER_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="WhatsApp">
          <input value={f.phone} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Dirección" wide>
          <input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
        <Field label="Notas" wide>
          <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
        <div className="actions wide">
          <button className="btn primary" disabled={m.isPending}>
            Guardar
          </button>
        </div>
      </form>
    </Modal>
  );
}

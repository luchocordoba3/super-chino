import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CUSTOMER_TYPES, CUSTOMER_TYPE_LABEL, LEAD_SOURCES, LEAD_SOURCE_LABEL, type CustomerType, type LeadSource } from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Field, Loading, Modal, NumInput, StatusChip, copyText, toast } from '../components/ui';
import { dateFmt, money, qty } from '../lib/format';
import { useMe } from '../lib/me';
import type { Customer, QuoteListItem } from '../lib/types';
import { waLink } from '../lib/whatsapp';

type Detail = Customer & { quotes: (Pick<QuoteListItem, 'id' | 'number' | 'title' | 'status' | 'total' | 'createdAt'> & { payments: { amount: number }[] })[] };

interface Building {
  id: string;
  customerId: string | null;
  name: string;
  address: string;
  glasses: { place: string; widthMm: number; heightMm: number; glass: string; notes: string }[];
  notes: string;
}

/** Deja armado un presupuesto nuevo con esta pieza y este cliente (lo abre el presupuestador). */
export function prefillQuote(customerId: string, title: string, piece: { title: string; widthMm: number; heightMm: number; glass?: string }) {
  try {
    sessionStorage.setItem('vd_prefill', JSON.stringify({ customerId, title, pieces: [piece] }));
  } catch {
    // sin almacenamiento: se arma a mano
  }
}

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
  const accepted = c.quotes.filter((x) => x.status === 'ACCEPTED');
  const due = accepted.reduce((a, x) => a + Number(x.total) - x.payments.reduce((b, p) => b + Number(p.amount), 0), 0);
  return (
    <Modal title={c.name} onClose={onClose} wide>
      <p className="muted">
        {CUSTOMER_TYPE_LABEL[c.type]}
        {c.phone && ` · ${c.phone}`}
        {c.address && ` · ${c.address}`}
      </p>
      {c.notes && <p>{c.notes}</p>}
      {!!accepted.length && (
        <p className={'small ' + (due > 0 ? 'note' : 'muted')}>
          {due > 0 ? `Cuenta corriente: te debe ${money(due)}.` : 'Cuenta corriente al día.'} {accepted.length} trabajo{accepted.length > 1 ? 's' : ''} por {money(accepted.reduce((a, x) => a + Number(x.total), 0))}.
        </p>
      )}
      {c.source && <p className="muted small">Llegó por: {LEAD_SOURCE_LABEL[c.source]}</p>}
      <div className="actions">
        {c.phone && (
          <a className="btn wa small" href={waLink(c.phone, `¡Hola ${c.name.split(' ')[0]}!`)} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        )}
        <button className="btn small" type="button" onClick={() => onEdit(c)}>
          Editar
        </button>
        <ReferralButton customer={c} />
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
      {(c.type === 'CONSORCIO' || c.type === 'CONSTRUCTORA') && <Buildings customer={c} onClose={onClose} />}
    </Modal>
  );
}

function ReferralButton({ customer }: { customer: Customer }) {
  const me = useMe();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api<{ code: string }>(`/customers/${customer.id}/referral`, { method: 'POST' }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['customer', customer.id] });
      const link = `${location.origin}/${me.data?.business.slug}?ref=${r.code}`;
      if (customer.phone)
        window.open(
          waLink(customer.phone, `¡Hola ${customer.name.split(' ')[0]}! Gracias por confiar en ${me.data?.business.name}. Si alguien que conocés necesita algo de vidrios, pasale este link: ${link}`),
          '_blank',
        );
      else void copyText(link);
    },
    onError: (e) => toast(errMsg(e)),
  });
  return (
    <button className="btn small" type="button" disabled={m.isPending} onClick={() => m.mutate()}>
      Link de recomendación
    </button>
  );
}

/** Edificios (consorcios) u obras (constructoras) con los vidrios cargados: ante una rotura, el presupuesto sale en un minuto. */
function Buildings({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['buildings', customer.id], queryFn: () => api<Building[]>(`/buildings?customerId=${customer.id}`) });
  const [name, setName] = useState('');
  const [glass, setGlass] = useState<{ bid: string; place: string; widthMm: number | null; heightMm: number | null; glass: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['buildings', customer.id] });
  const add = useMutation({
    mutationFn: () => api('/buildings', { body: { customerId: customer.id, name } }),
    onSuccess: () => (refresh(), setName('')),
    onError: (e) => toast(errMsg(e)),
  });
  const save = useMutation({
    mutationFn: (b: Building) => api(`/buildings/${b.id}`, { method: 'PATCH', body: { glasses: b.glasses } }),
    onSuccess: () => (refresh(), setGlass(null)),
    onError: (e) => toast(errMsg(e)),
  });
  return (
    <section className="sub">
      <h3>{customer.type === 'CONSORCIO' ? 'Edificios' : 'Obras'} y sus vidrios</h3>
      <p className="muted small">Cargá las medidas una vez: cuando se rompe un vidrio, el presupuesto sale en un minuto.</p>
      {(q.data ?? []).map((b) => (
        <div key={b.id} className="building">
          <strong>{b.name}</strong>
          {b.address && <span className="muted small"> · {b.address}</span>}
          <ul className="list">
            {b.glasses.map((g, i) => (
              <li key={i} className="list-row small">
                <span className="grow">
                  {g.place || 'Vidrio'} · <span className="mono">{qty(g.widthMm)} × {qty(g.heightMm)} mm</span> {g.glass && `· ${g.glass}`}
                </span>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    prefillQuote(customer.id, `${b.name}: ${g.place || 'cambio de vidrio'}`, { title: g.place ? `Cambio de vidrio · ${g.place}` : 'Cambio de vidrio', widthMm: g.widthMm, heightMm: g.heightMm, glass: g.glass });
                    onClose();
                    nav('/panel/presupuestos/nuevo?prefill=1');
                  }}
                >
                  Presupuestar
                </button>
              </li>
            ))}
          </ul>
          {glass?.bid === b.id ? (
            <div className="form-grid">
              <Field label="Dónde">
                <input value={glass.place} onChange={(e) => setGlass({ ...glass, place: e.target.value })} placeholder="Ej.: puerta de entrada" />
              </Field>
              <Field label="Ancho (mm)">
                <NumInput value={glass.widthMm} onChange={(v) => setGlass({ ...glass, widthMm: v })} />
              </Field>
              <Field label="Alto (mm)">
                <NumInput value={glass.heightMm} onChange={(v) => setGlass({ ...glass, heightMm: v })} />
              </Field>
              <Field label="Vidrio">
                <input value={glass.glass} onChange={(e) => setGlass({ ...glass, glass: e.target.value })} placeholder="Ej.: Laminado 5+5" />
              </Field>
              <div className="actions wide">
                <button
                  type="button"
                  className="btn small primary"
                  disabled={!glass.widthMm || !glass.heightMm}
                  onClick={() => save.mutate({ ...b, glasses: [...b.glasses, { place: glass.place, widthMm: Math.round(glass.widthMm!), heightMm: Math.round(glass.heightMm!), glass: glass.glass, notes: '' }] })}
                >
                  Agregar vidrio
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="link-btn small" onClick={() => setGlass({ bid: b.id, place: '', widthMm: null, heightMm: null, glass: '' })}>
              + Vidrio
            </button>
          )}
        </div>
      ))}
      <div className="row wrap">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={customer.type === 'CONSORCIO' ? 'Ej.: Edificio Mitre 1200' : 'Ej.: Obra calle Mitre'} aria-label="Nombre del edificio u obra" />
        <button type="button" className="btn small" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
          + {customer.type === 'CONSORCIO' ? 'Edificio' : 'Obra'}
        </button>
      </div>
    </section>
  );
}

function CustomerForm({ value, onClose }: { value: Partial<Customer>; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: value.name ?? '',
    phone: value.phone ?? '',
    email: value.email ?? '',
    address: value.address ?? '',
    type: value.type ?? 'PARTICULAR',
    notes: value.notes ?? '',
    source: value.source ?? (null as LeadSource | null),
  });
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
        <Field label="¿Cómo llegó?">
          <select value={f.source ?? ''} onChange={(e) => setF({ ...f, source: (e.target.value || null) as LeadSource | null })}>
            <option value="">No sé</option>
            {LEAD_SOURCES.map((x) => (
              <option key={x} value={x}>
                {LEAD_SOURCE_LABEL[x]}
              </option>
            ))}
          </select>
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

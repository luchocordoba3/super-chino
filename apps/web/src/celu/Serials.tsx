// Equipos con IMEI: stock, ingreso (uno por uno o pegando una lista), ficha con historia, garantía y señas.
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CONDITION_LABELS, isValidImei, SERIAL_STATUS_LABELS, type SerialStatus } from '@super-chino/shared';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Field, Loading, Modal, Tabs, toast, toNum } from '../components/ui';
import { dateTimeFmt, dayFmt, money } from '../lib/format';
import { can, useMe } from '../lib/me';
import { Badge, type Customer, ImeiInput, inCur, PhotoButton, ProductPicker, type ProductLite, toArs, uploadImage, usd, useFx } from './common';

export interface SerialRow {
  id: string;
  productId: string;
  product: string;
  currency: string;
  imei1: string | null;
  imei2: string | null;
  serial: string | null;
  condition: 'NEW' | 'USED' | 'REFURB';
  grade: string | null;
  battery: number | null;
  color: string | null;
  carrierLocked: boolean;
  accountFree: boolean | null;
  includes: string | null;
  notes: string | null;
  photos: string[];
  price: number;
  ownPrice: boolean;
  cost: number;
  origin: string;
  status: SerialStatus;
  receivedAt: string;
  soldAt: string | null;
  warrantyUntil: string | null;
  supplierWarrantyUntil: string | null;
}

export const conditionText = (s: Pick<SerialRow, 'condition' | 'grade' | 'battery'>) =>
  [CONDITION_LABELS[s.condition], s.grade && `grado ${s.grade}`, s.battery != null && `batería ${s.battery}%`].filter(Boolean).join(' · ');

export function Serials() {
  const me = useMe();
  const [tab, setTab] = useState<'STOCK' | 'SOLD' | 'ALL'>('STOCK');
  const [q, setQ] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [warranty, setWarranty] = useState(false);
  const fx = useFx();
  const list = useQuery({
    queryKey: ['serials', tab, q],
    queryFn: () => api<SerialRow[]>(`/serials?${tab === 'ALL' ? '' : `status=${tab}&`}q=${encodeURIComponent(q)}`),
  });
  const rows = list.data ?? [];
  const totalUsd = rows.filter((r) => r.status === 'AVAILABLE').reduce((s, r) => s + (r.currency === 'USD' ? r.price : 0), 0);
  return (
    <div className="stack">
      <div className="row between">
        <h1>Equipos</h1>
        <div className="row">
          <button onClick={() => setWarranty(true)}>🛡 Consultar garantía</button>
          {can(me, 'stock') && (
            <button className="primary" onClick={() => setReceiving(true)}>
              + Ingresar equipos
            </button>
          )}
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'STOCK', label: 'En el local' },
          { id: 'SOLD', label: 'Vendidos' },
          { id: 'ALL', label: 'Todos' },
        ]}
      />
      <input placeholder="Buscar por IMEI, serie o modelo" value={q} onChange={(e) => setQ(e.target.value)} />
      {tab === 'STOCK' && rows.length > 0 && (
        <p className="muted small">
          {rows.filter((r) => r.status === 'AVAILABLE').length} disponibles · valor de venta {usd(totalUsd)}
          {fx.data?.rate ? ` (${money(totalUsd * fx.data.rate)})` : ''}
        </p>
      )}
      {list.isLoading && <Loading />}
      <ErrorBox error={list.error} />
      {list.data?.length === 0 && <Empty />}
      <div className="card table-wrap">
        <table>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link to={`/serials/${s.id}`}>
                    <strong>{s.product}</strong>
                  </Link>
                  <div className="small muted">
                    {s.imei1 ?? s.serial} · {conditionText(s)}
                    {s.color ? ` · ${s.color}` : ''}
                  </div>
                </td>
                <td>
                  <Badge status={s.status} label={SERIAL_STATUS_LABELS[s.status]} />
                </td>
                <td className="num">
                  <strong>{inCur(s.price, s.currency)}</strong>
                  {s.currency === 'USD' && fx.data?.rate ? <div className="small muted">{money(toArs(s.price, 'USD', fx.data.rate))}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {receiving && <ReceiveModal onClose={() => setReceiving(false)} />}
      {warranty && <WarrantyModal onClose={() => setWarranty(false)} />}
    </div>
  );
}

interface Line {
  imei1: string;
  condition: 'NEW' | 'USED' | 'REFURB';
  grade: string;
  battery: string;
  color: string;
  cost: string;
  price: string;
}
const emptyLine = (prev?: Line): Line => ({ imei1: '', condition: prev?.condition ?? 'NEW', grade: prev?.grade ?? '', battery: '', color: prev?.color ?? '', cost: prev?.cost ?? '', price: prev?.price ?? '' });

/** Ingreso: se elige (o se crea) el modelo y se cargan los IMEI, escaneando o pegando una columna de Excel. */
function ReceiveModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [product, setProduct] = useState<ProductLite | null>(null);
  const [newModel, setNewModel] = useState({ name: '', price: '', open: false });
  const [line, setLine] = useState<Line>(emptyLine());
  const [lines, setLines] = useState<Line[]>([]);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);

  const createModel = async () => {
    const price = toNum(newModel.price);
    if (!newModel.name.trim() || price == null) return toast('Poné nombre y precio en dólares');
    try {
      const p = await api<ProductLite>('/products', { body: { name: newModel.name, price, currency: 'USD', serialized: true } });
      setProduct(p);
    } catch (e) {
      toast(errMsg(e));
    }
  };
  const addLine = () => {
    const imei = line.imei1.replace(/\D/g, '');
    if (!isValidImei(imei)) return toast('IMEI inválido');
    if (lines.some((l) => l.imei1 === imei)) return toast('Ese IMEI ya está en la lista');
    setLines([...lines, { ...line, imei1: imei }]);
    setLine(emptyLine(line));
  };
  const addPasted = () => {
    const imeis = paste.split(/[\s,;]+/).map((x) => x.replace(/\D/g, '')).filter((x) => x.length >= 14);
    const bad = imeis.filter((x) => !isValidImei(x));
    if (bad.length) toast(`${bad.length} IMEI no válidos se saltearon`);
    const fresh = imeis.filter((x) => isValidImei(x) && !lines.some((l) => l.imei1 === x));
    setLines([...lines, ...fresh.map((imei1) => ({ ...emptyLine(line), imei1 }))]);
    setPaste('');
  };
  const save = async () => {
    if (!product || lines.length === 0) return;
    setBusy(true);
    try {
      const r = await api<{ created: number }>('/serials', {
        body: {
          productId: product.id,
          items: lines.map((l) => ({
            imei1: l.imei1,
            condition: l.condition,
            grade: l.grade || null,
            battery: toNum(l.battery),
            color: l.color || null,
            cost: toNum(l.cost) ?? 0,
            price: toNum(l.price),
          })),
        },
      });
      toast(`Ingresaron ${r.created} equipos`);
      void qc.invalidateQueries({ queryKey: ['serials'] });
      onClose();
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Ingresar equipos" onClose={onClose}>
      <div className="stack">
        {!product ? (
          <>
            <ProductPicker placeholder="Modelo (ej. iPhone 13 128GB)" onPick={setProduct} />
            {!newModel.open ? (
              <button type="button" className="small" onClick={() => setNewModel({ ...newModel, open: true })}>
                + Modelo nuevo
              </button>
            ) : (
              <div className="grid2">
                <Field label="Modelo">
                  <input value={newModel.name} onChange={(e) => setNewModel({ ...newModel, name: e.target.value })} placeholder="Samsung A55 256GB Negro" />
                </Field>
                <Field label="Precio de venta (US$)">
                  <input inputMode="decimal" value={newModel.price} onChange={(e) => setNewModel({ ...newModel, price: e.target.value })} />
                </Field>
                <button type="button" className="primary" onClick={() => void createModel()}>
                  Crear modelo
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="row between card" style={{ padding: 10 }}>
              <strong>{product.name}</strong>
              <span>{inCur(product.price, product.currency)}</span>
              <button type="button" className="small ghost" onClick={() => setProduct(null)}>
                Cambiar
              </button>
            </div>
            <div className="grid2">
              <Field label="Estado">
                <select value={line.condition} onChange={(e) => setLine({ ...line, condition: e.target.value as Line['condition'] })}>
                  <option value="NEW">Nuevo</option>
                  <option value="USED">Usado</option>
                  <option value="REFURB">Reacondicionado</option>
                </select>
              </Field>
              {line.condition !== 'NEW' && (
                <>
                  <Field label="Grado">
                    <select value={line.grade} onChange={(e) => setLine({ ...line, grade: e.target.value })}>
                      <option value="">—</option>
                      <option value="A">A (impecable)</option>
                      <option value="B">B (detalles leves)</option>
                      <option value="C">C (marcas visibles)</option>
                    </select>
                  </Field>
                  <Field label="Batería %">
                    <input inputMode="numeric" value={line.battery} onChange={(e) => setLine({ ...line, battery: e.target.value })} />
                  </Field>
                </>
              )}
              <Field label="Color">
                <input value={line.color} onChange={(e) => setLine({ ...line, color: e.target.value })} />
              </Field>
              <Field label={`Costo (${product.currency === 'USD' ? 'US$' : '$'})`}>
                <input inputMode="decimal" value={line.cost} onChange={(e) => setLine({ ...line, cost: e.target.value })} />
              </Field>
              <Field label="Precio propio" hint="Vacío = el del modelo">
                <input inputMode="decimal" value={line.price} onChange={(e) => setLine({ ...line, price: e.target.value })} />
              </Field>
            </div>
            <ImeiInput value={line.imei1} onChange={(v) => setLine({ ...line, imei1: v })} autoFocus onEnter={addLine} />
            <button type="button" onClick={addLine}>
              + Agregar a la lista
            </button>
            <details>
              <summary className="small">Pegar muchos IMEI (de Excel o de la factura)</summary>
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Un IMEI por renglón" />
              <button type="button" className="small" onClick={addPasted}>
                Agregar
              </button>
            </details>
            {lines.length > 0 && (
              <div className="card">
                {lines.map((l, i) => (
                  <div key={l.imei1} className="row between small">
                    <span>
                      {l.imei1} · {CONDITION_LABELS[l.condition]}
                      {l.grade ? ` ${l.grade}` : ''}
                      {l.battery ? ` · ${l.battery}%` : ''} {l.color}
                    </span>
                    <button type="button" className="small ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button className="primary big" disabled={busy || lines.length === 0} onClick={() => void save()}>
              Ingresar {lines.length} equipo{lines.length === 1 ? '' : 's'}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

interface WarrantyResult {
  item: SerialRow | null;
  customer: Customer | null;
  sale: { id: string; occurredAt: string; total: number } | null;
  underWarranty: boolean;
  supplierWarranty: boolean;
  repairs: { id: string; number: number; status: string; problem: string; createdAt: string }[];
}

/** Garantía por IMEI: qué es, a quién se vendió y hasta cuándo cubre. */
export function WarrantyModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [res, setRes] = useState<WarrantyResult | null>(null);
  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    try {
      setRes(await api<WarrantyResult>(`/warranty/${encodeURIComponent(code.trim())}`));
    } catch (err) {
      toast(errMsg(err));
    }
  };
  return (
    <Modal title="🛡 Consultar garantía" onClose={onClose}>
      <form className="stack" onSubmit={(e) => void search(e)}>
        <ImeiInput value={code} onChange={setCode} autoFocus label="IMEI o número de serie" />
        <button className="primary">Buscar</button>
      </form>
      {res && !res.item && <p className="warn">No hay ningún equipo con ese IMEI en el sistema.</p>}
      {res?.item && (
        <div className="stack" style={{ marginTop: 12 }}>
          <h3>{res.item.product}</h3>
          <p className="small">{conditionText(res.item)}</p>
          {res.sale ? (
            <p>
              Vendido el {dayFmt(res.sale.occurredAt)} a <strong>{res.customer?.name ?? '—'}</strong>.
            </p>
          ) : (
            <p className="muted">No figura como vendido.</p>
          )}
          <p className={res.underWarranty ? 'ok' : 'error'}>
            <strong>{res.underWarranty ? `En garantía hasta el ${dayFmt(res.item.warrantyUntil)}` : res.item.warrantyUntil ? `Garantía vencida el ${dayFmt(res.item.warrantyUntil)}` : 'Sin garantía registrada'}</strong>
          </p>
          {res.supplierWarranty && <p className="small">Tiene garantía del proveedor hasta el {dayFmt(res.item.supplierWarrantyUntil)}.</p>}
          {res.repairs.map((r) => (
            <Link key={r.id} to={`/repairs/${r.id}`} onClick={onClose} className="small">
              Reparación #{r.number} · {r.problem}
            </Link>
          ))}
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                onClose();
                nav('/repairs/new', { state: { serial: res.item, customer: res.customer, warranty: res.underWarranty } });
              }}
            >
              Abrir reparación {res.underWarranty ? 'por garantía' : ''}
            </button>
            <Link className="btn" to={`/serials/${res.item.id}`} onClick={onClose}>
              Ver ficha
            </Link>
          </div>
        </div>
      )}
    </Modal>
  );
}

interface SerialDetailData extends SerialRow {
  customer: Customer | null;
  sale: { id: string; occurredAt: string; total: number; user: string | null } | null;
  events: { id: string; type: string; status: string | null; note: string | null; createdAt: string; user: string | null; refId: string | null }[];
}
const EVENT_LABELS: Record<string, string> = {
  IN: 'Ingresó al stock',
  SOLD: 'Vendido',
  VOID: 'Venta anulada',
  RESERVED: 'Reservado',
  RELEASED: 'Liberado',
  REPAIR: 'A reparación',
  RMA: 'Garantía con proveedor',
  EDIT: 'Datos cambiados',
  STATUS: 'Cambio de estado',
  TRADE_IN: 'Ingresó como usado tomado',
};

export function SerialDetail() {
  const { id } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const fx = useFx();
  const q = useQuery({ queryKey: ['serial', id], queryFn: () => api<SerialDetailData>(`/serials/${id}`) });
  const [edit, setEdit] = useState(false);
  const [label, setLabel] = useState(false);
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const s = q.data;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['serial', id] });
  const setStatus = async (status: string) => {
    const note = window.prompt('Nota (opcional)') ?? undefined;
    try {
      await api(`/serials/${s.id}`, { method: 'PATCH', body: { status, note } });
      refresh();
    } catch (e) {
      toast(errMsg(e));
    }
  };
  const rate = fx.data?.rate;
  return (
    <div className="stack">
      <Link to="/serials">← Equipos</Link>
      <div className="card stack">
        <div className="row between">
          <h1>{s.product}</h1>
          <Badge status={s.status} label={SERIAL_STATUS_LABELS[s.status]} />
        </div>
        <div className="grid2">
          <div>
            <div className="muted small">IMEI</div>
            {s.imei1 ?? '—'}
            {s.imei2 ? ` / ${s.imei2}` : ''}
          </div>
          {s.serial && (
            <div>
              <div className="muted small">Serie</div>
              {s.serial}
            </div>
          )}
          <div>
            <div className="muted small">Estado</div>
            {conditionText(s)}
          </div>
          <div>
            <div className="muted small">Precio</div>
            <strong>{inCur(s.price, s.currency)}</strong> {s.currency === 'USD' && rate ? <span className="muted">({money(toArs(s.price, 'USD', rate))})</span> : null}
          </div>
          {can(me, 'owner') && (
            <div>
              <div className="muted small">Costo</div>
              {inCur(s.cost, s.currency)} · margen {inCur(s.price - s.cost, s.currency)}
            </div>
          )}
          <div>
            <div className="muted small">Ingresó</div>
            {dayFmt(s.receivedAt)} ({Math.floor((Date.now() - new Date(s.receivedAt).getTime()) / 86_400_000)} días)
          </div>
          {s.color && (
            <div>
              <div className="muted small">Color</div>
              {s.color}
            </div>
          )}
          <div>
            <div className="muted small">Cuenta iCloud/Google</div>
            {s.accountFree == null ? 'Sin revisar' : s.accountFree ? 'Libre ✓' : 'Bloqueada ✗'} · {s.carrierLocked ? 'Bloqueado a compañía' : 'Liberado'}
          </div>
          {s.warrantyUntil && (
            <div>
              <div className="muted small">Garantía del cliente</div>
              hasta {dayFmt(s.warrantyUntil)}
            </div>
          )}
          {s.supplierWarrantyUntil && (
            <div>
              <div className="muted small">Garantía del proveedor</div>
              hasta {dayFmt(s.supplierWarrantyUntil)}
            </div>
          )}
        </div>
        {s.includes && <p className="small">Incluye: {s.includes}</p>}
        {s.notes && <p className="small">{s.notes}</p>}
        {s.customer && (
          <p>
            Cliente: <Link to={`/customers/${s.customer.id}`}>{s.customer.name}</Link>
            {s.sale && ` · vendido el ${dayFmt(s.sale.occurredAt)} por ${s.sale.user ?? '—'}`}
          </p>
        )}
        <div className="row">
          {can(me, 'stock') && <button onClick={() => setEdit(true)}>Editar</button>}
          <button onClick={() => setLabel(true)}>🏷 Etiqueta</button>
          {can(me, 'stock') && s.status === 'AVAILABLE' && (
            <>
              <button onClick={() => void setStatus('RMA')}>Garantía con proveedor</button>
              <button className="danger" onClick={() => void setStatus('SCRAPPED')}>
                Dar de baja
              </button>
            </>
          )}
          {can(me, 'stock') && (s.status === 'RMA' || s.status === 'SCRAPPED') && <button onClick={() => void setStatus('AVAILABLE')}>Volver a disponible</button>}
        </div>
      </div>
      <div className="card stack">
        <h3>Fotos</h3>
        <div className="grid2">
          {s.photos.map((p) => (
            <img key={p} src={`/api/files/${p}`} alt="" style={{ width: '100%', borderRadius: 8 }} />
          ))}
          {can(me, 'stock') && <PhotoButton label="Agregar foto" upload={(f) => uploadImage(`/serials/${s.id}/photo`, f).then(refresh)} />}
        </div>
      </div>
      <div className="card">
        <h3>Historia</h3>
        {s.events.map((e) => (
          <div key={e.id} className="list-item small">
            <span className="muted">{dateTimeFmt(e.createdAt)}</span>
            <span className="grow">
              {EVENT_LABELS[e.type] ?? e.type}
              {e.status ? ` → ${SERIAL_STATUS_LABELS[e.status as SerialStatus]}` : ''}
              {e.note ? ` · ${e.note}` : ''}
            </span>
            <span className="muted">{e.user}</span>
          </div>
        ))}
      </div>
      {edit && <EditSerial s={s} onClose={() => (setEdit(false), refresh())} />}
      {label && (
        <Modal title="Etiqueta" onClose={() => setLabel(false)}>
          <div className="print-area" style={{ border: '1px dashed #999', padding: 10, width: '70mm' }}>
            <strong>{s.product}</strong>
            <div style={{ fontSize: 11 }}>{conditionText(s)}</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{inCur(s.price, s.currency)}</div>
            {s.currency === 'USD' && rate ? <div style={{ fontSize: 12 }}>{money(toArs(s.price, 'USD', rate))} al cambio de hoy</div> : null}
            <div style={{ fontSize: 10, fontFamily: 'monospace' }}>IMEI {s.imei1 ?? s.serial}</div>
          </div>
          <button className="primary" style={{ marginTop: 10 }} onClick={() => window.print()}>
            🖨 Imprimir
          </button>
        </Modal>
      )}
    </div>
  );
}

function EditSerial({ s, onClose }: { s: SerialRow; onClose: () => void }) {
  const [f, setF] = useState({
    imei1: s.imei1 ?? '',
    imei2: s.imei2 ?? '',
    serial: s.serial ?? '',
    condition: s.condition,
    grade: s.grade ?? '',
    battery: s.battery == null ? '' : String(s.battery),
    color: s.color ?? '',
    price: s.ownPrice ? String(s.price) : '',
    cost: String(s.cost),
    includes: s.includes ?? '',
    notes: s.notes ?? '',
    accountFree: s.accountFree,
    carrierLocked: s.carrierLocked,
    supplierWarrantyUntil: s.supplierWarrantyUntil?.slice(0, 10) ?? '',
  });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(`/serials/${s.id}`, {
        method: 'PATCH',
        body: {
          imei1: f.imei1 || null,
          imei2: f.imei2 || null,
          serial: f.serial || null,
          condition: f.condition,
          grade: f.grade || null,
          battery: toNum(f.battery),
          color: f.color || null,
          price: toNum(f.price),
          cost: toNum(f.cost) ?? 0,
          includes: f.includes || null,
          notes: f.notes || null,
          accountFree: f.accountFree,
          carrierLocked: f.carrierLocked,
          supplierWarrantyUntil: f.supplierWarrantyUntil || null,
        },
      });
      toast('Guardado');
      onClose();
    } catch (err) {
      toast(errMsg(err));
    }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Editar equipo" onClose={onClose}>
      <form className="stack" onSubmit={(e) => void save(e)}>
        <div className="grid2">
          <Field label="IMEI 1">
            <input value={f.imei1} onChange={set('imei1')} />
          </Field>
          <Field label="IMEI 2">
            <input value={f.imei2} onChange={set('imei2')} />
          </Field>
          <Field label="Serie">
            <input value={f.serial} onChange={set('serial')} />
          </Field>
          <Field label="Estado">
            <select value={f.condition} onChange={set('condition')}>
              <option value="NEW">Nuevo</option>
              <option value="USED">Usado</option>
              <option value="REFURB">Reacondicionado</option>
            </select>
          </Field>
          <Field label="Grado">
            <select value={f.grade} onChange={set('grade')}>
              <option value="">—</option>
              <option>A</option>
              <option>B</option>
              <option>C</option>
            </select>
          </Field>
          <Field label="Batería %">
            <input inputMode="numeric" value={f.battery} onChange={set('battery')} />
          </Field>
          <Field label="Color">
            <input value={f.color} onChange={set('color')} />
          </Field>
          <Field label="Precio propio" hint="Vacío = el del modelo">
            <input inputMode="decimal" value={f.price} onChange={set('price')} />
          </Field>
          <Field label="Costo">
            <input inputMode="decimal" value={f.cost} onChange={set('cost')} />
          </Field>
          <Field label="Garantía del proveedor hasta">
            <input type="date" value={f.supplierWarrantyUntil} onChange={set('supplierWarrantyUntil')} />
          </Field>
        </div>
        <Field label="Incluye">
          <input value={f.includes} onChange={set('includes')} placeholder="Caja, cable, cargador" />
        </Field>
        <Field label="Notas">
          <textarea value={f.notes} onChange={set('notes')} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.accountFree === true} onChange={(e) => setF({ ...f, accountFree: e.target.checked })} /> Cuenta iCloud / Google libre
        </label>
        <label className="check">
          <input type="checkbox" checked={f.carrierLocked} onChange={(e) => setF({ ...f, carrierLocked: e.target.checked })} /> Bloqueado a una compañía
        </label>
        <button className="primary">Guardar</button>
      </form>
    </Modal>
  );
}

interface DepositRow {
  id: string;
  amount: number;
  currency: string;
  fx: number | null;
  method: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  customer: { name: string; phone: string | null } | null;
  item: { name: string; imei: string | null } | null;
  repairOrderId: string | null;
  orderId: string | null;
}
const DEPOSIT_LABELS: Record<string, string> = { ACTIVE: 'Vigente', USED: 'Usada', EXPIRED: 'Vencida', CANCELLED: 'Cancelada' };

/** Señas: vigentes, usadas y vencidas. */
export function Deposits() {
  const me = useMe();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'ACTIVE' | 'EXPIRED' | 'USED'>('ACTIVE');
  const q = useQuery({ queryKey: ['deposits', status], queryFn: () => api<DepositRow[]>(`/deposits?status=${status}`) });
  const cancel = async (id: string) => {
    if (!window.confirm('¿Cancelar la seña? El equipo vuelve a estar disponible. La plata se devuelve desde la caja como retiro.')) return;
    await api(`/deposits/${id}/cancel`, { method: 'POST' });
    void qc.invalidateQueries({ queryKey: ['deposits'] });
  };
  return (
    <div className="stack">
      <h1>Señas</h1>
      <p className="muted small">Las señas se cobran en la caja (botón “Seña”) y se descuentan solas al cobrar el equipo.</p>
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { id: 'ACTIVE', label: 'Vigentes' },
          { id: 'EXPIRED', label: 'Vencidas' },
          { id: 'USED', label: 'Usadas' },
        ]}
      />
      {q.isLoading && <Loading />}
      {q.data?.length === 0 && <Empty />}
      {q.data?.map((d) => (
        <div key={d.id} className="card row between">
          <div className="grow">
            <strong>{d.customer?.name ?? 'Sin cliente'}</strong> · {d.currency === 'USD' ? usd(d.fx) : money(d.amount)}
            <div className="small muted">
              {d.item ? `${d.item.name} (${d.item.imei})` : d.repairOrderId ? 'Reparación' : d.orderId ? 'Pedido' : ''} · {dayFmt(d.createdAt)}
              {d.expiresAt && d.status === 'ACTIVE' ? ` · vence ${dayFmt(d.expiresAt)}` : ''}
            </div>
          </div>
          <Badge status={d.status} label={DEPOSIT_LABELS[d.status]} />
          {d.status === 'ACTIVE' && can(me, 'owner') && (
            <button className="small danger" onClick={() => void cancel(d.id)}>
              Cancelar
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

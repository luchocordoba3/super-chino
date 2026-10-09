// Toma de usados: datos del equipo y de quien lo vende, controles anti-robo, tasación y libro de usados.
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEVICE_CHECK_LABELS, DEVICE_CHECKS, type DeviceCheck, isValidImei } from '@super-chino/shared';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Field, Loading, Tabs, toast, toNum } from '../components/ui';
import { dateTimeFmt, dayFmt } from '../lib/format';
import { can, useMe } from '../lib/me';
import { Badge, type Customer, CustomerPicker, ImeiInput, PhotoButton, ProductPicker, type ProductLite, SignaturePad, uploadImage, usd } from './common';

interface TradeIn {
  id: string;
  number: number;
  status: 'DRAFT' | 'ACCEPTED' | 'REJECTED';
  customer: Customer;
  productId: string | null;
  model: string;
  imei1: string;
  imei2: string | null;
  color: string | null;
  grade: string | null;
  battery: number | null;
  checklist: Partial<Record<DeviceCheck, boolean>>;
  accountFree: boolean;
  imeiMatches: boolean;
  enacomResult: 'CLEAN' | 'REPORTED' | null;
  enacomAt: string | null;
  enacomByName: string | null;
  offeredUsd: number;
  payout: 'CREDIT' | 'CASH';
  notes: string | null;
  usedSaleId: string | null;
  paidAt: string | null;
  serialItemId: string | null;
  createdAt: string;
  user: string | null;
  photos: { dniFront: string | null; dniBack: string | null; selfie: string | null; enacom: string | null; signature: string | null };
  missing: string[];
}
const STATUS = { DRAFT: 'En curso', ACCEPTED: 'Aceptada', REJECTED: 'Rechazada' } as const;
const MISSING: Record<string, string> = {
  dniFront: 'foto del DNI (frente)',
  dniBack: 'foto del DNI (dorso)',
  enacom: 'consulta ENACOM sin denuncia',
  enacomPhoto: 'captura de ENACOM',
  accountFree: 'iCloud / cuenta Google cerrada',
  imeiMatches: 'IMEI del equipo igual al de la caja / etiqueta',
  signature: 'firma de la declaración',
  product: 'modelo del catálogo',
  price: 'valor de la toma',
};

export function TradeIns() {
  const me = useMe();
  const [status, setStatus] = useState<'DRAFT' | 'ACCEPTED' | 'REJECTED'>('DRAFT');
  const q = useQuery({ queryKey: ['tradeins', status], queryFn: () => api<TradeIn[]>(`/tradeins?status=${status}`) });
  return (
    <div className="stack">
      <div className="row between">
        <h1>Usados</h1>
        <div className="row">
          {can(me, 'prices') && (
            <Link className="btn" to="/tradeins/prices">
              Grilla de precios
            </Link>
          )}
          {can(me, 'owner') && (
            <a className="btn" href="/api/tradeins-book.csv">
              📒 Libro de usados (Excel)
            </a>
          )}
          {can(me, 'tradeins') && (
            <Link className="btn btn-primary" to="/tradeins/new">
              + Tomar un usado
            </Link>
          )}
        </div>
      </div>
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { id: 'DRAFT', label: 'En curso' },
          { id: 'ACCEPTED', label: 'Aceptadas' },
          { id: 'REJECTED', label: 'Rechazadas' },
        ]}
      />
      {q.isLoading && <Loading />}
      {q.data?.length === 0 && <Empty />}
      {q.data?.map((t) => (
        <Link key={t.id} to={`/tradeins/${t.id}`} className="card row between" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="grow">
            <strong>
              #{t.number} · {t.model}
            </strong>
            <div className="small muted">
              {t.customer.name} · IMEI {t.imei1} · {dayFmt(t.createdAt)}
            </div>
          </div>
          <span>{usd(t.offeredUsd)}</span>
          <Badge status={t.status} label={STATUS[t.status]} />
          {t.status === 'ACCEPTED' && <span className="badge">{t.usedSaleId ? 'Crédito usado' : t.paidAt ? 'Pagado' : t.payout === 'CASH' ? 'A pagar en caja' : 'Crédito disponible'}</span>}
        </Link>
      ))}
    </div>
  );
}

/** Alta: quién lo vende y qué equipo es. Después se completan los controles en la ficha. */
export function NewTradeIn() {
  const nav = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [product, setProduct] = useState<ProductLite | null>(null);
  const [f, setF] = useState({ model: '', imei1: '', color: '', grade: 'B', battery: '', payout: 'CREDIT' as 'CREDIT' | 'CASH' });
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customer) return toast('Elegí o cargá a la persona que vende el equipo');
    if (!customer.dni) return toast('La persona tiene que tener DNI cargado');
    if (!isValidImei(f.imei1)) return toast('IMEI inválido');
    setBusy(true);
    try {
      const t = await api<TradeIn>('/tradeins', {
        body: {
          customerId: customer.id,
          productId: product?.id ?? null,
          model: product?.name ?? f.model,
          imei1: f.imei1,
          color: f.color || null,
          grade: f.grade,
          battery: toNum(f.battery),
          payout: f.payout,
        },
      });
      nav(`/tradeins/${t.id}`, { replace: true });
    } catch (err) {
      toast(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <Link to="/tradeins">← Usados</Link>
      <h1>Tomar un usado</h1>
      <div className="card stack">
        <h3>1. Quién lo vende</h3>
        <CustomerPicker value={customer} onChange={setCustomer} required />
        <p className="small muted">Pedí el DNI en mano: el nombre y el número tienen que coincidir.</p>
      </div>
      <div className="card stack">
        <h3>2. El equipo</h3>
        {product ? (
          <div className="row between">
            <strong>{product.name}</strong>
            <button type="button" className="small" onClick={() => setProduct(null)}>
              Cambiar
            </button>
          </div>
        ) : (
          <>
            <ProductPicker placeholder="Modelo del catálogo (ej. iPhone 12 128GB)" onPick={setProduct} filter={(p) => !p.isService} />
            <Field label="…o escribí el modelo" hint="Para aceptarla hay que elegirlo del catálogo">
              <input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
            </Field>
          </>
        )}
        <ImeiInput value={f.imei1} onChange={(v) => setF({ ...f, imei1: v })} />
        <div className="grid2">
          <Field label="Grado">
            <select value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })}>
              <option value="A">A (impecable)</option>
              <option value="B">B (detalles leves)</option>
              <option value="C">C (marcas visibles)</option>
            </select>
          </Field>
          <Field label="Batería %">
            <input inputMode="numeric" value={f.battery} onChange={(e) => setF({ ...f, battery: e.target.value })} />
          </Field>
          <Field label="Color">
            <input value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
          </Field>
          <Field label="Forma">
            <select value={f.payout} onChange={(e) => setF({ ...f, payout: e.target.value as 'CREDIT' | 'CASH' })}>
              <option value="CREDIT">Parte de pago (crédito en la caja)</option>
              <option value="CASH">Compra (se le paga desde la caja)</option>
            </select>
          </Field>
        </div>
      </div>
      <button className="primary big" disabled={busy || (!product && !f.model)}>
        Continuar
      </button>
    </form>
  );
}

export function TradeInDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tradeins', id], queryFn: () => api<TradeIn>(`/tradeins/${id}`) });
  const [suggest, setSuggest] = useState<{ price: number | null; lowBattery?: boolean } | null>(null);
  const t = q.data;
  useEffect(() => {
    if (!t?.productId || !t.grade) return;
    void api<{ price: number | null; lowBattery?: boolean }>(`/tradeins/quote?productId=${t.productId}&grade=${t.grade}${t.battery != null ? `&battery=${t.battery}` : ''}`).then(setSuggest).catch(() => undefined);
  }, [t?.productId, t?.grade, t?.battery]);
  if (q.isLoading) return <Loading />;
  if (!t) return <ErrorBox error={q.error} />;
  const draft = t.status === 'DRAFT';
  const refresh = () => void qc.invalidateQueries({ queryKey: ['tradeins'] });
  const patch = async (body: Record<string, unknown>) => {
    try {
      await api(`/tradeins/${t.id}`, { method: 'PATCH', body });
      refresh();
    } catch (e) {
      toast(errMsg(e));
    }
  };
  const photo = (kind: string) => (f: Blob) => uploadImage(`/tradeins/${t.id}/photo?kind=${kind}`, f).then(refresh);
  const accept = async () => {
    try {
      await api(`/tradeins/${t.id}/accept`, { method: 'POST' });
      toast(t.payout === 'CASH' ? 'Aceptada. Pagale desde la caja: “Pagar usado”.' : 'Aceptada. El crédito ya está en la caja.');
      refresh();
    } catch (e) {
      toast(errMsg(e));
    }
  };
  const reject = async () => {
    const reason = window.prompt('Motivo');
    if (reason === null) return;
    await api(`/tradeins/${t.id}/reject`, { body: { reason } });
    refresh();
  };
  return (
    <div className="stack">
      <Link to="/tradeins">← Usados</Link>
      <div className="row between">
        <h1>
          Toma #{t.number} · {t.model}
        </h1>
        <Badge status={t.status} label={STATUS[t.status]} />
      </div>
      <div className="card small">
        <strong>{t.customer.name}</strong> · DNI {t.customer.dni} {t.customer.phone ? `· ${t.customer.phone}` : ''}
        <div>
          IMEI {t.imei1} · grado {t.grade ?? '—'} · batería {t.battery ?? '—'}% {t.color ? `· ${t.color}` : ''}
        </div>
        <div className="muted">
          Atendió {t.user} · {dateTimeFmt(t.createdAt)}
        </div>
      </div>

      {draft && !t.productId && (
        <div className="card stack">
          <h3>Modelo del catálogo</h3>
          <ProductPicker onPick={(p) => void patch({ productId: p.id, model: p.name })} filter={(p) => !p.isService} />
        </div>
      )}

      <div className="card stack">
        <h3>Revisión del equipo</h3>
        <div className="grid2">
          {DEVICE_CHECKS.map((k) => (
            <label key={k} className="check">
              <input type="checkbox" disabled={!draft} checked={!!t.checklist[k]} onChange={(e) => void patch({ checklist: { ...t.checklist, [k]: e.target.checked } })} /> {DEVICE_CHECK_LABELS[k]}
            </label>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" disabled={!draft} checked={t.imeiMatches} onChange={(e) => void patch({ imeiMatches: e.target.checked })} /> El IMEI de <strong>*#06#</strong> coincide con el de la caja / bandeja
        </label>
        <label className="check">
          <input type="checkbox" disabled={!draft} checked={t.accountFree} onChange={(e) => void patch({ accountFree: e.target.checked })} /> Cerró iCloud / cuenta Google delante nuestro (sin bloqueo de activación)
        </label>
      </div>

      <div className="card stack">
        <h3>ENACOM: ¿tiene denuncia de robo o pérdida?</h3>
        <p className="small">
          Abrí la consulta oficial, poné el IMEI <strong>{t.imei1}</strong> y sacá una captura del resultado.
        </p>
        <div className="row">
          <a className="btn" href="https://www.enacom.gob.ar/imei" target="_blank" rel="noreferrer">
            Abrir ENACOM ↗
          </a>
          {draft && (
            <>
              <button className={t.enacomResult === 'CLEAN' ? 'primary' : ''} onClick={() => void patch({ enacomResult: 'CLEAN' })}>
                ✓ Sin denuncia
              </button>
              <button className={t.enacomResult === 'REPORTED' ? 'danger primary' : 'danger'} onClick={() => void patch({ enacomResult: 'REPORTED' })}>
                ✗ Denunciado
              </button>
            </>
          )}
        </div>
        {t.enacomResult && (
          <p className={t.enacomResult === 'CLEAN' ? 'ok small' : 'error'}>
            {t.enacomResult === 'CLEAN' ? 'Sin denuncia' : 'DENUNCIADO: no se puede tomar'} · consultó {t.enacomByName} el {dateTimeFmt(t.enacomAt!)}
          </p>
        )}
        <div className="grid2">
          <PhotoButton label="Captura de ENACOM" url={t.photos.enacom} upload={photo('enacom')} />
        </div>
      </div>

      <div className="card stack">
        <h3>Documento de quien vende</h3>
        <div className="grid2">
          <PhotoButton label="DNI frente" url={t.photos.dniFront} upload={photo('dniFront')} />
          <PhotoButton label="DNI dorso" url={t.photos.dniBack} upload={photo('dniBack')} />
          <PhotoButton label="Foto de la persona (opcional)" url={t.photos.selfie} upload={photo('selfie')} />
        </div>
      </div>

      <div className="card stack">
        <h3>Valor y declaración</h3>
        {suggest?.price != null && (
          <p className="small">
            Según la grilla: <strong>{usd(suggest.price)}</strong>
            {suggest.lowBattery ? ' (batería baja: −10 %)' : ''}{' '}
            {draft && (
              <button className="small" onClick={() => void patch({ offeredUsd: suggest.price })}>
                Usar
              </button>
            )}
          </p>
        )}
        <Field label="Valor de la toma (US$)">
          <input inputMode="decimal" disabled={!draft} defaultValue={t.offeredUsd || ''} onBlur={(e) => void patch({ offeredUsd: toNum(e.target.value) ?? 0 })} />
        </Field>
        <p className="small">
          “Declaro bajo juramento que el equipo {t.model} IMEI {t.imei1} es de mi propiedad, no tiene denuncia de robo ni pérdida y lo vendo libre de deudas.” — {t.customer.name}, DNI {t.customer.dni}
        </p>
        {draft ? <SignaturePad saved={t.photos.signature} onSave={(png) => uploadImage(`/tradeins/${t.id}/photo?kind=signature`, png, 'firma.png').then(refresh)} /> : t.photos.signature && <img src={t.photos.signature} alt="firma" style={{ maxHeight: 80 }} />}
      </div>

      {draft && (
        <div className="card stack">
          {t.missing.length > 0 && (
            <p className="warn small">
              Falta: {t.missing.map((m) => MISSING[m] ?? m).join(', ')}.
            </p>
          )}
          <div className="row">
            <button className="primary big" disabled={t.missing.length > 0} onClick={() => void accept()}>
              Aceptar y entrar al stock
            </button>
            <button className="danger" onClick={() => void reject()}>
              Rechazar
            </button>
          </div>
        </div>
      )}
      {t.serialItemId && (
        <Link className="btn" to={`/serials/${t.serialItemId}`}>
          Ver el equipo en el stock
        </Link>
      )}
    </div>
  );
}

/** Grilla para tasar usados: precio de toma en dólares por modelo y grado. */
export function TradeInPrices() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tradein-prices'], queryFn: () => api<{ productId: string; product: string; grade: string; price: number }[]>('/tradein-prices') });
  const [extra, setExtra] = useState<{ id: string; name: string }[]>([]);
  const rows = new Map<string, { name: string; A?: number; B?: number; C?: number }>();
  for (const r of q.data ?? []) rows.set(r.productId, { ...(rows.get(r.productId) ?? { name: r.product }), [r.grade]: r.price });
  for (const p of extra) if (!rows.has(p.id)) rows.set(p.id, { name: p.name });
  const save = async (productId: string, grade: string, v: string) => {
    try {
      await api('/tradein-prices', { method: 'PUT', body: { rows: [{ productId, grade, price: toNum(v) }] } });
      void qc.invalidateQueries({ queryKey: ['tradein-prices'] });
    } catch (e) {
      toast(errMsg(e));
    }
  };
  return (
    <div className="stack">
      <Link to="/tradeins">← Usados</Link>
      <h1>Grilla de precios de toma (US$)</h1>
      <p className="muted small">Cuánto se paga por un usado según el modelo y el grado. Se cambia y se guarda solo.</p>
      <ProductPicker placeholder="Agregar modelo" onPick={(p) => setExtra([...extra, { id: p.id, name: p.name }])} filter={(p) => p.serialized} />
      {q.isLoading && <Loading />}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Modelo</th>
              <th className="num">A</th>
              <th className="num">B</th>
              <th className="num">C</th>
            </tr>
          </thead>
          <tbody>
            {[...rows.entries()].map(([id, r]) => (
              <tr key={id}>
                <td>{r.name}</td>
                {(['A', 'B', 'C'] as const).map((g) => (
                  <td key={g} className="num">
                    <input style={{ width: 90 }} inputMode="decimal" defaultValue={r[g] ?? ''} onBlur={(e) => e.target.value !== String(r[g] ?? '') && void save(id, g, e.target.value)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

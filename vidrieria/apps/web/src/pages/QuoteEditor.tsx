import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  BASES,
  BASIS_LABEL,
  CATEGORIES,
  CATEGORY_LABEL,
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_LABEL,
  calcQuote,
  linesFromTemplate,
  type Basis,
  type CustomerType,
  type ItemInput,
  type LineInput,
  type QuoteSettings,
  type Unit,
} from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { ErrorBox, Field, Loading, NumInput, StatusChip, copyText, toast } from '../components/ui';
import { dateFmt, dollars, money, money2, qty } from '../lib/format';
import { useMe } from '../lib/me';
import type { CatalogItem, Customer, Lead, Quote, QuoteSettingsResponse, Template } from '../lib/types';
import { quoteMessage, quoteUrl, waLink } from '../lib/whatsapp';

const DEFAULT_BASIS: Record<Unit, Basis> = { M2: 'm2', ML: 'perimetro', UNIT: 'unidad', FIXED: 'fijo' };

function lineFromCatalog(c: CatalogItem, fixed = false): LineInput {
  return {
    catalogItemId: c.id,
    name: c.name,
    basis: fixed ? 'fijo' : DEFAULT_BASIS[c.unit],
    factor: 1,
    unitPrice: c.price,
    currency: c.currency,
    applyWaste: c.isGlass,
  };
}

/** Plantilla que mejor corresponde al tipo de trabajo que pidió el visitante. */
function templateForKind(kind: string, templates: Template[]) {
  const k = kind.toLowerCase();
  const pick = (re: RegExp) => templates.find((t) => re.test(t.name.toLowerCase()));
  if (/box/.test(k)) return pick(/box/);
  if (/mampara/.test(k)) return pick(/mampara/);
  if (/espejo/.test(k)) return pick(/espejo/);
  if (/cambio|roto/.test(k)) return pick(/cambio/);
  if (/baranda|escalera/.test(k)) return pick(/baranda|escalera/);
  if (/dvh|doble/.test(k)) return pick(/dvh/);
  return undefined;
}

interface NewCustomer {
  name: string;
  phone: string;
  type: CustomerType;
}

export default function QuoteEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const leadId = params.get('consulta');
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useMe();

  const settingsQ = useQuery({ queryKey: ['quote-settings'], queryFn: () => api<QuoteSettingsResponse>('/quote-settings') });
  const catalogQ = useQuery({ queryKey: ['catalog'], queryFn: () => api<CatalogItem[]>('/catalog') });
  const templatesQ = useQuery({ queryKey: ['templates'], queryFn: () => api<Template[]>('/templates') });
  const quoteQ = useQuery({ queryKey: ['quote', id], queryFn: () => api<Quote>(`/quotes/${id}`), enabled: !!id });
  const leadQ = useQuery({ queryKey: ['lead', leadId], queryFn: () => api<Lead>(`/leads/${leadId}`), enabled: !!leadId && !id });

  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState<NewCustomer | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemInput[]>([]);
  const [extras, setExtras] = useState<LineInput[]>([]);
  const [freightKm, setFreightKm] = useState(0);
  const [urgent, setUrgent] = useState(false);
  const [adjustPct, setAdjustPct] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [validDays, setValidDays] = useState<number | null>(null);
  const [useTodayDollar, setUseTodayDollar] = useState(false);
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);

  const catalog = catalogQ.data ?? [];
  const templates = templatesQ.data ?? [];

  // Carga inicial: presupuesto existente o consulta de la web.
  useEffect(() => {
    if (id && quoteQ.data && loadedFor !== id) {
      const q = quoteQ.data;
      setCustomer(q.customer);
      setNewCustomer(null);
      setTitle(q.title);
      setNotes(q.notes);
      setItems(q.input.items);
      setExtras(q.input.extras);
      setFreightKm(q.input.freightKm);
      setUrgent(q.input.urgent);
      setAdjustPct(q.input.adjustPct);
      setDiscount(q.input.discount);
      setValidDays(Math.max(1, Math.round((new Date(q.validUntil).getTime() - new Date(q.createdAt).getTime()) / 86_400_000)));
      setUseTodayDollar(false);
      setDirty(false);
      setLoadedFor(id);
    }
  }, [id, quoteQ.data, loadedFor]);

  useEffect(() => {
    if (!id && leadQ.data && templatesQ.data && catalogQ.data && loadedFor !== `lead:${leadId}`) {
      const l = leadQ.data;
      setTitle(l.kind);
      setNotes([l.details, l.when ? `Para: ${l.when}` : '', l.zone ? `Zona: ${l.zone}` : ''].filter(Boolean).join('\n'));
      const t = templateForKind(l.kind, templatesQ.data);
      const cat = catalogQ.data.map((c) => ({ ...c }));
      setItems([
        {
          title: l.kind,
          widthMm: l.widthCm ? Math.round(l.widthCm * 10) : (t?.defaultWidthMm ?? 1000),
          heightMm: l.heightCm ? Math.round(l.heightCm * 10) : (t?.defaultHeightMm ?? 1000),
          quantity: l.quantity ?? 1,
          lines: t ? linesFromTemplate(t.lines, cat) : [],
        },
      ]);
      void api<Customer[]>(`/customers?q=${encodeURIComponent(l.phone)}`).then((found) => {
        if (found[0]) setCustomer(found[0]);
        else setNewCustomer({ name: l.name, phone: l.phone, type: 'PARTICULAR' });
      });
      setLoadedFor(`lead:${leadId}`);
    }
  }, [id, leadId, leadQ.data, templatesQ.data, catalogQ.data, loadedFor]);

  const settings: QuoteSettings | null = useMemo(() => {
    if (!settingsQ.data) return null;
    if (quoteQ.data && !useTodayDollar) return { ...settingsQ.data.settings, dollarRate: quoteQ.data.settings.dollarRate };
    return settingsQ.data.settings;
  }, [settingsQ.data, quoteQ.data, useTodayDollar]);

  const result = useMemo(
    () => (settings ? calcQuote({ items, extras, freightKm, urgent, adjustPct, discount }, settings) : null),
    [items, extras, freightKm, urgent, adjustPct, discount, settings],
  );

  const setCustomerType = (type: CustomerType) => {
    setAdjustPct(settingsQ.data?.customerAdjust[type] ?? 0);
  };

  const save = useMutation({
    mutationFn: async () => {
      let customerId = customer?.id ?? null;
      if (!customerId && newCustomer?.name.trim()) {
        const c = await api<Customer>('/customers', { body: { name: newCustomer.name, phone: newCustomer.phone, type: newCustomer.type } });
        customerId = c.id;
        setCustomer(c);
        setNewCustomer(null);
      }
      const body = {
        customerId,
        leadId: id ? undefined : leadId,
        title,
        notes,
        items,
        extras,
        freightKm,
        urgent,
        adjustPct,
        discount,
        validDays: validDays ?? undefined,
      };
      return id
        ? api<Quote>(`/quotes/${id}${useTodayDollar ? '?recalcDollar=1' : ''}`, { method: 'PUT', body })
        : api<Quote>('/quotes', { body });
    },
    onSuccess: (q) => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['quote', q.id] });
      setLoadedFor(null);
      toast(id ? 'Cambios guardados' : `Presupuesto N° ${q.number} guardado`);
      if (!id) nav(`/panel/presupuestos/${q.id}`, { replace: true });
    },
    onError: (e) => toast(errMsg(e)),
  });

  if (settingsQ.isLoading || catalogQ.isLoading || templatesQ.isLoading || (id && quoteQ.isLoading)) return <Loading />;
  if (settingsQ.error || quoteQ.error) return <ErrorBox error={settingsQ.error ?? quoteQ.error} />;
  if (!settings || !result) return <Loading />;

  const q = quoteQ.data;
  const locked = q?.status === 'ACCEPTED';
  const updateItem = (i: number, patch: Partial<ItemInput>) => {
    setItems((all) => all.map((it, j) => (j === i ? { ...it, ...patch } : it)));
    touch();
  };
  const addFromTemplate = (t: Template | null) => {
    setItems((all) => [
      ...all,
      {
        title: t?.name ?? 'Trabajo',
        widthMm: t?.defaultWidthMm ?? 1000,
        heightMm: t?.defaultHeightMm ?? 1000,
        quantity: 1,
        lines: t ? linesFromTemplate(t.lines, catalog) : [],
      },
    ]);
    if (!title && t) setTitle(t.name);
    touch();
  };
  const dollar = settingsQ.data!.dollar;

  return (
    <div className="editor">
      <div className="page-head">
        <div>
          <Link to="/panel/presupuestos" className="muted small">
            ← Presupuestos
          </Link>
          <h1>
            {q ? `Presupuesto N° ${q.number}` : 'Nuevo presupuesto'} {q && <StatusChip status={q.status} />}
          </h1>
        </div>
      </div>

      <div className="editor-grid">
        <div className="stack">
          <section className="card">
            <h2>Cliente</h2>
            <CustomerPicker
              customer={customer}
              newCustomer={newCustomer}
              onPick={(c) => {
                setCustomer(c);
                setNewCustomer(null);
                if (c) setCustomerType(c.type);
                touch();
              }}
              onNew={(n) => {
                setNewCustomer(n);
                setCustomer(null);
                if (n) setCustomerType(n.type);
                touch();
              }}
            />
            <Field label="Trabajo (título)" wide>
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  touch();
                }}
                placeholder="Ej.: Mampara de baño"
              />
            </Field>
          </section>

          {items.map((it, i) => (
            <ItemCard
              key={i}
              item={it}
              index={i}
              settings={settings}
              result={result.items[i]}
              catalog={catalog}
              onChange={(patch) => updateItem(i, patch)}
              onRemove={() => {
                setItems((all) => all.filter((_, j) => j !== i));
                touch();
              }}
              onDuplicate={() => {
                setItems((all) => [...all.slice(0, i + 1), structuredClone(it), ...all.slice(i + 1)]);
                touch();
              }}
            />
          ))}

          <section className="card add-item">
            <h2>{items.length ? 'Agregar otro trabajo' : 'Agregar un trabajo'}</h2>
            <div className="template-grid">
              {templates.map((t) => (
                <button key={t.id} type="button" className="template-btn" onClick={() => addFromTemplate(t)}>
                  <strong>{t.name}</strong>
                  <span className="muted small">{t.description}</span>
                </button>
              ))}
              <button type="button" className="template-btn ghost" onClick={() => addFromTemplate(null)}>
                <strong>Trabajo vacío</strong>
                <span className="muted small">Cargás los ítems a mano</span>
              </button>
            </div>
          </section>

          <section className="card">
            <h2>Cargos del presupuesto</h2>
            <p className="muted small">Se cobran una vez, no por pieza: medición, retiro del vidrio viejo, etc.</p>
            <LinesTable
              lines={result.extras}
              settings={settings}
              catalog={catalog}
              fixed
              onChange={(lines) => {
                setExtras(lines);
                touch();
              }}
            />
            <div className="form-grid">
              <Field label="Traslado (km)" hint={settings.freightPerKm ? `${money2(settings.freightPerKm)} por km` : 'Configurá el $ por km en Ajustes'}>
                <NumInput
                  value={freightKm}
                  onChange={(v) => {
                    setFreightKm(v ?? 0);
                    touch();
                  }}
                />
              </Field>
              <Field label="Ajuste por cliente (%)" hint="Negativo = descuento. Se completa según el tipo de cliente.">
                <NumInput
                  value={adjustPct}
                  onChange={(v) => {
                    setAdjustPct(v ?? 0);
                    touch();
                  }}
                />
              </Field>
              <Field label="Descuento ($)">
                <NumInput
                  value={discount}
                  onChange={(v) => {
                    setDiscount(v ?? 0);
                    touch();
                  }}
                />
              </Field>
              <Field label="Vale por (días)">
                <NumInput value={validDays ?? settingsQ.data!.validDays} onChange={(v) => (setValidDays(v ? Math.round(v) : null), touch())} />
              </Field>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={urgent}
                onChange={(e) => {
                  setUrgent(e.target.checked);
                  touch();
                }}
              />
              Urgente o fuera de horario (+{qty(settings.urgencyPct)} %)
            </label>
            <Field label="Notas para el cliente" wide>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  touch();
                }}
                placeholder="Ej.: Incluye herrajes color negro. No incluye trabajos de albañilería."
              />
            </Field>
          </section>
        </div>

        <aside className="summary card" id="resumen">
          <h2>Total</h2>
          <dl className="totals">
            <dt>Trabajos</dt>
            <dd>{money(result.subtotal)}</dd>
            {!!result.adjust && (
              <>
                <dt>Ajuste cliente ({qty(adjustPct)} %)</dt>
                <dd>{money(result.adjust)}</dd>
              </>
            )}
            {!!result.urgency && (
              <>
                <dt>Urgencia</dt>
                <dd>{money(result.urgency)}</dd>
              </>
            )}
            {!!result.freight && (
              <>
                <dt>Traslado</dt>
                <dd>{money(result.freight)}</dd>
              </>
            )}
            {!!result.discount && (
              <>
                <dt>Descuento</dt>
                <dd>−{money(result.discount)}</dd>
              </>
            )}
            <dt className="grand">Total</dt>
            <dd className="grand" data-testid="total">
              {money(result.total)}
            </dd>
            <dt>Seña ({qty(settings.depositPct)} %)</dt>
            <dd>{money(result.deposit)}</dd>
            <dt>Saldo</dt>
            <dd>{money(result.balance)}</dd>
          </dl>
          <p className="muted small">
            {settings.pricesIncludeVat ? `IVA incluido (${money(result.vat)}).` : `Incluye IVA ${qty(settings.vatPct)} % (${money(result.vat)}).`} Equivale a {dollars(result.totalUsd)}.
          </p>
          <div className="dollar-box small">
            Dólar: <strong>{money2(settings.dollarRate)}</strong>
            {q && !useTodayDollar && settings.dollarRate !== dollar.rate && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setUseTodayDollar(true);
                  touch();
                }}
              >
                Usar el de hoy ({money2(dollar.rate)})
              </button>
            )}
            {dollar.fallback && <span className="muted block">No se pudo leer el dólar en internet: se usa el que cargaste en Ajustes.</span>}
          </div>

          {locked ? (
            <p className="note good">Aceptado el {dateFmt(q!.acceptedAt!)}. Para cambiarlo, duplicalo.</p>
          ) : (
            <button className="btn primary block" type="button" disabled={save.isPending || (!items.length && !extras.length)} onClick={() => save.mutate()}>
              {save.isPending ? 'Guardando…' : id ? (dirty ? 'Guardar cambios' : 'Guardado ✓') : 'Guardar presupuesto'}
            </button>
          )}
          {q && <ShareBox quote={q} dirty={dirty} businessName={me.data?.business.name ?? ''} />}
        </aside>
      </div>
      <div className="mobilebar">
        <span>
          <span className="muted small block">Total</span>
          <strong>{money(result.total)}</strong>
        </span>
        {locked ? (
          <a className="btn small" href="#resumen">
            Ver
          </a>
        ) : dirty || !id ? (
          <button className="btn primary" type="button" disabled={save.isPending || (!items.length && !extras.length)} onClick={() => save.mutate()}>
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        ) : (
          <a className="btn primary" href="#resumen">
            Enviar
          </a>
        )}
      </div>
    </div>
  );
}

function CustomerPicker({
  customer,
  newCustomer,
  onPick,
  onNew,
}: {
  customer: Customer | null;
  newCustomer: NewCustomer | null;
  onPick: (c: Customer | null) => void;
  onNew: (n: NewCustomer | null) => void;
}) {
  const [term, setTerm] = useState('');
  const found = useQuery({
    queryKey: ['customers', term],
    queryFn: () => api<Customer[]>(`/customers?q=${encodeURIComponent(term)}`),
    enabled: term.trim().length >= 2,
  });
  if (customer)
    return (
      <div className="picked">
        <div>
          <strong>{customer.name}</strong>
          <span className="muted small block">
            {CUSTOMER_TYPE_LABEL[customer.type]}
            {customer.phone && ` · ${customer.phone}`}
          </span>
        </div>
        <button type="button" className="link-btn" onClick={() => onPick(null)}>
          Cambiar
        </button>
      </div>
    );
  if (newCustomer)
    return (
      <div className="form-grid">
        <Field label="Nombre del cliente">
          <input value={newCustomer.name} onChange={(e) => onNew({ ...newCustomer, name: e.target.value })} autoFocus />
        </Field>
        <Field label="WhatsApp">
          <input value={newCustomer.phone} inputMode="tel" onChange={(e) => onNew({ ...newCustomer, phone: e.target.value })} placeholder="11 2345-6789" />
        </Field>
        <Field label="Tipo">
          <select value={newCustomer.type} onChange={(e) => onNew({ ...newCustomer, type: e.target.value as CustomerType })}>
            {CUSTOMER_TYPES.map((t) => (
              <option key={t} value={t}>
                {CUSTOMER_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <button type="button" className="link-btn" onClick={() => onNew(null)}>
          Buscar uno existente
        </button>
      </div>
    );
  return (
    <div className="picker">
      <input type="search" placeholder="Buscar cliente por nombre o teléfono" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar cliente" />
      {!!found.data?.length && (
        <ul className="picker-list">
          {found.data.slice(0, 6).map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c)}>
                <strong>{c.name}</strong> <span className="muted small">{c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn small" onClick={() => onNew({ name: term.match(/\d/) ? '' : term, phone: term.match(/\d/) ? term : '', type: 'PARTICULAR' })}>
        + Cliente nuevo
      </button>
    </div>
  );
}

function ItemCard({
  item,
  index,
  settings,
  result,
  catalog,
  onChange,
  onRemove,
  onDuplicate,
}: {
  item: ItemInput;
  index: number;
  settings: QuoteSettings;
  result: ReturnType<typeof calcQuote>['items'][number];
  catalog: CatalogItem[];
  onChange: (patch: Partial<ItemInput>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  return (
    <section className="card item-card" aria-label={`Trabajo ${index + 1}`}>
      <div className="item-head">
        <input className="item-title" value={item.title} onChange={(e) => onChange({ title: e.target.value })} aria-label="Nombre del trabajo" />
        <div className="row">
          <button type="button" className="link-btn small" onClick={onDuplicate}>
            Duplicar
          </button>
          <button type="button" className="link-btn small danger" onClick={onRemove}>
            Quitar
          </button>
        </div>
      </div>
      <div className="measures">
        <Field label="Ancho (mm)">
          <NumInput value={item.widthMm} onChange={(v) => onChange({ widthMm: v ?? 0 })} ariaLabel="Ancho en mm" />
        </Field>
        <span className="times" aria-hidden="true">
          ×
        </span>
        <Field label="Alto (mm)">
          <NumInput value={item.heightMm} onChange={(v) => onChange({ heightMm: v ?? 0 })} ariaLabel="Alto en mm" />
        </Field>
        <Field label="Cantidad">
          <NumInput value={item.quantity} onChange={(v) => onChange({ quantity: Math.max(1, Math.round(v ?? 1)) })} ariaLabel="Cantidad" />
        </Field>
        <p className="geo mono small">
          {qty(result.areaM2)} m² · {qty(result.perimeterMl)} ml de canto
          {settings.wastePct > 0 && <span className="muted"> · vidrio +{qty(settings.wastePct)} %</span>}
        </p>
      </div>
      <LinesTable lines={result.lines} settings={settings} catalog={catalog} onChange={(lines) => onChange({ lines })} />
      <p className="item-total">
        Subtotal <strong>{money(result.total)}</strong>
      </p>
    </section>
  );
}

function LinesTable({
  lines,
  settings,
  catalog,
  fixed,
  onChange,
}: {
  lines: ReturnType<typeof calcQuote>['extras'];
  settings: QuoteSettings;
  catalog: CatalogItem[];
  fixed?: boolean;
  onChange: (lines: LineInput[]) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const strip = (l: (typeof lines)[number]): LineInput => ({
    catalogItemId: l.catalogItemId,
    name: l.name,
    basis: l.basis,
    factor: l.factor,
    unitPrice: l.unitPrice,
    currency: l.currency,
    applyWaste: l.applyWaste,
    qtyOverride: l.qtyOverride ?? null,
    priceOverride: l.priceOverride ?? null,
  });
  const set = (i: number, patch: Partial<LineInput>) => onChange(lines.map((l, j) => (j === i ? { ...strip(l), ...patch } : strip(l))));
  const byCat = CATEGORIES.map((c) => ({ c, items: catalog.filter((i) => i.category === c) })).filter((g) => g.items.length);

  return (
    <div className="lines">
      {lines.map((l, i) => (
        <div key={i} className="line">
          <div className="line-name">
            <span>{l.name}</span>
            <button type="button" className="link-btn tiny" onClick={() => setOpen(open === i ? null : i)}>
              {fixed ? '' : BASIS_LABEL[l.basis]}
              {l.factor !== 1 && ` ×${qty(l.factor)}`}
              {l.applyWaste && ' +desp.'} ✎
            </button>
          </div>
          <label className="line-qty">
            <span className="sr">Cantidad</span>
            <NumInput value={l.qty} onChange={(v) => set(i, { qtyOverride: v })} className={l.qtyOverride != null ? 'overridden' : ''} />
            <span className="unit">{l.unit}</span>
          </label>
          <label className="line-price">
            <span className="sr">Precio unitario</span>
            <NumInput value={l.unitPriceArs} onChange={(v) => set(i, { priceOverride: v })} className={l.priceOverride != null ? 'overridden' : ''} />
            {l.currency === 'USD' && l.priceOverride == null && <span className="unit">US${qty(l.unitPrice)}</span>}
          </label>
          <span className="line-total num">{money(l.total)}</span>
          <button type="button" className="icon-btn" aria-label={`Quitar ${l.name}`} onClick={() => onChange(lines.filter((_, j) => j !== i).map(strip))}>
            ✕
          </button>
          {open === i && (
            <div className="line-detail">
              {!fixed && (
                <Field label="Se calcula por">
                  <select value={l.basis} onChange={(e) => set(i, { basis: e.target.value as Basis, qtyOverride: null })}>
                    {BASES.map((b) => (
                      <option key={b} value={b}>
                        {BASIS_LABEL[b]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label={fixed ? 'Cantidad' : 'Multiplicar por'}>
                <NumInput value={l.factor} onChange={(v) => set(i, { factor: v ?? 1, qtyOverride: null })} />
              </Field>
              {!fixed && (
                <label className="check">
                  <input type="checkbox" checked={l.applyWaste} onChange={(e) => set(i, { applyWaste: e.target.checked, qtyOverride: null })} />
                  Sumar desperdicio ({qty(settings.wastePct)} %)
                </label>
              )}
              {(l.qtyOverride != null || l.priceOverride != null) && (
                <button type="button" className="link-btn small" onClick={() => set(i, { qtyOverride: null, priceOverride: null })}>
                  Volver a lo calculado
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      <select
        className="add-line"
        value=""
        aria-label="Agregar ítem del catálogo"
        onChange={(e) => {
          const c = catalog.find((x) => x.id === e.target.value);
          if (c) onChange([...lines.map(strip), lineFromCatalog(c, fixed)]);
        }}
      >
        <option value="">+ Agregar ítem del catálogo…</option>
        {byCat.map((g) => (
          <optgroup key={g.c} label={CATEGORY_LABEL[g.c]}>
            {g.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function ShareBox({ quote, dirty, businessName }: { quote: Quote; dirty: boolean; businessName: string }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['quote', quote.id] });
    qc.invalidateQueries({ queryKey: ['quotes'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const sent = useMutation({ mutationFn: () => api(`/quotes/${quote.id}/sent`, { method: 'POST' }), onSuccess: refresh });
  const setStatus = useMutation({
    mutationFn: (status: 'ACCEPTED' | 'REJECTED' | 'SENT') => api(`/quotes/${quote.id}/status`, { body: { status } }),
    onSuccess: () => {
      refresh();
      toast('Estado actualizado');
    },
  });
  const dup = useMutation({
    mutationFn: () => api<Quote>(`/quotes/${quote.id}/duplicate`, { method: 'POST' }),
    onSuccess: (q) => {
      refresh();
      toast(`Copia guardada como N° ${q.number}`);
      nav(`/panel/presupuestos/${q.id}`);
    },
  });
  const del = useMutation({
    mutationFn: () => api(`/quotes/${quote.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      nav('/panel/presupuestos');
    },
    onError: (e) => toast(errMsg(e)),
  });
  const msg = quoteMessage({ ...quote, customer: quote.customer }, businessName);

  return (
    <div className="share">
      <h3>Enviar</h3>
      {dirty ? (
        <p className="note">Guardá los cambios para mandarlo.</p>
      ) : (
        <>
          <a className="btn wa block" href={waLink(quote.customer?.phone, msg)} target="_blank" rel="noreferrer" onClick={() => sent.mutate()}>
            Enviar por WhatsApp
          </a>
          <div className="row wrap">
            <button type="button" className="btn small" onClick={() => copyText(quoteUrl(quote.publicToken))}>
              Copiar link
            </button>
            <a className="btn small" href={`/p/${quote.publicToken}?preview=1`} target="_blank" rel="noreferrer">
              Ver como el cliente
            </a>
          </div>
        </>
      )}
      <div className="row wrap">
        {quote.status !== 'ACCEPTED' && (
          <button type="button" className="btn small" onClick={() => setStatus.mutate('ACCEPTED')}>
            Marcar aceptado
          </button>
        )}
        {quote.status !== 'REJECTED' && quote.status !== 'ACCEPTED' && (
          <button type="button" className="btn small" onClick={() => setStatus.mutate('REJECTED')}>
            No lo hizo
          </button>
        )}
        <button type="button" className="btn small" onClick={() => dup.mutate()}>
          Duplicar
        </button>
        {quote.status === 'DRAFT' && (
          <button type="button" className="btn small danger" onClick={() => del.mutate()}>
            Borrar
          </button>
        )}
      </div>
      <p className="muted small">
        {quote.viewedAt ? `El cliente lo abrió el ${dateFmt(quote.viewedAt)}.` : quote.sentAt ? 'Enviado; todavía no lo abrió.' : 'Todavía no se envió.'} Vence el {dateFmt(quote.validUntil)}.
      </p>
    </div>
  );
}

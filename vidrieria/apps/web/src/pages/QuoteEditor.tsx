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
  parsePieces,
  type Basis,
  type CustomerType,
  type ItemInput,
  type LineInput,
  type QuoteResult,
  type QuoteSettings,
} from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { PieceSketch } from '../components/PieceSketch';
import { ErrorBox, Field, Loading, Modal, NumInput, StatusChip, copyText, toast } from '../components/ui';
import { dateFmt, dateTimeFmt, dollars, money, money2, qty } from '../lib/format';
import { useMe } from '../lib/me';
import { itemFromSpec, lineFromCatalog, templateForKind } from '../lib/pieces';
import type { CatalogItem, Customer, Lead, Quote, QuoteSettingsResponse, Template } from '../lib/types';
import { quoteMessage, quoteUrl, waLink } from '../lib/whatsapp';

/** Una opción del presupuesto (simple / mejor / premium). Flete, urgencia y ajuste son comunes. */
interface Opt {
  label: string;
  items: ItemInput[];
  extras: LineInput[];
  discount: number;
}
const LETTERS = ['A', 'B', 'C'];
const emptyOpt = (): Opt => ({ label: '', items: [], extras: [], discount: 0 });

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
  const [opts, setOpts] = useState<Opt[]>([emptyOpt()]);
  const [active, setActive] = useState(0);
  const [freightKm, setFreightKm] = useState(0);
  const [urgent, setUrgent] = useState(false);
  const [adjustPct, setAdjustPct] = useState(0);
  const [pasting, setPasting] = useState(false);
  const [validDays, setValidDays] = useState<number | null>(null);
  const [useTodayDollar, setUseTodayDollar] = useState(false);
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);

  const catalog = catalogQ.data ?? [];
  const templates = templatesQ.data ?? [];

  // items, extras y descuento son los de la opción que se está viendo.
  const cur = opts[active] ?? opts[0];
  const { items, extras, discount } = cur;
  const patchCur = (fn: (o: Opt) => Opt) => setOpts((all) => all.map((o, i) => (i === active ? fn(o) : o)));
  const setItems = (v: ItemInput[] | ((a: ItemInput[]) => ItemInput[])) => patchCur((o) => ({ ...o, items: typeof v === 'function' ? v(o.items) : v }));
  const setExtras = (v: LineInput[]) => patchCur((o) => ({ ...o, extras: v }));
  const setDiscount = (n: number) => patchCur((o) => ({ ...o, discount: n }));

  // Carga inicial: presupuesto existente o consulta de la web.
  useEffect(() => {
    if (id && quoteQ.data && loadedFor !== id) {
      const q = quoteQ.data;
      setCustomer(q.customer);
      setNewCustomer(null);
      setTitle(q.title);
      setNotes(q.notes);
      setOpts(
        q.options?.length
          ? q.options.map((o) => ({ label: o.label, items: o.input.items, extras: o.input.extras, discount: o.input.discount }))
          : [{ label: '', items: q.input.items, extras: q.input.extras, discount: q.input.discount }],
      );
      setActive(q.chosenOption ?? 0);
      setFreightKm(q.input.freightKm);
      setUrgent(q.input.urgent);
      setAdjustPct(q.input.adjustPct);
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
      setActive(0);
      setOpts([
        {
          ...emptyOpt(),
          items: [
            {
          title: l.kind,
          widthMm: l.widthCm ? Math.round(l.widthCm * 10) : (t?.defaultWidthMm ?? 1000),
          heightMm: l.heightCm ? Math.round(l.heightCm * 10) : (t?.defaultHeightMm ?? 1000),
          quantity: l.quantity ?? 1,
          lines: t ? linesFromTemplate(t.lines, cat) : [],
            },
          ],
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

  const results = useMemo(
    () => (settings ? opts.map((o) => calcQuote({ items: o.items, extras: o.extras, discount: o.discount, freightKm, urgent, adjustPct }, settings)) : null),
    [opts, freightKm, urgent, adjustPct, settings],
  );
  const result = results?.[active] ?? results?.[0] ?? null;
  const emptyOptions = opts.some((o) => !o.items.length && !o.extras.length);

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
      const multi = opts.length > 1;
      const body = {
        customerId,
        leadId: id ? undefined : leadId,
        title,
        notes,
        items: opts[0].items,
        extras: opts[0].extras,
        discount: opts[0].discount,
        freightKm,
        urgent,
        adjustPct,
        validDays: validDays ?? undefined,
        options: multi ? opts.map((o, i) => ({ ...o, label: o.label.trim() || `Opción ${LETTERS[i]}` })) : null,
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
  const addOption = () => {
    setOpts((all) => {
      const named = all.map((o, i) => ({ ...o, label: o.label || `Opción ${LETTERS[i]}` }));
      return [...named, { ...structuredClone(cur), label: `Opción ${LETTERS[all.length]}` }];
    });
    setActive(opts.length);
    touch();
  };
  const removeOption = (i: number) => {
    setOpts((all) => all.filter((_, j) => j !== i));
    setActive(0);
    touch();
  };
  // Trae el costo del catálogo a las líneas que no lo tienen (presupuestos viejos o ítems recién costeados).
  const missingCosts = items.flatMap((it) => it.lines).concat(extras).filter((l) => l.unitCost == null && catalog.find((c) => c.id === l.catalogItemId)?.cost != null).length;
  const fillCosts = () => {
    const withCost = (l: LineInput): LineInput => (l.unitCost != null ? l : { ...l, unitCost: catalog.find((c) => c.id === l.catalogItemId)?.cost ?? null });
    patchCur((o) => ({ ...o, items: o.items.map((it) => ({ ...it, lines: it.lines.map(withCost) })), extras: o.extras.map(withCost) }));
    touch();
  };

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

          {!locked && (
            <section className={'card options-card' + (opts.length > 1 ? '' : ' compact')}>
              {opts.length > 1 ? (
                <>
                  <div className="row between">
                    <h2>Opciones para el cliente</h2>
                    {opts.length < 3 && (
                      <button type="button" className="link-btn small" onClick={addOption}>
                        + Otra opción
                      </button>
                    )}
                  </div>
                  <div className="opt-tabs" role="tablist">
                    {opts.map((o, i) => (
                      <button key={i} type="button" role="tab" aria-selected={i === active} className={'opt-tab' + (i === active ? ' on' : '')} onClick={() => setActive(i)}>
                        <span>{o.label || `Opción ${LETTERS[i]}`}</span>
                        <strong>{money(results?.[i]?.total)}</strong>
                      </button>
                    ))}
                  </div>
                  <div className="row wrap">
                    <Field label="Nombre de esta opción">
                      <input
                        value={cur.label}
                        maxLength={80}
                        placeholder="Ej.: Simple, Templado, Premium"
                        onChange={(e) => {
                          patchCur((o) => ({ ...o, label: e.target.value }));
                          touch();
                        }}
                      />
                    </Field>
                    <button type="button" className="link-btn small danger" onClick={() => removeOption(active)}>
                      Quitar esta opción
                    </button>
                  </div>
                  <p className="muted small">El cliente las ve una al lado de la otra y acepta la que elige. Flete, urgencia y ajuste son los mismos para todas.</p>
                </>
              ) : (
                <button type="button" className="link-btn" onClick={addOption}>
                  + Ofrecer otra opción (ej.: simple y premium)
                </button>
              )}
            </section>
          )}

          {!!q?.photoIds?.length && (
            <section className="card">
              <h2>Fotos de la medición</h2>
              <div className="photos">
                {q.photoIds.map((pid) => (
                  <a key={pid} href={`/api/assets/${pid}`} target="_blank" rel="noreferrer">
                    <img src={`/api/assets/${pid}`} alt="Foto de la medición" />
                  </a>
                ))}
              </div>
            </section>
          )}

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
              <button type="button" className="template-btn paste" onClick={() => setPasting(true)}>
                <strong>Pegar mensaje</strong>
                <span className="muted small">Pegás lo que mandó el cliente y armo los trabajos</span>
              </button>
            </div>
          </section>
          {pasting && (
            <PasteModal
              onClose={() => setPasting(false)}
              onAdd={(specs) => {
                const added = specs.map((p) => itemFromSpec(p, templates, catalog));
                setItems((all) => [...all, ...added]);
                if (!title && added[0]) setTitle(added.length === 1 ? added[0].title : `${added[0].title} y más`);
                touch();
                setPasting(false);
                toast(added.length === 1 ? 'Agregué 1 trabajo' : `Agregué ${added.length} trabajos`);
              }}
            />
          )}

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
              <Field label={opts.length > 1 ? `Descuento ($) · ${cur.label || `Opción ${LETTERS[active]}`}` : 'Descuento ($)'}>
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
          <h2>Total{opts.length > 1 && <span className="muted"> · {cur.label || `Opción ${LETTERS[active]}`}</span>}</h2>
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
          <ProfitBox result={result} missingCosts={locked ? 0 : missingCosts} onFillCosts={fillCosts} />

          {locked ? (
            <p className="note good">Aceptado el {dateFmt(q!.acceptedAt!)}. Para cambiarlo, duplicalo.</p>
          ) : (
            <button className="btn primary block" type="button" disabled={save.isPending || emptyOptions} onClick={() => save.mutate()}>
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
          <button className="btn primary" type="button" disabled={save.isPending || emptyOptions} onClick={() => save.mutate()}>
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
        {item.widthMm > 0 && item.heightMm > 0 && <PieceSketch widthMm={item.widthMm} heightMm={item.heightMm} quantity={item.quantity} size="sm" />}
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
    unitCost: l.unitCost ?? null,
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
    mutationFn: ({ status, option }: { status: 'ACCEPTED' | 'REJECTED' | 'SENT'; option?: number }) => api(`/quotes/${quote.id}/status`, { body: { status, option } }),
    onSuccess: () => {
      refresh();
      toast('Estado actualizado');
    },
  });
  const paid = useMutation({
    mutationFn: (v: boolean) => api(`/quotes/${quote.id}/deposit-paid`, { body: { paid: v } }),
    onSuccess: (_r, v) => {
      refresh();
      toast(v ? 'Seña cobrada ✓' : 'Listo');
    },
    onError: (e) => toast(errMsg(e)),
  });
  const pickOptions = quote.options && quote.chosenOption == null ? quote.options : null;
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
  const msg = quoteMessage({ ...quote, customer: quote.customer }, businessName, pickOptions?.map((o) => ({ label: o.label, total: o.result.total })));

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
      {quote.status === 'ACCEPTED' && (
        <div className={'deposit ' + (quote.depositPaidAt ? 'good' : quote.depositReportedAt ? 'warn' : '')}>
          {quote.depositPaidAt ? (
            <>
              <strong>Seña cobrada</strong> el {dateFmt(quote.depositPaidAt)} ({money(quote.deposit)}).{' '}
              <button type="button" className="link-btn small" onClick={() => paid.mutate(false)}>
                Deshacer
              </button>
            </>
          ) : quote.depositReportedAt ? (
            <>
              <strong>El cliente mandó el comprobante</strong> de la seña ({money(quote.deposit)}) el {dateTimeFmt(quote.depositReportedAt)}.
              <div className="row wrap">
                {quote.depositProofId && (
                  <a className="btn small" href={`/api/assets/${quote.depositProofId}`} target="_blank" rel="noreferrer">
                    Ver comprobante
                  </a>
                )}
                <button type="button" className="btn small primary" disabled={paid.isPending} onClick={() => paid.mutate(true)}>
                  Confirmar cobro
                </button>
              </div>
            </>
          ) : (
            <>
              Seña pendiente: {money(quote.deposit)}.{' '}
              <button type="button" className="link-btn small" disabled={paid.isPending} onClick={() => paid.mutate(true)}>
                Ya la cobré
              </button>
            </>
          )}
        </div>
      )}
      <div className="row wrap">
        {quote.status !== 'ACCEPTED' &&
          (pickOptions ? (
            pickOptions.map((o, i) => (
              <button key={i} type="button" className="btn small" onClick={() => setStatus.mutate({ status: 'ACCEPTED', option: i })}>
                Aceptó: {o.label}
              </button>
            ))
          ) : (
            <button type="button" className="btn small" onClick={() => setStatus.mutate({ status: 'ACCEPTED' })}>
              Marcar aceptado
            </button>
          ))}
        {quote.status !== 'REJECTED' && quote.status !== 'ACCEPTED' && (
          <button type="button" className="btn small" onClick={() => setStatus.mutate({ status: 'REJECTED' })}>
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
        {quote.viewCount
          ? `El cliente lo abrió ${quote.viewCount === 1 ? '1 vez' : `${quote.viewCount} veces`}${quote.lastViewedAt ? ` (la última, ${dateTimeFmt(quote.lastViewedAt)})` : ''}.`
          : quote.viewedAt
            ? `El cliente lo abrió el ${dateFmt(quote.viewedAt)}.`
            : quote.sentAt
              ? 'Enviado; todavía no lo abrió.'
              : 'Todavía no se envió.'}{' '}
        {quote.chosenOption != null && quote.options?.[quote.chosenOption] && `Eligió: ${quote.options[quote.chosenOption].label}. `}
        Vence el {dateFmt(quote.validUntil)}.
      </p>
    </div>
  );
}

/** Cuánto le queda: costo de los materiales cargados y ganancia estimada (el cliente nunca lo ve). */
function ProfitBox({ result, missingCosts, onFillCosts }: { result: QuoteResult; missingCosts: number; onFillCosts: () => void }) {
  const pct = result.total > 0 ? Math.round((result.profit / result.total) * 100) : 0;
  return (
    <div className="profit-box small">
      {result.costedLines ? (
        <>
          <span>
            Costo <strong>{money(result.cost)}</strong>
          </span>
          <span>
            Te quedan <strong className={result.profit < 0 ? 'bad' : 'good'}>{money(result.profit)}</strong> ({qty(pct)} %)
          </span>
          {result.costedLines < result.totalLines && (
            <span className="muted block">
              Estimada: {result.totalLines - result.costedLines} ítem(s) sin costo en <Link to="/panel/precios">Precios</Link>.
            </span>
          )}
        </>
      ) : (
        <span className="muted">
          Cargá el costo de tus materiales en <Link to="/panel/precios">Precios</Link> y acá vas a ver cuánto te queda.
        </span>
      )}
      {missingCosts > 0 && (
        <button type="button" className="link-btn small block" onClick={onFillCosts}>
          Tomar el costo del catálogo ({missingCosts} ítem{missingCosts > 1 ? 's' : ''})
        </button>
      )}
    </div>
  );
}

/** Pegar el mensaje del cliente (o lo dictado) y convertirlo en trabajos. */
function PasteModal({ onClose, onAdd }: { onClose: () => void; onAdd: (specs: (ReturnType<typeof parsePieces>[number] & { title: string })[]) => void }) {
  const [text, setText] = useState('');
  const found = useMemo(() => parsePieces(text), [text]);
  return (
    <Modal title="Pegar mensaje del cliente" onClose={onClose}>
      <p className="muted small">Copiá el mensaje de WhatsApp y pegalo acá. Busco medidas, cantidades, tipo de trabajo y espesor.</p>
      <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej.: Hola! necesito 2 vidrios de 50x70 de 4mm y un espejo de 1x1.5" autoFocus aria-label="Mensaje del cliente" />
      {text.trim() && !found.length && <p className="note">No encontré medidas. Tienen que estar como «50x70», «1,20 por 1,80» o «1200×1800».</p>}
      {!!found.length && (
        <ul className="paste-list">
          {found.map((p, i) => (
            <li key={i}>
              <PieceSketch widthMm={p.widthMm} heightMm={p.heightMm} quantity={p.quantity} size="sm" />
              <span>
                <strong>{p.label}</strong>
                <span className="mono small block">
                  {qty(p.widthMm)} × {qty(p.heightMm)} mm{p.quantity > 1 ? ` · ${p.quantity} u` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button type="button" className="btn primary" disabled={!found.length} onClick={() => onAdd(found.map((p) => ({ ...p, title: p.kind === 'vidrio' ? p.label : '' })))}>
          {found.length > 1 ? `Agregar ${found.length} trabajos` : 'Agregar trabajo'}
        </button>
      </div>
    </Modal>
  );
}

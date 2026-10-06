import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  BASES,
  BASIS_LABEL,
  CATEGORIES,
  CATEGORY_LABEL,
  CURRENCIES,
  UNITS,
  type Basis,
  type Category,
  type Currency,
  type Unit,
} from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Field, Loading, Modal, NumInput, toast } from '../components/ui';
import { dateFmt, price, qty } from '../lib/format';
import { useMe } from '../lib/me';
import { IMPORT_FIELDS, buildRows, guessMapping, readTable, type Cell, type ImportField, type ImportRow, type Mapping } from '../lib/sheet';
import type { CatalogItem, Template } from '../lib/types';

export const UNIT_LABEL: Record<Unit, string> = { M2: 'por m²', ML: 'por metro lineal', UNIT: 'por unidad', FIXED: 'fijo' };
type Tab = 'catalogo' | 'plantillas' | 'importar';

export default function Prices() {
  const [tab, setTab] = useState<Tab>('catalogo');
  const me = useMe();
  const owner = me.data?.user.role === 'OWNER';
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Precios</h1>
      </div>
      <div className="seg" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'catalogo'} className={tab === 'catalogo' ? 'on' : ''} onClick={() => setTab('catalogo')}>
          Catálogo
        </button>
        <button type="button" role="tab" aria-selected={tab === 'plantillas'} className={tab === 'plantillas' ? 'on' : ''} onClick={() => setTab('plantillas')}>
          Plantillas de trabajo
        </button>
        {owner && (
          <button type="button" role="tab" aria-selected={tab === 'importar'} className={tab === 'importar' ? 'on' : ''} onClick={() => setTab('importar')}>
            Importar lista del proveedor
          </button>
        )}
      </div>
      {tab === 'catalogo' && <Catalog owner={owner} />}
      {tab === 'plantillas' && <Templates owner={owner} />}
      {tab === 'importar' && owner && <Import onDone={() => setTab('catalogo')} />}
    </div>
  );
}

function Catalog({ owner }: { owner: boolean }) {
  const q = useQuery({ queryKey: ['catalog'], queryFn: () => api<CatalogItem[]>('/catalog') });
  const [edit, setEdit] = useState<Partial<CatalogItem> | null>(null);
  const [bulk, setBulk] = useState(false);
  const [term, setTerm] = useState('');
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const t = term.trim().toLowerCase();
  const items = q.data.filter((i) => !t || i.name.toLowerCase().includes(t));
  return (
    <>
      <div className="filters">
        <input type="search" placeholder="Buscar en el catálogo" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar en el catálogo" />
        {owner && (
          <div className="row wrap">
            <button className="btn" type="button" onClick={() => setBulk(true)}>
              Subir o bajar precios por %
            </button>
            <button className="btn primary" type="button" onClick={() => setEdit({ category: 'VIDRIO', unit: 'M2', currency: 'USD', isGlass: true })}>
              + Ítem
            </button>
          </div>
        )}
      </div>
      {CATEGORIES.map((c) => {
        const rows = items.filter((i) => i.category === c);
        if (!rows.length) return null;
        return (
          <section key={c} className="card flush">
            <h2 className="pad-h">{CATEGORY_LABEL[c]}</h2>
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {rows.map((i) => (
                    <tr key={i.id}>
                      <td>
                        {owner ? (
                          <button type="button" className="link-btn strong" onClick={() => setEdit(i)}>
                            {i.name}
                          </button>
                        ) : (
                          <strong>{i.name}</strong>
                        )}
                        {i.isGlass && <span className="muted small"> · suma desperdicio</span>}
                      </td>
                      <td className="muted small hide-sm">{UNIT_LABEL[i.unit]}</td>
                      <td className="num">{price(i.price, i.currency)}</td>
                      <td className="muted small hide-sm">{dateFmt(i.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {!items.length && <Empty>No hay ítems con ese nombre.</Empty>}
      {edit && <ItemForm value={edit} onClose={() => setEdit(null)} />}
      {bulk && <BulkPrice onClose={() => setBulk(false)} />}
    </>
  );
}

function ItemForm({ value, onClose }: { value: Partial<CatalogItem>; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    category: value.category ?? ('VIDRIO' as Category),
    name: value.name ?? '',
    thicknessMm: value.thicknessMm ?? null,
    unit: value.unit ?? ('M2' as Unit),
    price: value.price ?? 0,
    currency: value.currency ?? ('USD' as Currency),
    cost: value.cost ?? null,
    isGlass: value.isGlass ?? false,
  });
  const done = () => {
    qc.invalidateQueries({ queryKey: ['catalog'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => (value.id ? api(`/catalog/${value.id}`, { method: 'PATCH', body: f }) : api('/catalog', { body: f })),
    onSuccess: () => {
      toast('Guardado');
      done();
    },
    onError: (e) => toast(errMsg(e)),
  });
  const del = useMutation({ mutationFn: () => api(`/catalog/${value.id}`, { method: 'DELETE' }), onSuccess: done });
  return (
    <Modal title={value.id ? 'Editar ítem' : 'Nuevo ítem'} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Nombre" wide>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
        </Field>
        <Field label="Categoría">
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as Category, isGlass: e.target.value === 'VIDRIO' })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Se cobra">
          <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as Unit })}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABEL[u]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Precio">
          <NumInput value={f.price} onChange={(v) => setF({ ...f, price: v ?? 0 })} />
        </Field>
        <Field label="Moneda">
          <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as Currency })}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c === 'USD' ? 'Dólares' : 'Pesos'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Espesor (mm)">
          <NumInput value={f.thicknessMm} onChange={(v) => setF({ ...f, thicknessMm: v })} />
        </Field>
        <Field label="Costo (opcional)" hint="Para saber tu ganancia más adelante">
          <NumInput value={f.cost} onChange={(v) => setF({ ...f, cost: v })} />
        </Field>
        <label className="check wide">
          <input type="checkbox" checked={f.isGlass} onChange={(e) => setF({ ...f, isGlass: e.target.checked })} />
          Es vidrio: sumar el % de desperdicio
        </label>
        <div className="actions wide">
          <button className="btn primary" disabled={save.isPending}>
            Guardar
          </button>
          {value.id && (
            <button className="btn danger" type="button" onClick={() => del.mutate()}>
              Dar de baja
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

function BulkPrice({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [pct, setPct] = useState<number | null>(null);
  const [category, setCategory] = useState<Category | ''>('');
  const [currency, setCurrency] = useState<Currency | ''>('');
  const m = useMutation({
    mutationFn: () => api<{ updated: number }>('/catalog/bulk-price', { body: { pct, category: category || null, currency: currency || null } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['catalog'] });
      toast(`${r.updated} precios actualizados`);
      onClose();
    },
    onError: (e) => toast(errMsg(e)),
  });
  return (
    <Modal title="Subir o bajar precios" onClose={onClose}>
      <p className="muted">Útil cuando el proveedor sube la lista. Los presupuestos ya hechos no cambian.</p>
      <div className="form-grid">
        <Field label="Porcentaje" hint="Ej.: 8 sube 8 %, −5 baja 5 %">
          <NumInput value={pct} onChange={setPct} />
        </Field>
        <Field label="Categoría">
          <select value={category} onChange={(e) => setCategory(e.target.value as Category | '')}>
            <option value="">Todas</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Moneda">
          <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency | '')}>
            <option value="">Pesos y dólares</option>
            <option value="ARS">Solo en pesos</option>
            <option value="USD">Solo en dólares</option>
          </select>
        </Field>
      </div>
      <div className="actions">
        <button className="btn primary" type="button" disabled={!pct || m.isPending} onClick={() => m.mutate()}>
          Aplicar {pct ? `${pct > 0 ? '+' : ''}${qty(pct)} %` : ''}
        </button>
      </div>
    </Modal>
  );
}

function Templates({ owner }: { owner: boolean }) {
  const q = useQuery({ queryKey: ['templates'], queryFn: () => api<Template[]>('/templates') });
  const cat = useQuery({ queryKey: ['catalog'], queryFn: () => api<CatalogItem[]>('/catalog') });
  const [edit, setEdit] = useState<Partial<Template> | null>(null);
  if (q.isLoading || cat.isLoading) return <Loading />;
  const byId = new Map((cat.data ?? []).map((c) => [c.id, c]));
  return (
    <>
      <p className="muted">Cada plantilla es un trabajo típico. Al presupuestar elegís la plantilla, ponés ancho × alto y se calcula todo.</p>
      {owner && (
        <button className="btn primary" type="button" onClick={() => setEdit({ name: '', description: '', defaultWidthMm: 1000, defaultHeightMm: 1000, lines: [] })}>
          + Plantilla
        </button>
      )}
      <ul className="cards">
        {q.data?.map((t) => (
          <li key={t.id} className="card">
            <div className="row between">
              <strong>{t.name}</strong>
              {owner && (
                <button type="button" className="link-btn" onClick={() => setEdit(t)}>
                  Editar
                </button>
              )}
            </div>
            <p className="muted small">{t.description}</p>
            <ul className="mini-list small">
              {t.lines.map((l, i) => (
                <li key={i}>
                  {byId.get(l.catalogItemId)?.name ?? <span className="muted">(ítem dado de baja)</span>}
                  <span className="muted">
                    {' '}
                    · {BASIS_LABEL[l.basis]}
                    {l.factor !== 1 && ` ×${qty(l.factor)}`}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {edit && <TemplateForm value={edit} catalog={cat.data ?? []} onClose={() => setEdit(null)} />}
    </>
  );
}

function TemplateForm({ value, catalog, onClose }: { value: Partial<Template>; catalog: CatalogItem[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: value.name ?? '',
    description: value.description ?? '',
    defaultWidthMm: value.defaultWidthMm ?? 1000,
    defaultHeightMm: value.defaultHeightMm ?? 1000,
    lines: value.lines ?? [],
    sort: value.sort ?? 0,
  });
  const done = () => {
    qc.invalidateQueries({ queryKey: ['templates'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => (value.id ? api(`/templates/${value.id}`, { method: 'PUT', body: f }) : api('/templates', { body: f })),
    onSuccess: () => {
      toast('Plantilla guardada');
      done();
    },
    onError: (e) => toast(errMsg(e)),
  });
  const del = useMutation({ mutationFn: () => api(`/templates/${value.id}`, { method: 'DELETE' }), onSuccess: done });
  const setLine = (i: number, patch: Partial<Template['lines'][number]>) => setF({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const defaultBasis: Record<Unit, Basis> = { M2: 'm2', ML: 'perimetro', UNIT: 'unidad', FIXED: 'fijo' };
  return (
    <Modal title={value.id ? 'Editar plantilla' : 'Nueva plantilla'} onClose={onClose} wide>
      <div className="form-grid">
        <Field label="Nombre">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </Field>
        <Field label="Descripción">
          <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="Ancho de ejemplo (mm)">
          <NumInput value={f.defaultWidthMm} onChange={(v) => setF({ ...f, defaultWidthMm: Math.round(v ?? 0) })} />
        </Field>
        <Field label="Alto de ejemplo (mm)">
          <NumInput value={f.defaultHeightMm} onChange={(v) => setF({ ...f, defaultHeightMm: Math.round(v ?? 0) })} />
        </Field>
      </div>
      <h3>Qué lleva</h3>
      <div className="tpl-lines">
        {f.lines.map((l, i) => (
          <div key={i} className="tpl-line">
            <select value={l.catalogItemId} onChange={(e) => setLine(i, { catalogItemId: e.target.value })} aria-label="Ítem">
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select value={l.basis} onChange={(e) => setLine(i, { basis: e.target.value as Basis })} aria-label="Se calcula por">
              {BASES.map((b) => (
                <option key={b} value={b}>
                  {BASIS_LABEL[b]}
                </option>
              ))}
            </select>
            <NumInput value={l.factor} onChange={(v) => setLine(i, { factor: v ?? 1 })} ariaLabel="Multiplicar por" className="short" />
            <button type="button" className="icon-btn" aria-label="Quitar" onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        ))}
        <select
          className="add-line"
          value=""
          aria-label="Agregar ítem"
          onChange={(e) => {
            const c = catalog.find((x) => x.id === e.target.value);
            if (c) setF({ ...f, lines: [...f.lines, { catalogItemId: c.id, basis: defaultBasis[c.unit], factor: 1 }] });
          }}
        >
          <option value="">+ Agregar ítem…</option>
          {CATEGORIES.map((cat) => (
            <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
              {catalog
                .filter((c) => c.category === cat)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="actions">
        <button className="btn primary" type="button" disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>
          Guardar
        </button>
        {value.id && (
          <button className="btn danger" type="button" onClick={() => del.mutate()}>
            Borrar plantilla
          </button>
        )}
      </div>
    </Modal>
  );
}

const FIELD_LABEL: Record<ImportField, string> = {
  name: 'Descripción',
  price: 'Precio',
  currency: 'Moneda',
  unit: 'Unidad',
  category: 'Categoría',
  thickness: 'Espesor',
  cost: 'Costo',
};

function Import({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [table, setTable] = useState<Cell[][] | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [error, setError] = useState<unknown>(null);
  const parsed = table && mapping ? buildRows(table, mapping, currency) : null;
  const m = useMutation({
    mutationFn: (rows: ImportRow[]) =>
      api<{ created: number; updated: number }>('/catalog/import', {
        body: rows.map((r) => ({ name: r.name, price: r.price, currency: r.currency, unit: r.unit, category: r.category, thicknessMm: r.thicknessMm, cost: r.cost })),
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['catalog'] });
      toast(`Listo: ${r.created} nuevos y ${r.updated} actualizados`);
      onDone();
    },
    onError: setError,
  });
  return (
    <section className="card stack">
      <p>
        Subí la lista de precios de tu proveedor en <strong>Excel (.xlsx)</strong> o <strong>CSV</strong>. La primera fila tiene que tener los títulos (Descripción, Precio…). Si
        un ítem ya existe con el mismo nombre, se actualiza el precio.
      </p>
      <input
        type="file"
        accept=".xlsx,.xlsm,.csv,.txt"
        aria-label="Archivo de la lista"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setError(null);
          try {
            const t = await readTable(file);
            if (t.length < 2) throw new Error('La planilla está vacía.');
            setTable(t);
            setMapping(guessMapping(t[0]));
          } catch (err) {
            setError(err);
          }
        }}
      />
      <ErrorBox error={error} />
      {table && mapping && parsed && (
        <>
          <div className="form-grid">
            {IMPORT_FIELDS.map((f) => (
              <Field key={f} label={FIELD_LABEL[f]}>
                <select value={mapping[f]} onChange={(e) => setMapping({ ...mapping, [f]: Number(e.target.value) })}>
                  <option value={-1}>— no está —</option>
                  {table[0].map((h, i) => (
                    <option key={i} value={i}>
                      {String(h ?? `Columna ${i + 1}`)}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
            <Field label="Si no dice la moneda, es en">
              <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                <option value="USD">Dólares</option>
                <option value="ARS">Pesos</option>
              </select>
            </Field>
          </div>
          <p className="muted small">
            {parsed.rows.length} ítems para importar{parsed.skipped.length ? ` · ${parsed.skipped.length} filas sin nombre o precio se saltean` : ''}. Vista previa:
          </p>
          <div className="table-wrap">
            <table className="table small">
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th>Categoría</th>
                  <th>Se cobra</th>
                  <th className="num">Precio</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 12).map((r) => (
                  <tr key={r.row}>
                    <td>{r.name}</td>
                    <td>{CATEGORY_LABEL[r.category]}</td>
                    <td>{UNIT_LABEL[r.unit]}</td>
                    <td className="num">{price(r.price, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button className="btn primary" type="button" disabled={!parsed.rows.length || m.isPending} onClick={() => m.mutate(parsed.rows)}>
              {m.isPending ? 'Importando…' : `Importar ${parsed.rows.length} ítems`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

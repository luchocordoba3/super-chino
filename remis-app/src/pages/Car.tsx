import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckRunSheet, DocSheet, IncidentSheet, ItemSheet, ServiceSheet } from '../components/forms/car';
import { Icon } from '../components/icons';
import { Empty, Meter, Seg, toast } from '../components/ui';
import { db, newId } from '../db/db';
import type { CheckRun, DocumentRec, Incident, MaintItem, ServiceLog } from '../db/types';
import { pendingProblems } from '../domain/checks';
import { dayKey } from '../domain/dates';
import { type DocState, docStatus } from '../domain/documents';
import { type MaintState, type MaintStatus, byUrgency, maintStatus } from '../domain/maintenance';
import { useData } from '../lib/data';
import { dateTimeFmt, dayFmt, daysText, kmFmt, money } from '../lib/format';

const TABS = [
  { id: 'mantenimiento', label: 'Service' },
  { id: 'papeles', label: 'Papeles' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'siniestros', label: 'Siniestros' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export function Car() {
  const { tab = 'mantenimiento' } = useParams();
  const nav = useNavigate();
  const current = (TABS.some((t) => t.id === tab) ? tab : 'mantenimiento') as Tab;
  return (
    <div className="stack">
      <h1>Auto</h1>
      <Seg label="Secciones del auto" options={TABS.map((t) => ({ id: t.id, label: t.label }))} value={current} onChange={(t) => nav(`/auto/${t}`, { replace: true })} />
      {current === 'mantenimiento' && <Maintenance />}
      {current === 'papeles' && <Documents />}
      {current === 'checklist' && <Checklist />}
      {current === 'siniestros' && <Incidents />}
    </div>
  );
}

const MAINT_BADGE: Record<MaintState, string> = { due: 'Toca', soon: 'Se acerca', ok: 'Al día', unknown: 'Sin dato' };

function maintText(st: MaintStatus) {
  if (st.state === 'unknown') return 'Tocá para cargar cuándo lo hiciste la última vez';
  const parts: string[] = [];
  if (st.kmLeft != null)
    parts.push(st.kmLeft > 0 ? `Faltan ${kmFmt(st.kmLeft)} (a los ${kmFmt(st.nextKm)})${st.etaDays != null ? `, unos ${daysText(st.etaDays)}` : ''}` : `Te pasaste ${kmFmt(-st.kmLeft)}`);
  if (st.daysLeft != null) parts.push(st.daysLeft > 0 ? `Hasta el ${dayFmt(st.nextDate)}` : `Venció el ${dayFmt(st.nextDate)}`);
  return parts.join(' · ');
}

function Maintenance() {
  const d = useData();
  const [item, setItem] = useState<MaintItem | 'new' | null>(null);
  const [service, setService] = useState<ServiceLog | 'new' | null>(null);
  const today = dayKey(d.now);
  const rows = d.items.filter((i) => i.enabled).map((i) => ({ item: i, st: maintStatus(i, d.services, d.km, d.kmRate, today) })).sort(byUrgency);
  const off = d.items.filter((i) => !i.enabled);
  const names = new Map(d.items.map((i) => [i.id, i.name]));
  const services = [...d.services].sort((a, b) => b.date.localeCompare(a.date) || b.km - a.km);
  return (
    <>
      <section className="card stack">
        <div>
          <div className="label">Km actual</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 750 }}>{kmFmt(d.km)}</div>
          {d.kmRate && <div className="muted small">El auto hace unos {kmFmt(Math.round(d.kmRate))} por día</div>}
        </div>
        <button type="button" className="primary" onClick={() => setService('new')}>
          <Icon name="wrench" /> Registrar service
        </button>
      </section>
      <div className="list">
        {rows.map(({ item: i, st }) => (
          <button key={i.id} type="button" className="item maint" onClick={() => setItem(i)}>
            <div className="row between">
              <span className="t">{i.name}</span>
              <span className={`badge ${st.state}`}>{MAINT_BADGE[st.state]}</span>
            </div>
            {st.state !== 'unknown' && <Meter value={st.progress} state={st.state} label={`${i.name}: cuánto se usó`} />}
            <div className="d" style={{ marginTop: 6 }}>
              {maintText(st)}
            </div>
          </button>
        ))}
        {!rows.length && <Empty text="No estás siguiendo nada. Agregá un ítem." />}
      </div>
      <button type="button" onClick={() => setItem('new')}>
        <Icon name="plus" /> Agregar ítem
      </button>
      {off.length > 0 && (
        <details>
          <summary>No seguidos ({off.length})</summary>
          <div className="list">
            {off.map((i) => (
              <button key={i.id} type="button" className="item" onClick={() => setItem(i)}>
                <span className="t">{i.name}</span>
              </button>
            ))}
          </div>
        </details>
      )}
      <div className="section-title">
        <h2>Services hechos</h2>
      </div>
      <div className="list">
        {services.map((s) => (
          <button key={s.id} type="button" className="item" onClick={() => setService(s)}>
            <span className="grow">
              <div className="t">
                {dayFmt(s.date)} · {kmFmt(s.km)}
              </div>
              <div className="d">{[s.itemIds.map((id) => names.get(id)).filter(Boolean).join(', '), s.shop, s.note].filter(Boolean).join(' · ')}</div>
            </span>
            {s.cost > 0 && <span className="amt">{money(s.cost)}</span>}
          </button>
        ))}
        {!services.length && <Empty text="Cuando hagas un service, anotalo acá y el plan se actualiza solo." />}
      </div>
      {item && <ItemSheet item={item === 'new' ? undefined : item} onClose={() => setItem(null)} />}
      {service && <ServiceSheet service={service === 'new' ? undefined : service} onClose={() => setService(null)} />}
    </>
  );
}

const DOC_BADGE: Record<DocState, { cls: string; label: string }> = {
  expired: { cls: 'due', label: 'Vencido' },
  soon: { cls: 'soon', label: 'Por vencer' },
  ok: { cls: 'ok', label: 'Al día' },
  unknown: { cls: '', label: 'Sin fecha' },
};
const DOC_RANK: Record<DocState, number> = { expired: 0, soon: 1, unknown: 2, ok: 3 };

function Documents() {
  const d = useData();
  const [doc, setDoc] = useState<DocumentRec | 'new' | null>(null);
  const today = dayKey(d.now);
  const rows = d.docs
    .map((x) => ({ doc: x, st: docStatus(x, today) }))
    .sort((a, b) => DOC_RANK[a.st.state] - DOC_RANK[b.st.state] || (a.st.daysLeft ?? 0) - (b.st.daysLeft ?? 0));
  return (
    <>
      <div className="list">
        {rows.map(({ doc: x, st }) => (
          <button key={x.id} type="button" className="item" onClick={() => setDoc(x)}>
            <span className="ic">
              <Icon name="doc" />
            </span>
            <span className="grow">
              <div className="t">{x.name}</div>
              <div className="d">
                {st.daysLeft == null
                  ? 'Tocá para cargar el vencimiento'
                  : st.daysLeft < 0
                    ? `Venció el ${dayFmt(x.expires)} (hace ${daysText(-st.daysLeft)})`
                    : st.daysLeft === 0
                      ? 'Vence hoy'
                      : `Vence el ${dayFmt(x.expires)} (faltan ${daysText(st.daysLeft)})`}
              </div>
            </span>
            <span className={`badge ${DOC_BADGE[st.state].cls}`}>{DOC_BADGE[st.state].label}</span>
          </button>
        ))}
        {!rows.length && <Empty text="No cargaste papeles todavía." />}
      </div>
      <button type="button" onClick={() => setDoc('new')}>
        <Icon name="plus" /> Agregar papel
      </button>
      <p className="hint">En cada papel podés agregar el vencimiento al calendario del celular para que te avise aunque no abras la app.</p>
      {doc && <DocSheet doc={doc === 'new' ? undefined : doc} onClose={() => setDoc(null)} />}
    </>
  );
}

function Checklist() {
  const d = useData();
  const [running, setRunning] = useState(false);
  const [label, setLabel] = useState('');
  const problems = pendingProblems(d.checkItems, d.checks);
  const runs = [...d.checks].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  const names = new Map(d.checkItems.map((i) => [i.id, i.label]));
  const items = [...d.checkItems].sort((a, b) => a.order - b.order);
  const fix = async (run: CheckRun, itemId: string) => {
    await db.checks.update(run.id, { fixed: [...(run.fixed ?? []), itemId] });
    toast('Listo, arreglado');
  };
  const addItem = async () => {
    if (!label.trim()) return;
    await db.checkItems.add({ id: newId(), label: label.trim(), order: items.length, enabled: true });
    setLabel('');
  };
  return (
    <>
      <button type="button" className="primary big" onClick={() => setRunning(true)}>
        <Icon name="check" /> Hacer el checklist ahora
      </button>
      {problems.length > 0 && (
        <>
          <div className="section-title">
            <h2>Para arreglar</h2>
          </div>
          <div className="list">
            {problems.map((p) => (
              <div key={p.item.id} className="item">
                <span className="grow">
                  <div className="t">{p.item.label}</div>
                  <div className="d">{[p.note, `desde el ${dayFmt(dayKey(p.run.at))}`].filter(Boolean).join(' · ')}</div>
                </span>
                <button type="button" className="small" onClick={() => void fix(p.run, p.item.id)}>
                  Ya lo arreglé
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="section-title">
        <h2>Últimos</h2>
      </div>
      <div className="list">
        {runs.map((r) => {
          const bad = Object.entries(r.results).filter(([, v]) => v === 'mal');
          return (
            <div key={r.id} className="item">
              <span className="grow">
                <div className="t">{dateTimeFmt(r.at)}</div>
                <div className="d">{bad.length ? `Con problema: ${bad.map(([k]) => names.get(k) ?? '—').join(', ')}` : 'Todo bien'}</div>
              </span>
              <span className={`badge ${bad.length ? 'soon' : 'ok'}`}>{bad.length ? `${bad.length} mal` : 'OK'}</span>
            </div>
          );
        })}
        {!runs.length && <Empty text="Todavía no hiciste ninguno." />}
      </div>
      <details>
        <summary>Qué se revisa</summary>
        <div className="list">
          {items.map((i) => (
            <div key={i.id} className="item">
              <input type="checkbox" aria-label={`Revisar ${i.label}`} checked={i.enabled} onChange={(e) => void db.checkItems.update(i.id, { enabled: e.target.checked })} />
              <span className="grow">{i.label}</span>
              <button type="button" className="ghost small" aria-label={`Sacar ${i.label}`} onClick={() => confirm(`¿Sacar "${i.label}" de la lista?`) && void db.checkItems.delete(i.id)}>
                <Icon name="x" />
              </button>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8, flexWrap: 'nowrap' }}>
          <input aria-label="Nuevo ítem del checklist" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ej.: Cinturones" />
          <button type="button" onClick={() => void addItem()}>
            Agregar
          </button>
        </div>
      </details>
      {running && <CheckRunSheet onClose={() => setRunning(false)} />}
    </>
  );
}

function Incidents() {
  const d = useData();
  const [inc, setInc] = useState<Incident | 'new' | null>(null);
  const rows = [...d.incidents].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <>
      <details className="card">
        <summary>Qué hacer si chocás</summary>
        <ol className="guide">
          <li>Pará, poné las balizas y fijate si hay heridos. Si hay, llamá al 107 (emergencias médicas) o al 911.</li>
          <li>Si no es peligroso, no muevas los autos hasta sacar fotos.</li>
          <li>Sacá fotos de los dos autos, las patentes, los daños, la calle y las señales.</li>
          <li>Pedile al otro: nombre, DNI, teléfono, patente, aseguradora y número de póliza.</li>
          <li>Anotá testigos con su teléfono.</li>
          <li>No firmes nada ni te hagas cargo en el momento.</li>
          <li>Hacé la denuncia a tu seguro dentro de los 3 días.</li>
          <li>Avisale a la agencia.</li>
        </ol>
      </details>
      <button type="button" className="primary big" onClick={() => setInc('new')}>
        <Icon name="crash" /> Registrar siniestro
      </button>
      <div className="list">
        {rows.map((x) => (
          <button key={x.id} type="button" className="item" onClick={() => setInc(x)}>
            <span className="grow">
              <div className="t">{dateTimeFmt(x.at)}</div>
              <div className="d">{[x.place, x.description].filter(Boolean).join(' · ') || 'Sin detalle'}</div>
            </span>
            <span className={`badge ${x.closed ? 'ok' : !x.insurerNotified ? 'due' : 'soon'}`}>{x.closed ? 'Cerrado' : !x.insurerNotified ? 'Falta denuncia' : 'Abierto'}</span>
          </button>
        ))}
        {!rows.length && <Empty text="Ojalá nunca tengas que usar esto." />}
      </div>
      {inc && <IncidentSheet incident={inc === 'new' ? undefined : inc} onClose={() => setInc(null)} />}
    </>
  );
}

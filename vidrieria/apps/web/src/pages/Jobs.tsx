import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../api';
import { Qr } from '../components/Qr';
import { Empty, ErrorBox, Field, Loading, Modal, NumInput, copyText, toast } from '../components/ui';
import { dateFmt, dayMonth, dayName, hourFmt, mapsUrl, money, toLocalInput } from '../lib/format';
import type { Breakage, Crew, Job, JobStatus } from '../lib/types';
import { confirmTurnMessage, crewMessage, crewUrl, delayMessage, onTheWayMessage, waLink, warrantyUrl } from '../lib/whatsapp';

export const JOB_STATUS: { key: JobStatus; label: string; next?: string }[] = [
  { key: 'PENDING', label: 'Por pedir', next: 'Ya lo pedí al proveedor' },
  { key: 'ORDERED', label: 'Pedido al proveedor', next: 'Está en fabricación' },
  { key: 'MAKING', label: 'En fabricación', next: 'Llegó el material' },
  { key: 'RECEIVED', label: 'Listo para colocar' },
  { key: 'SCHEDULED', label: 'Agendado', next: 'Colocado' },
  { key: 'INSTALLED', label: 'Colocado, falta cobrar', next: 'Cobrado: cerrar' },
  { key: 'CLOSED', label: 'Terminado' },
];
const label = (s: JobStatus) => JOB_STATUS.find((x) => x.key === s)!.label;
const nextOf = (s: JobStatus): JobStatus | null => {
  if (s === 'RECEIVED') return null;
  const i = JOB_STATUS.findIndex((x) => x.key === s);
  return JOB_STATUS[i + 1]?.key ?? null;
};
export const isLate = (j: Pick<Job, 'status' | 'promisedAt'>) => !!j.promisedAt && (j.status === 'ORDERED' || j.status === 'MAKING') && new Date(j.promisedAt).getTime() < Date.now();

const TABS = ['Tablero', 'Agenda', 'Equipos', 'Roturas'] as const;

export default function Jobs() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Tablero');
  const open = params.get('ver');
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<Job[]>('/jobs') });
  const crews = useQuery({ queryKey: ['crews'], queryFn: () => api<Crew[]>('/crews') });
  const setOpen = (id: string | null) => setParams(id ? { ver: id } : {}, { replace: true });

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Trabajos</h1>
          <p className="muted small">Cada presupuesto aceptado, desde el pedido al proveedor hasta el cobro.</p>
        </div>
      </div>
      <div className="seg" role="tablist">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <ErrorBox error={jobs.error} />
      {jobs.isLoading ? (
        <Loading />
      ) : tab === 'Tablero' ? (
        <Board jobs={jobs.data ?? []} onOpen={setOpen} />
      ) : tab === 'Agenda' ? (
        <Agenda jobs={jobs.data ?? []} crews={crews.data ?? []} onOpen={setOpen} />
      ) : tab === 'Equipos' ? (
        <Crews crews={crews.data ?? []} />
      ) : (
        <Breakages />
      )}
      {open && <JobModal id={open} crews={crews.data ?? []} onClose={() => setOpen(null)} />}
    </div>
  );
}

function JobCard({ j, onOpen }: { j: Job; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="card job-card" onClick={() => onOpen(j.id)} style={j.crew ? { borderLeftColor: j.crew.color } : undefined}>
      <span className="row between">
        <strong>{j.quote.customer?.name ?? 'Sin cliente'}</strong>
        <span className="mono muted small nowrap">N° {j.quote.number}</span>
      </span>
      <span className="muted small">{j.quote.title || 'Trabajo'}</span>
      <span className="row wrap job-flags">
        {isLate(j) && <span className="pill">Se atrasa</span>}
        {!j.quote.depositPaidAt && j.status === 'PENDING' && <span className="pill">Sin seña cobrada</span>}
        {j.needsFactory && (j.status === 'PENDING' || j.status === 'ORDERED' || j.status === 'MAKING') && <span className="pill neutral">Templado</span>}
        {j.promisedAt && (j.status === 'ORDERED' || j.status === 'MAKING') && <span className="small muted">llega {dayMonth(j.promisedAt)}</span>}
        {j.scheduledAt && (
          <span className="small">
            {dayName(j.scheduledAt)} {hourFmt(j.scheduledAt)}
            {j.crew && ` · ${j.crew.name}`}
          </span>
        )}
      </span>
    </button>
  );
}

function Board({ jobs, onOpen }: { jobs: Job[]; onOpen: (id: string) => void }) {
  if (!jobs.length) return <Empty>Todavía no hay trabajos. Se crean solos cuando un cliente acepta un presupuesto.</Empty>;
  return (
    <div className="board">
      {JOB_STATUS.map((s) => {
        const list = jobs.filter((j) => j.status === s.key).slice(0, s.key === 'CLOSED' ? 8 : 100);
        if (!list.length && s.key === 'CLOSED') return null;
        return (
          <section key={s.key} className="board-col" aria-label={s.label}>
            <h2>
              {s.label} <span className="muted">{list.length}</span>
            </h2>
            {list.map((j) => (
              <JobCard key={j.id} j={j} onOpen={onOpen} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

const startOfWeek = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function Agenda({ jobs, crews, onOpen }: { jobs: Job[]; crews: Crew[]; onOpen: (id: string) => void }) {
  const [week, setWeek] = useState(() => startOfWeek(new Date()));
  const days = Array.from({ length: 6 }, (_, i) => new Date(week.getTime() + i * 86_400_000));
  const rows: { id: string | null; name: string; color: string }[] = [...crews.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, color: c.color })), { id: null, name: 'Sin equipo', color: '#94a3b8' }];
  const scheduled = jobs.filter((j) => j.scheduledAt);
  const shift = (n: number) => setWeek(new Date(week.getTime() + n * 7 * 86_400_000));
  return (
    <section className="card agenda">
      <div className="row between wrap">
        <h2>Semana del {dayMonth(days[0])}</h2>
        <div className="row">
          <button type="button" className="btn small" onClick={() => shift(-1)} aria-label="Semana anterior">
            ←
          </button>
          <button type="button" className="btn small" onClick={() => setWeek(startOfWeek(new Date()))}>
            Hoy
          </button>
          <button type="button" className="btn small" onClick={() => shift(1)} aria-label="Semana siguiente">
            →
          </button>
        </div>
      </div>
      {!crews.length && (
        <p className="note">
          Cargá tus equipos en la pestaña <strong>Equipos</strong> para ver la agenda de cada uno.
        </p>
      )}
      <div className="agenda-scroll">
        <table className="agenda-table">
          <thead>
            <tr>
              <th />
              {days.map((d) => (
                <th key={d.toISOString()} className={sameDay(d, new Date()) ? 'today' : ''}>
                  {dayName(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id ?? 'none'}>
                <th scope="row">
                  <span className="crew-dot" style={{ background: r.color }} /> {r.name}
                </th>
                {days.map((d) => (
                  <td key={d.toISOString()} className={sameDay(d, new Date()) ? 'today' : ''}>
                    {scheduled
                      .filter((j) => (j.crewId ?? null) === r.id && sameDay(new Date(j.scheduledAt!), d))
                      .map((j) => (
                        <button key={j.id} type="button" className="agenda-job" style={{ borderLeftColor: r.color }} onClick={() => onOpen(j.id)}>
                          <strong>{hourFmt(j.scheduledAt!)}</strong> {j.quote.customer?.name ?? `N° ${j.quote.number}`}
                          <span className="block muted">{j.quote.title}</span>
                        </button>
                      ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function JobModal({ id, crews, onClose }: { id: string; crews: Crew[]; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['job', id], queryFn: () => api<Job & { breakages: Breakage[]; quote: Job['quote'] & { notes: string } }>(`/jobs/${id}`) });
  const [sched, setSched] = useState<{ at: string; crewId: string } | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['jobs'] });
    qc.invalidateQueries({ queryKey: ['job', id] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const status = useMutation({
    mutationFn: (s: JobStatus) => api(`/jobs/${id}/status`, { body: { status: s } }),
    onSuccess: () => (refresh(), toast('Listo')),
    onError: (e) => toast(errMsg(e)),
  });
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/jobs/${id}`, { method: 'PATCH', body }),
    onSuccess: () => (refresh(), toast('Guardado')),
    onError: (e) => toast(errMsg(e)),
  });
  const sent = (kind: string) => void api(`/jobs/${id}/sent`, { body: { kind } }).then(refresh);
  if (!q.data) return null;
  const j = q.data;
  const s = sched ?? { at: toLocalInput(j.scheduledAt), crewId: j.crewId ?? '' };
  const next = nextOf(j.status);
  const phone = j.quote.customer?.phone;
  const nextLabel = JOB_STATUS.find((x) => x.key === j.status)?.next;

  return (
    <Modal title={`${j.quote.customer?.name ?? 'Trabajo'} · N° ${j.quote.number}`} onClose={onClose} wide>
      <p className="muted">
        {j.quote.title} · {money(j.quote.total)} ·{' '}
        <Link to={`/panel/presupuestos/${j.quote.id}`} onClick={onClose}>
          ver presupuesto
        </Link>
      </p>
      <ol className="stepper" aria-label="Estado">
        {JOB_STATUS.map((x, i) => (
          <li key={x.key} className={x.key === j.status ? 'on' : JOB_STATUS.findIndex((y) => y.key === j.status) > i ? 'done' : ''}>
            <button type="button" onClick={() => x.key !== j.status && status.mutate(x.key)} title={`Pasar a: ${x.label}`}>
              {x.label}
            </button>
          </li>
        ))}
      </ol>
      {isLate(j) && <p className="note">Se atrasa: el proveedor lo prometía para el {dateFmt(j.promisedAt!)}.</p>}
      {j.status === 'PENDING' && !j.quote.depositPaidAt && <p className="note">Todavía no cobraste la seña. Conviene esperarla antes de pedir el {j.needsFactory ? 'templado' : 'material'}.</p>}
      <div className="row wrap">
        {next && nextLabel && (
          <button type="button" className="btn primary" disabled={status.isPending} onClick={() => status.mutate(next)}>
            {nextLabel}
          </button>
        )}
        {j.status === 'RECEIVED' && <span className="muted small">Agendalo abajo: elegí el día y el equipo.</span>}
      </div>
      <dl className="dl two">
        <dt>Pedido</dt>
        <dd>{j.orderedAt ? dateFmt(j.orderedAt) : '—'}</dd>
        <dt>Llega</dt>
        <dd>
          <input
            type="date"
            aria-label="Fecha prometida por el proveedor"
            value={j.promisedAt ? toLocalInput(j.promisedAt).slice(0, 10) : ''}
            onChange={(e) => e.target.value && patch.mutate({ promisedAt: new Date(`${e.target.value}T12:00:00`).toISOString() })}
          />
        </dd>
        <dt>Colocado</dt>
        <dd>{j.installedAt ? dateFmt(j.installedAt) : '—'}</dd>
      </dl>

      <section className="sub">
        <h3>Agenda</h3>
        <div className="form-grid">
          <Field label="Día y hora">
            <input type="datetime-local" value={s.at} onChange={(e) => setSched({ ...s, at: e.target.value })} />
          </Field>
          <Field label="Equipo">
            <select value={s.crewId} onChange={(e) => setSched({ ...s, crewId: e.target.value })}>
              <option value="">Sin equipo</option>
              {crews.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {sched && (
          <button
            type="button"
            className="btn small primary"
            onClick={() => {
              patch.mutate({ scheduledAt: s.at ? new Date(s.at).toISOString() : null, crewId: s.crewId || null });
              setSched(null);
            }}
          >
            Guardar agenda
          </button>
        )}
      </section>

      <section className="sub">
        <h3>Dirección</h3>
        <div className="row wrap">
          <input
            defaultValue={j.address}
            aria-label="Dirección de la obra"
            onBlur={(e) => e.target.value !== j.address && patch.mutate({ address: e.target.value })}
            placeholder="Calle, número, localidad"
          />
          {j.address && (
            <a className="btn small" href={mapsUrl(j.address)} target="_blank" rel="noreferrer">
              Abrir en Maps
            </a>
          )}
        </div>
      </section>

      <section className="sub">
        <h3>WhatsApp</h3>
        <div className="row wrap">
          {j.scheduledAt && (
            <a className="btn wa small" href={waLink(phone, confirmTurnMessage(j))} target="_blank" rel="noreferrer" onClick={() => sent('confirm')}>
              Confirmar turno{j.confirmSentAt ? ' ✓' : ''}
            </a>
          )}
          <a className="btn wa small" href={waLink(phone, onTheWayMessage(j))} target="_blank" rel="noreferrer">
            Vamos en camino
          </a>
          {(j.status === 'ORDERED' || j.status === 'MAKING') && (
            <a className="btn small" href={waLink(phone, delayMessage(j))} target="_blank" rel="noreferrer">
              Avisar demora
            </a>
          )}
          <a className="btn small" href={waLink(null, crewMessage(j))} target="_blank" rel="noreferrer">
            Mandar ficha al equipo
          </a>
        </div>
      </section>

      <section className="sub">
        <h3>Para el colocador</h3>
        <textarea
          rows={2}
          value={notes ?? j.installNotes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes != null && notes !== j.installNotes && patch.mutate({ installNotes: notes })}
          placeholder="Ej.: llevar ventosas grandes, el edificio no tiene ascensor"
          aria-label="Notas para el colocador"
        />
        <div className="row wrap">
          <a className="btn small" href={crewUrl(j.crewToken)} target="_blank" rel="noreferrer">
            Ver ficha del colocador
          </a>
          <button type="button" className="btn small" onClick={() => void copyText(crewUrl(j.crewToken))}>
            Copiar link
          </button>
        </div>
      </section>

      {(!!j.beforeIds.length || !!j.afterIds.length) && (
        <section className="sub">
          <h3>Fotos de la obra</h3>
          <div className="photos">
            {[...j.beforeIds, ...j.afterIds].map((p) => (
              <a key={p} href={`/api/assets/${p}`} target="_blank" rel="noreferrer">
                <img src={`/api/assets/${p}`} alt="Foto de la obra" />
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="sub warranty-box">
        <div>
          <h3>Garantía</h3>
          <p className="small muted">
            {j.warrantyMonths} meses{j.installedAt ? ` desde el ${dateFmt(j.installedAt)}` : ' desde la colocación'}. Imprimí el QR y pegalo en el trabajo: el cliente lo escanea para pedir service o un presupuesto nuevo.
          </p>
          <a className="btn small" href={`${warrantyUrl(j.warrantyToken)}?etiqueta=1`} target="_blank" rel="noreferrer">
            Imprimir etiqueta
          </a>
        </div>
        <Qr text={warrantyUrl(j.warrantyToken)} size={110} label="QR de la garantía" />
      </section>

      <section className="sub">
        <h3>Roturas</h3>
        {j.breakages.map((b) => (
          <p key={b.id} className="small">
            {dateFmt(b.createdAt)} · {WHERE[b.where]} · {money(b.cost)} {b.description && `· ${b.description}`}
          </p>
        ))}
        <BreakageForm jobId={j.id} />
      </section>
    </Modal>
  );
}

const WHERE: Record<Breakage['where'], string> = { TALLER: 'En el taller', TRASLADO: 'En el traslado', OBRA: 'En la obra', POSTVENTA: 'Postventa' };

function BreakageForm({ jobId }: { jobId?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ where: 'OBRA' as Breakage['where'], description: '', cost: 0 as number | null, responsible: '', reordered: true });
  const m = useMutation({
    mutationFn: () => api('/breakages', { body: { ...f, cost: f.cost ?? 0, jobId: jobId ?? null } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job'] });
      qc.invalidateQueries({ queryKey: ['breakages'] });
      setOpen(false);
      toast('Rotura registrada');
    },
    onError: (e) => toast(errMsg(e)),
  });
  if (!open)
    return (
      <button type="button" className="link-btn small" onClick={() => setOpen(true)}>
        + Registrar rotura
      </button>
    );
  return (
    <div className="form-grid">
      <Field label="Dónde">
        <select value={f.where} onChange={(e) => setF({ ...f, where: e.target.value as Breakage['where'] })}>
          {Object.entries(WHERE).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Costo ($)">
        <NumInput value={f.cost} onChange={(v) => setF({ ...f, cost: v })} />
      </Field>
      <Field label="Qué pasó" wide>
        <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ej.: se partió al subir por la escalera" />
      </Field>
      <Field label="Quién estaba">
        <input value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={f.reordered} onChange={(e) => setF({ ...f, reordered: e.target.checked })} /> Ya lo volví a pedir
      </label>
      <div className="actions wide">
        <button type="button" className="btn small primary" disabled={m.isPending} onClick={() => m.mutate()}>
          Guardar rotura
        </button>
      </div>
    </div>
  );
}

function Crews({ crews }: { crews: Crew[] }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Partial<Crew> | null>(null);
  const save = useMutation({
    mutationFn: (c: Partial<Crew>) =>
      c.id ? api(`/crews/${c.id}`, { method: 'PATCH', body: { name: c.name, members: c.members, dayRate: c.dayRate, color: c.color, active: c.active } }) : api('/crews', { body: c }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crews'] });
      setEdit(null);
      toast('Equipo guardado');
    },
    onError: (e) => toast(errMsg(e)),
  });
  return (
    <section className="card">
      <div className="row between">
        <h2>Equipos de colocación</h2>
        <button type="button" className="btn small primary" onClick={() => setEdit({ name: '', members: '', dayRate: 0, color: '#0f766e', active: true })}>
          + Equipo
        </button>
      </div>
      {!crews.length && <p className="muted">Cargá tus equipos para asignarles trabajos y ver la agenda de cada uno.</p>}
      <ul className="list">
        {crews.map((c) => (
          <li key={c.id} className="list-row">
            <span className="crew-dot" style={{ background: c.color }} />
            <span className="grow">
              <strong>{c.name}</strong>
              {!c.active && <span className="muted"> (inactivo)</span>}
              <span className="muted small block">{c.members || 'sin integrantes cargados'}</span>
            </span>
            <span className="num small">{money(c.dayRate)} por día c/u</span>
            <button type="button" className="btn small" onClick={() => setEdit(c)}>
              Editar
            </button>
          </li>
        ))}
      </ul>
      {edit && (
        <Modal title={edit.id ? 'Editar equipo' : 'Nuevo equipo'} onClose={() => setEdit(null)}>
          <div className="form-grid">
            <Field label="Nombre">
              <input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Ej.: Equipo 1" autoFocus />
            </Field>
            <Field label="Color">
              <input type="color" value={edit.color ?? '#1d4ed8'} onChange={(e) => setEdit({ ...edit, color: e.target.value })} />
            </Field>
            <Field label="Integrantes" wide>
              <input value={edit.members ?? ''} onChange={(e) => setEdit({ ...edit, members: e.target.value })} placeholder="Ej.: Juan, Pedro" />
            </Field>
            <Field label="Jornal por persona ($)">
              <NumInput value={edit.dayRate ?? 0} onChange={(v) => setEdit({ ...edit, dayRate: v ?? 0 })} />
            </Field>
            <label className="check">
              <input type="checkbox" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Activo
            </label>
            <div className="actions wide">
              <button type="button" className="btn primary" disabled={save.isPending || !edit.name?.trim()} onClick={() => save.mutate(edit)}>
                Guardar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function Breakages() {
  const q = useQuery({ queryKey: ['breakages'], queryFn: () => api<Breakage[]>('/breakages') });
  const total = useMemo(() => (q.data ?? []).reduce((a, b) => a + Number(b.cost), 0), [q.data]);
  return (
    <section className="card">
      <h2>Roturas y reposiciones</h2>
      <p className="muted small">Lo que se rompe cuesta plata: registrarlo muestra dónde pasa más (taller, traslado u obra).</p>
      <BreakageForm />
      {!q.data?.length ? (
        <p className="muted">No hay roturas registradas.</p>
      ) : (
        <>
          <p className="small">
            Total: <strong>{money(total)}</strong> en {q.data.length} roturas.
          </p>
          <ul className="list">
            {q.data.map((b) => (
              <li key={b.id} className="list-row">
                <span className="mono muted small">{dateFmt(b.createdAt)}</span>
                <span className="grow">
                  <strong>{WHERE[b.where]}</strong>
                  {b.job && <span className="muted"> · N° {b.job.quote.number}</span>}
                  <span className="muted small block">
                    {b.description}
                    {b.responsible && ` · ${b.responsible}`}
                  </span>
                </span>
                <span className="num">{money(b.cost)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

import { useState } from 'react';
import { db, newId } from '../../db/db';
import { removeRecord } from '../../db/repo';
import type { CheckResult, DocType, DocumentRec, ExpenseCategory, Incident, MaintItem, OtherParty, ServiceLog } from '../../db/types';
import { dayKey, fromLocalInput, toLocalInput, todayKey } from '../../domain/dates';
import { DOC_TYPES, calendarFile, docEvents, googleCalendarUrl, suggestRenewal } from '../../domain/documents';
import { lastDone } from '../../domain/maintenance';
import { useData } from '../../lib/data';
import { dateTimeFmt, dayFmt, kmFmt, parseKm, parseNum } from '../../lib/format';
import { download, shareText } from '../../lib/share';
import { Icon } from '../icons';
import { PhotoPicker, usePhotos } from '../photos';
import { Field, KmField, MoneyField, SaveBar, Seg, Sheet, toast } from '../ui';
import { moneyInput } from './money';

const intFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const kmStr = (n?: number) => (n == null ? '' : intFmt.format(n));
const intOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(/\D/g, '')) || undefined);

export function ServiceSheet({ service, preselect, onClose }: { service?: ServiceLog; preselect?: string[]; onClose: () => void }) {
  const d = useData();
  const items = [...d.items].filter((i) => i.enabled || service?.itemIds.includes(i.id)).sort((a, b) => a.order - b.order);
  const [date, setDate] = useState(service?.date ?? todayKey());
  const [km, setKm] = useState(kmStr(service?.km ?? d.km));
  const [sel, setSel] = useState<string[]>(service?.itemIds ?? preselect ?? []);
  const [cost, setCost] = useState(moneyInput(service?.cost));
  const [shop, setShop] = useState(service?.shop ?? '');
  const [note, setNote] = useState(service?.note ?? '');
  const photos = usePhotos(service?.photoId ? [service.photoId] : []);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const cancel = () => {
    void photos.cancel();
    onClose();
  };
  const save = async () => {
    const k = parseKm(km);
    if (k == null) return toast('Poné los km del service');
    if (!sel.length && !note.trim()) return toast('Marcá qué te hicieron o escribilo en el detalle');
    await photos.commit();
    await db.services.put({
      id: service?.id ?? newId(),
      vehicleId: d.vehicle.id,
      date,
      km: k,
      itemIds: sel,
      cost: parseNum(cost) ?? 0,
      shop: shop.trim() || undefined,
      note: note.trim() || undefined,
      photoId: photos.ids[0],
    });
    toast('Service anotado: el plan se actualizó');
    onClose();
  };
  const remove = async () => {
    if (!service || !confirm('¿Borrar este service?')) return;
    await photos.cancel();
    await removeRecord('services', service.id);
    onClose();
  };
  return (
    <Sheet title={service ? 'Service' : 'Registrar service'} onClose={cancel} footer={<SaveBar onSave={save} onDelete={service ? remove : undefined} />}>
      <div className="grid2">
        <Field label="Fecha">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <KmField label="Km" value={km} onChange={setKm} />
      </div>
      <Field label="¿Qué te hicieron?">
        <div className="list">
          {items.map((i) => (
            <label key={i.id} className="check item" style={{ minHeight: 48 }}>
              <input type="checkbox" checked={sel.includes(i.id)} onChange={() => toggle(i.id)} />
              <span className="grow">{i.name}</span>
            </label>
          ))}
        </div>
      </Field>
      <MoneyField label="Cuánto pagaste" value={cost} onChange={setCost} />
      <Field label="Taller o mecánico">
        <input value={shop} onChange={(e) => setShop(e.target.value)} placeholder="Opcional" />
      </Field>
      <Field label="Detalle">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: aceite 10W40, cambiaron la correa de alternador" />
      </Field>
      <Field label="Foto de la factura">
        <PhotoPicker photos={photos} max={1} label="Factura" />
      </Field>
    </Sheet>
  );
}

export function ItemSheet({ item, onClose }: { item?: MaintItem; onClose: () => void }) {
  const d = useData();
  const [name, setName] = useState(item?.name ?? '');
  const [everyKm, setEveryKm] = useState(kmStr(item?.everyKm));
  const [everyMonths, setEveryMonths] = useState(item?.everyMonths != null ? String(item.everyMonths) : '');
  const [baseKm, setBaseKm] = useState(kmStr(item?.baseKm));
  const [baseDate, setBaseDate] = useState(item?.baseDate ?? '');
  const [warnKm, setWarnKm] = useState(kmStr(item?.warnKm ?? 1000));
  const [warnDays, setWarnDays] = useState(String(item?.warnDays ?? 30));
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  const fromLogs = item ? lastDone({ ...item, baseKm: undefined, baseDate: undefined }, d.services) : null;
  const save = async () => {
    if (!name.trim()) return toast('Poné un nombre');
    const eKm = parseKm(everyKm) ?? undefined;
    const eMonths = intOrUndef(everyMonths);
    if (!eKm && !eMonths) return toast('Poné cada cuántos km o cada cuántos meses');
    await db.items.put({
      id: item?.id ?? newId(),
      vehicleId: d.vehicle.id,
      name: name.trim(),
      everyKm: eKm,
      everyMonths: eMonths,
      baseKm: parseKm(baseKm) ?? undefined,
      baseDate: baseDate || undefined,
      warnKm: parseKm(warnKm) ?? 1000,
      warnDays: intOrUndef(warnDays) ?? 30,
      enabled,
      order: item?.order ?? d.items.length,
    });
    toast('Guardado');
    onClose();
  };
  const remove = async () => {
    if (!item || !confirm(`¿Sacar "${item.name}" del plan?`)) return;
    await removeRecord('items', item.id);
    onClose();
  };
  return (
    <Sheet title={item ? item.name : 'Nuevo ítem de mantenimiento'} onClose={onClose} footer={<SaveBar onSave={save} onDelete={item ? remove : undefined} />}>
      <Field label="Nombre">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Embrague (revisar)" />
      </Field>
      <div className="grid2">
        <KmField label="Cada cuántos km" value={everyKm} onChange={setEveryKm} />
        <Field label="O cada cuántos meses">
          <input inputMode="numeric" value={everyMonths} onChange={(e) => setEveryMonths(e.target.value.replace(/\D/g, ''))} placeholder="—" />
        </Field>
      </div>
      <p className="hint">Lo que llegue primero. Los valores que trae la app son típicos: revisá el manual de tu auto.</p>
      <h3>Última vez que lo hiciste</h3>
      {fromLogs && (fromLogs.lastKm != null || fromLogs.lastDate) && (
        <p className="muted small">
          Según tus services: {fromLogs.lastKm != null ? kmFmt(fromLogs.lastKm) : ''} {fromLogs.lastDate ? `el ${dayFmt(fromLogs.lastDate)}` : ''}. Se usa lo más reciente.
        </p>
      )}
      <div className="grid2">
        <KmField label="A los km" value={baseKm} onChange={setBaseKm} />
        <Field label="Fecha">
          <input type="date" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} />
        </Field>
      </div>
      <h3>Avisarme antes</h3>
      <div className="grid2">
        <KmField label="Km antes" value={warnKm} onChange={setWarnKm} />
        <Field label="Días antes">
          <input inputMode="numeric" value={warnDays} onChange={(e) => setWarnDays(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Seguir este ítem
      </label>
    </Sheet>
  );
}

const RENEW_CATEGORY: Partial<Record<DocType, ExpenseCategory>> = { seguro: 'seguro', patente: 'patente' };

export function DocSheet({ doc, onClose }: { doc?: DocumentRec; onClose: () => void }) {
  const d = useData();
  const [type, setType] = useState<DocType>(doc?.type ?? 'otro');
  const [name, setName] = useState(doc?.name ?? DOC_TYPES.otro.label);
  const [expires, setExpires] = useState(doc?.expires ?? '');
  const [warnDays, setWarnDays] = useState(String(doc?.warnDays ?? 30));
  const [note, setNote] = useState(doc?.note ?? '');
  const [renewing, setRenewing] = useState(false);
  const [newDate, setNewDate] = useState(doc ? (suggestRenewal(doc) ?? '') : '');
  const [cost, setCost] = useState('');
  const photos = usePhotos(doc?.photoId ? [doc.photoId] : []);
  const current: DocumentRec = { id: doc?.id ?? newId(), vehicleId: d.vehicle.id, type, name: name.trim() || DOC_TYPES[type].label, expires: expires || undefined, warnDays: intOrUndef(warnDays) ?? 0, note: note.trim() || undefined, photoId: photos.ids[0] };
  const cancel = () => {
    void photos.cancel();
    onClose();
  };
  const save = async () => {
    await photos.commit();
    await db.docs.put(current);
    toast('Guardado');
    onClose();
  };
  const renew = async () => {
    if (!newDate) return toast('Poné la nueva fecha de vencimiento');
    await photos.commit();
    await db.docs.put({ ...current, expires: newDate });
    const amt = parseNum(cost);
    if (amt && amt > 0)
      await db.expenses.add({ id: newId(), vehicleId: d.vehicle.id, at: new Date().toISOString(), category: RENEW_CATEGORY[type] ?? 'tramites', amount: amt, note: `Renovación: ${current.name}` });
    toast(`Renovado hasta el ${dayFmt(newDate)}`);
    onClose();
  };
  const remove = async () => {
    if (!doc || !confirm(`¿Borrar "${doc.name}"?`)) return;
    await photos.cancel();
    await removeRecord('docs', doc.id);
    onClose();
  };
  const events = docEvents(current);
  return (
    <Sheet title={doc ? doc.name : 'Nuevo papel'} onClose={cancel} footer={<SaveBar onSave={save} onDelete={doc ? remove : undefined} />}>
      {!doc && (
        <Field label="Tipo">
          <select
            value={type}
            onChange={(e) => {
              const t = e.target.value as DocType;
              setType(t);
              setName(DOC_TYPES[t].label);
            }}
          >
            {(Object.keys(DOC_TYPES) as DocType[]).map((t) => (
              <option key={t} value={t}>
                {DOC_TYPES[t].label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Nombre" hint={DOC_TYPES[type].hint}>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid2">
        <Field label="Vence el">
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        <Field label="Avisar días antes">
          <input inputMode="numeric" value={warnDays} onChange={(e) => setWarnDays(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
      <Field label="Detalle">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: n.º de póliza, dónde se renueva" />
      </Field>
      <Field label="Foto del papel">
        <PhotoPicker photos={photos} max={1} label="Foto" />
      </Field>
      {events.length > 0 && (
        <div className="stack-s">
          <span className="label">Que te avise el calendario del celular</span>
          <div className="row">
            <a className="btn" href={googleCalendarUrl(events[0])} target="_blank" rel="noopener noreferrer">
              <Icon name="calendar" /> Google Calendar
            </a>
            <button type="button" onClick={() => download(new Blob([calendarFile(events)], { type: 'text/calendar' }), `${current.name.replace(/[^\p{L}\d]+/gu, '-')}.ics`)}>
              <Icon name="download" /> Archivo .ics
            </button>
          </div>
        </div>
      )}
      {doc && !renewing && (
        <button type="button" onClick={() => setRenewing(true)}>
          Ya lo renové
        </button>
      )}
      {doc && renewing && (
        <div className="card stack">
          <h3>Renovación</h3>
          <div className="grid2">
            <Field label="Nuevo vencimiento">
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </Field>
            <MoneyField label="Cuánto pagaste" value={cost} onChange={setCost} hint="Se anota como gasto." />
          </div>
          <button type="button" className="primary" onClick={() => void renew()}>
            Guardar renovación
          </button>
        </div>
      )}
    </Sheet>
  );
}

export function CheckRunSheet({ onClose }: { onClose: () => void }) {
  const d = useData();
  const items = d.checkItems.filter((i) => i.enabled).sort((a, b) => a.order - b.order);
  const [results, setResults] = useState<Record<string, CheckResult>>(() => Object.fromEntries(items.map((i) => [i.id, 'ok' as CheckResult])));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const bad = items.filter((i) => results[i.id] === 'mal');
  const save = async () => {
    const clean = Object.fromEntries(Object.entries(notes).filter(([k, v]) => results[k] === 'mal' && v.trim()));
    await db.checks.add({ id: newId(), vehicleId: d.vehicle.id, at: new Date().toISOString(), shiftId: d.open?.id, results, notes: Object.keys(clean).length ? clean : undefined });
    toast(bad.length ? `Anotado. Pendiente: ${bad.map((b) => b.label).join(', ')}` : 'Todo bien. ¡Buen viaje!');
    onClose();
  };
  return (
    <Sheet title="Checklist antes de salir" onClose={onClose} footer={<SaveBar onSave={save} />}>
      <p className="muted small">Todo empieza en OK. Tocá "Mal" en lo que tenga problema.</p>
      <div className="list">
        {items.map((i) => (
          <div key={i.id} className="item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div className="row between">
              <span className="t">{i.label}</span>
              <div style={{ width: 150 }}>
                <Seg
                  label={i.label}
                  options={[
                    { id: 'ok', label: 'OK' },
                    { id: 'mal', label: 'Mal' },
                  ]}
                  value={results[i.id]}
                  onChange={(v) => setResults((r) => ({ ...r, [i.id]: v as CheckResult }))}
                />
              </div>
            </div>
            {results[i.id] === 'mal' && (
              <input aria-label={`Qué pasa con ${i.label}`} value={notes[i.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [i.id]: e.target.value }))} placeholder="¿Qué pasa?" />
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}

const OTHER_FIELDS: { key: keyof OtherParty; label: string; mode?: 'numeric' | 'tel' }[] = [
  { key: 'name', label: 'Nombre del conductor' },
  { key: 'dni', label: 'DNI', mode: 'numeric' },
  { key: 'phone', label: 'Teléfono', mode: 'tel' },
  { key: 'plate', label: 'Patente' },
  { key: 'car', label: 'Auto (marca, modelo, color)' },
  { key: 'insurer', label: 'Aseguradora' },
  { key: 'policy', label: 'N.º de póliza' },
];

function incidentText(inc: Incident, car: string) {
  const o = inc.other;
  const lines = [
    `Siniestro: ${dateTimeFmt(inc.at)}`,
    `Mi auto: ${car}`,
    inc.place && `Lugar: ${inc.place}`,
    inc.lat != null && `Mapa: https://maps.google.com/?q=${inc.lat},${inc.lng}`,
    inc.km != null && `Km: ${kmFmt(inc.km)}`,
    inc.description && `Qué pasó: ${inc.description}`,
    (o.car || o.plate) && `Otro auto: ${[o.car, o.plate && `patente ${o.plate}`].filter(Boolean).join(', ')}`,
    (o.name || o.dni || o.phone) && `Conductor: ${[o.name, o.dni && `DNI ${o.dni}`, o.phone && `tel. ${o.phone}`].filter(Boolean).join(', ')}`,
    (o.insurer || o.policy) && `Seguro del otro: ${[o.insurer, o.policy && `póliza ${o.policy}`].filter(Boolean).join(', ')}`,
    inc.witnesses && `Testigos: ${inc.witnesses}`,
    inc.policeReport && `Denuncia policial: ${inc.policeReport}`,
    inc.claimNumber && `N.º de siniestro: ${inc.claimNumber}`,
  ];
  return lines.filter(Boolean).join('\n');
}

export function IncidentSheet({ incident, onClose }: { incident?: Incident; onClose: () => void }) {
  const d = useData();
  const [at, setAt] = useState(toLocalInput(incident?.at ?? new Date().toISOString()));
  const [km, setKm] = useState(kmStr(incident ? incident.km : d.km));
  const [place, setPlace] = useState(incident?.place ?? '');
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(incident?.lat != null ? { lat: incident.lat, lng: incident.lng! } : null);
  const [description, setDescription] = useState(incident?.description ?? '');
  const [other, setOther] = useState<OtherParty>(incident?.other ?? {});
  const [witnesses, setWitnesses] = useState(incident?.witnesses ?? '');
  const [policeReport, setPoliceReport] = useState(incident?.policeReport ?? '');
  const [claimNumber, setClaimNumber] = useState(incident?.claimNumber ?? '');
  const [notified, setNotified] = useState(incident?.insurerNotified ?? false);
  const [closed, setClosed] = useState(incident?.closed ?? false);
  const photos = usePhotos(incident?.photos ?? []);
  const record = (): Incident => ({
    id: incident?.id ?? newId(),
    vehicleId: d.vehicle.id,
    at: fromLocalInput(at),
    km: parseKm(km) ?? undefined,
    place: place.trim() || undefined,
    lat: pos?.lat,
    lng: pos?.lng,
    description: description.trim() || undefined,
    photos: photos.ids,
    other: Object.fromEntries(Object.entries(other).filter(([, v]) => v?.trim())) as OtherParty,
    witnesses: witnesses.trim() || undefined,
    policeReport: policeReport.trim() || undefined,
    claimNumber: claimNumber.trim() || undefined,
    insurerNotified: notified,
    closed,
  });
  const locate = () => {
    if (!navigator.geolocation) return toast('Este celular no da la ubicación');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 });
        toast('Ubicación guardada');
      },
      () => toast('No se pudo tomar la ubicación'),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };
  const cancel = () => {
    void photos.cancel();
    onClose();
  };
  const save = async () => {
    await photos.commit();
    await db.incidents.put(record());
    toast('Siniestro guardado');
    onClose();
  };
  const remove = async () => {
    if (!incident || !confirm('¿Borrar este siniestro y sus fotos?')) return;
    await photos.cancel();
    await removeRecord('incidents', incident.id);
    onClose();
  };
  const share = async () => {
    const rec = record();
    const files: File[] = [];
    for (const [i, id] of rec.photos.entries()) {
      const p = await db.photos.get(id);
      if (p) files.push(new File([p.data], `siniestro-${dayKey(rec.at)}-${i + 1}.jpg`, { type: p.type }));
    }
    await shareText(incidentText(rec, `${d.vehicle.name} ${d.vehicle.plate}`.trim()), files);
  };
  return (
    <Sheet title={incident ? 'Siniestro' : 'Registrar siniestro'} onClose={cancel} footer={<SaveBar onSave={save} onDelete={incident ? remove : undefined} />}>
      <div className="grid2">
        <Field label="Fecha y hora">
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <KmField label="Km" value={km} onChange={setKm} />
      </div>
      <Field label="Lugar">
        <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Calle y altura, o esquina" />
      </Field>
      <div className="row">
        <button type="button" onClick={locate}>
          <Icon name="pin" /> Usar mi ubicación
        </button>
        {pos && (
          <a className="btn ghost" href={`https://maps.google.com/?q=${pos.lat},${pos.lng}`} target="_blank" rel="noopener noreferrer">
            Ver en el mapa
          </a>
        )}
      </div>
      <Field label="Qué pasó">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Fotos" hint="Los dos autos, las patentes, los daños y la calle.">
        <PhotoPicker photos={photos} max={12} />
      </Field>
      <h3>El otro vehículo</h3>
      {OTHER_FIELDS.map((f) => (
        <Field key={f.key} label={f.label}>
          <input inputMode={f.mode} value={other[f.key] ?? ''} onChange={(e) => setOther((o) => ({ ...o, [f.key]: e.target.value }))} />
        </Field>
      ))}
      <Field label="Testigos">
        <textarea value={witnesses} onChange={(e) => setWitnesses(e.target.value)} placeholder="Nombre y teléfono" />
      </Field>
      <div className="grid2">
        <Field label="Denuncia policial">
          <input value={policeReport} onChange={(e) => setPoliceReport(e.target.value)} placeholder="N.º o comisaría" />
        </Field>
        <Field label="N.º de siniestro">
          <input value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} placeholder="Del seguro" />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={notified} onChange={(e) => setNotified(e.target.checked)} />
        Ya hice la denuncia al seguro
      </label>
      <label className="check">
        <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
        Caso cerrado
      </label>
      <button type="button" onClick={() => void share()}>
        <Icon name="share" /> Compartir (seguro, agencia, WhatsApp)
      </button>
    </Sheet>
  );
}


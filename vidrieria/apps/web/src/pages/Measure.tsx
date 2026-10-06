import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parsePieces } from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { PieceSketch } from '../components/PieceSketch';
import { Field, NumInput, toast } from '../components/ui';
import { delPhoto, getPhoto, putPhoto } from '../lib/idb';
import { shrinkToDataUrl } from '../lib/image';
import {
  QUEUE_EVENT,
  cachedTemplates,
  emptyDraft,
  enqueue,
  loadDraft,
  newId,
  pendingMeasures,
  rememberCatalog,
  saveDraft,
  uploadMeasure,
  type MeasureDraft,
  type MeasurePiece,
} from '../lib/measure';
import { templateForKind } from '../lib/pieces';
import type { CatalogItem, Template } from '../lib/types';

type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void };
const SpeechRec = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Medición en la obra, desde el celular. Funciona sin señal: queda guardada y se sube sola. */
export default function Measure() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const online = useOnline();
  const [d, setD] = useState<MeasureDraft>(() => loadDraft() ?? emptyDraft());
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(pendingMeasures().length);

  const templatesQ = useQuery({ queryKey: ['templates'], queryFn: () => api<Template[]>('/templates') });
  const catalogQ = useQuery({ queryKey: ['catalog'], queryFn: () => api<CatalogItem[]>('/catalog') });
  useEffect(() => rememberCatalog(templatesQ.data, catalogQ.data), [templatesQ.data, catalogQ.data]);
  const templates = templatesQ.data ?? cachedTemplates();

  useEffect(() => saveDraft(d), [d]);
  useEffect(() => {
    const upd = () => setPending(pendingMeasures().length);
    window.addEventListener(QUEUE_EVENT, upd);
    return () => window.removeEventListener(QUEUE_EVENT, upd);
  }, []);
  // Miniaturas de las fotos guardadas en el celular.
  useEffect(() => {
    const keys = d.pieces.flatMap((p) => p.photos).filter((k) => !(k in thumbs));
    if (!keys.length) return;
    void Promise.all(keys.map(async (k) => [k, (await getPhoto(k)) ?? ''] as const)).then((pairs) => setThumbs((t) => ({ ...t, ...Object.fromEntries(pairs) })));
  }, [d.pieces, thumbs]);

  const set = (patch: Partial<MeasureDraft>) => setD((x) => ({ ...x, ...patch }));
  const setPiece = (id: string, patch: Partial<MeasurePiece>) => setD((x) => ({ ...x, pieces: x.pieces.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const addPiece = () => {
    const t = templates[0];
    setD((x) => ({ ...x, pieces: [...x.pieces, { id: newId(), templateId: t?.id ?? null, title: t?.name ?? 'Pieza', widthCm: null, heightCm: null, quantity: 1, note: '', photos: [] }] }));
  };

  const addFromText = () => {
    const found = parsePieces(text);
    if (!found.length) return toast('No encontré medidas. Probá: «mampara 120 por 180» o «2 vidrios 50x70 de 4mm».');
    const pieces: MeasurePiece[] = found.map((p) => {
      const t = templateForKind(p.kind, templates);
      return {
        id: newId(),
        templateId: t?.id ?? null,
        title: t && p.kind !== 'vidrio' ? t.name : p.label,
        widthCm: p.widthMm / 10,
        heightCm: p.heightMm / 10,
        quantity: p.quantity,
        note: '',
        kind: p.kind,
        thicknessMm: p.thicknessMm,
        glass: p.glass,
        laminate: p.laminate,
        photos: [],
      };
    });
    setD((x) => ({ ...x, pieces: [...x.pieces, ...pieces] }));
    setText('');
    toast(pieces.length === 1 ? `Agregué: ${pieces[0].title}` : `Agregué ${pieces.length} piezas`);
  };

  const dictate = () => {
    if (!SpeechRec) return;
    const r = new SpeechRec();
    r.lang = 'es-AR';
    r.interimResults = false;
    r.onresult = (e) => setText((t) => `${t ? `${t} ` : ''}${e.results[0][0].transcript}`);
    r.onend = () => setListening(false);
    r.onerror = () => {
      setListening(false);
      toast('No te escuché. Probá de nuevo o usá el micrófono del teclado.');
    };
    setListening(true);
    r.start();
  };

  const addPhotos = async (id: string, files: FileList | null) => {
    if (!files?.length) return;
    try {
      const keys: string[] = [];
      for (const f of Array.from(files).slice(0, 6)) {
        const key = `${d.id}-${newId()}`;
        const url = await shrinkToDataUrl(f, 1280, 0.8);
        await putPhoto(key, url);
        setThumbs((t) => ({ ...t, [key]: url }));
        keys.push(key);
      }
      setD((x) => ({ ...x, pieces: x.pieces.map((p) => (p.id === id ? { ...p, photos: [...p.photos, ...keys] } : p)) }));
    } catch (e) {
      toast(errMsg(e));
    }
  };

  const removePiece = (p: MeasurePiece) => {
    p.photos.forEach((k) => void delPhoto(k).catch(() => {}));
    setD((x) => ({ ...x, pieces: x.pieces.filter((y) => y.id !== p.id) }));
  };

  const ready = d.pieces.some((p) => p.widthCm && p.heightCm);
  const finish = async () => {
    if (!ready) return toast('Cargá al menos una pieza con ancho y alto.');
    const keep = () => {
      enqueue(d);
      saveDraft(null);
      setD(emptyDraft());
      setThumbs({});
      toast('Sin señal: quedó guardada en el celular y se sube sola cuando vuelva.');
    };
    if (!navigator.onLine) return keep();
    setBusy(true);
    try {
      const q = await uploadMeasure(d);
      saveDraft(null);
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast(`Presupuesto N° ${q.number} armado`);
      nav(`/panel/presupuestos/${q.id}`);
    } catch (e) {
      if (e instanceof TypeError) keep();
      else toast(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack measure">
      <div className="page-head">
        <div>
          <h1>Medir en obra</h1>
          <p className="muted small">{online ? 'Cargá las medidas y armá el presupuesto antes de irte.' : 'Sin señal: igual podés medir. Se guarda en el celular.'}</p>
        </div>
        {!online && <span className="pill warn">Sin señal</span>}
      </div>

      {!!pending && (
        <p className="note">
          {pending === 1 ? 'Hay 1 medición' : `Hay ${pending} mediciones`} esperando señal para subirse.
        </p>
      )}

      <section className="card">
        <h2>Cliente</h2>
        <div className="form-grid">
          <Field label="Nombre">
            <input value={d.customerName} onChange={(e) => set({ customerName: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="WhatsApp">
            <input value={d.phone} inputMode="tel" onChange={(e) => set({ phone: e.target.value })} placeholder="11 2345-6789" />
          </Field>
          <Field label="Dirección" wide>
            <input value={d.address} onChange={(e) => set({ address: e.target.value })} />
          </Field>
        </div>
      </section>

      <section className="card dictate">
        <h2>Dictá o escribí</h2>
        <p className="muted small">Ej.: «mampara 1,20 por 1,80 templado 8», «2 vidrios de 50x70 de 4mm y un espejo de 60x90».</p>
        <div className="dictate-row">
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tocá el micrófono o escribí las medidas" aria-label="Medidas dictadas o escritas" />
          {SpeechRec && (
            <button type="button" className={'mic' + (listening ? ' on' : '')} onClick={dictate} aria-label="Dictar" disabled={listening}>
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <button type="button" className="btn" onClick={addFromText} disabled={!text.trim()}>
          Agregar piezas
        </button>
      </section>

      {d.pieces.map((p, i) => (
        <section key={p.id} className="card piece" aria-label={`Pieza ${i + 1}`}>
          <div className="piece-head">
            <select
              value={p.templateId ?? ''}
              aria-label="Tipo de trabajo"
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                setPiece(p.id, { templateId: t?.id ?? null, title: t?.name ?? 'Pieza', kind: null, thicknessMm: null, glass: null, laminate: null });
              }}
            >
              {!p.templateId && <option value="">{p.title}</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button type="button" className="link-btn small danger" onClick={() => removePiece(p)}>
              Quitar
            </button>
          </div>
          {p.title !== templates.find((t) => t.id === p.templateId)?.name && <p className="small muted">{p.title}</p>}
          <div className="piece-body">
            <div className="measures">
              <Field label="Ancho (cm)">
                <NumInput value={p.widthCm} onChange={(v) => setPiece(p.id, { widthCm: v })} ariaLabel="Ancho en cm" />
              </Field>
              <span className="times" aria-hidden="true">
                ×
              </span>
              <Field label="Alto (cm)">
                <NumInput value={p.heightCm} onChange={(v) => setPiece(p.id, { heightCm: v })} ariaLabel="Alto en cm" />
              </Field>
              <Field label="Cant.">
                <NumInput value={p.quantity} onChange={(v) => setPiece(p.id, { quantity: Math.max(1, Math.round(v ?? 1)) })} ariaLabel="Cantidad" />
              </Field>
            </div>
            {!!p.widthCm && !!p.heightCm && <PieceSketch widthMm={p.widthCm * 10} heightMm={p.heightCm * 10} quantity={p.quantity} size="sm" />}
          </div>
          <Field label="Nota" wide>
            <input value={p.note} onChange={(e) => setPiece(p.id, { note: e.target.value })} placeholder="Ej.: pared despareja, abre a la izquierda" />
          </Field>
          <div className="photos">
            {p.photos.map((k) => (thumbs[k] ? <img key={k} src={thumbs[k]} alt="Foto de la medición" /> : null))}
            <label className="photo-add">
              <input type="file" accept="image/*" multiple onChange={(e) => void addPhotos(p.id, e.target.files)} />
              📷 Foto
            </label>
          </div>
        </section>
      ))}

      <button type="button" className="btn" onClick={addPiece}>
        + Pieza a mano
      </button>

      <section className="card">
        <Field label="Notas de la visita" wide>
          <textarea rows={2} value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Ej.: acceso por escalera, cliente quiere herrajes negros" />
        </Field>
      </section>

      <div className="measure-actions">
        <button type="button" className="btn primary block" disabled={busy || !ready} onClick={() => void finish()}>
          {busy ? 'Armando…' : online ? 'Armar presupuesto' : 'Guardar para subir después'}
        </button>
        {(d.pieces.length > 0 || d.customerName) && (
          <button
            type="button"
            className="link-btn small"
            onClick={() => {
              if (!confirm('¿Descartar esta medición?')) return;
              d.pieces.forEach((p) => p.photos.forEach((k) => void delPhoto(k).catch(() => {})));
              setD(emptyDraft());
              setThumbs({});
            }}
          >
            Descartar
          </button>
        )}
      </div>
    </div>
  );
}

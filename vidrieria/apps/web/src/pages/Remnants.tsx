import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errMsg } from '../api';
import { PieceSketch } from '../components/PieceSketch';
import { Empty, Field, Loading, Modal, NumInput, toast } from '../components/ui';
import { dateFmt, qty } from '../lib/format';
import { shrinkToDataUrl } from '../lib/image';
import type { CatalogItem, Remnant } from '../lib/types';

/** Retazos: sobrantes de vidrio que se pueden usar en otro trabajo (hoy se tiran). */
export default function Remnants() {
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['remnants', all], queryFn: () => api<Remnant[]>(`/remnants${all ? '?all=1' : ''}`) });
  const del = useMutation({
    mutationFn: (id: string) => api(`/remnants/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['remnants'] }),
  });
  const use = useMutation({
    mutationFn: ({ id, undo }: { id: string; undo: boolean }) => api(`/remnants/${id}/use`, { body: { undo } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['remnants'] }),
  });
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Retazos</h1>
          <p className="muted small">Cargá los sobrantes que valga la pena guardar. Cuando una pieza entre en uno, el presupuestador te avisa.</p>
        </div>
        <button type="button" className="btn primary" onClick={() => setAdding(true)}>
          + Retazo
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Ver también los usados
      </label>
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <Empty>No hay retazos guardados.</Empty>
      ) : (
        <ul className="cards remnants">
          {q.data.map((r) => (
            <li key={r.id} className={'card remnant' + (r.usedAt ? ' used' : '')}>
              <div className="row">
                {r.photoId ? <img src={`/api/assets/${r.photoId}`} alt="Foto del retazo" className="remnant-photo" /> : <PieceSketch widthMm={r.widthMm} heightMm={r.heightMm} size="sm" />}
                <div className="grow">
                  <strong>{r.glassName}</strong>
                  <span className="mono block">
                    {qty(r.widthMm)} × {qty(r.heightMm)} mm
                  </span>
                  <span className="muted small block">{r.usedAt ? `Usado el ${dateFmt(r.usedAt)}` : `Guardado el ${dateFmt(r.createdAt)}`}</span>
                  {r.notes && <span className="small block">{r.notes}</span>}
                </div>
              </div>
              <div className="row wrap">
                <button type="button" className="btn small" onClick={() => use.mutate({ id: r.id, undo: !!r.usedAt })}>
                  {r.usedAt ? 'Volver a disponible' : 'Lo usé'}
                </button>
                <button type="button" className="link-btn small danger" onClick={() => del.mutate(r.id)}>
                  Borrar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding && <RemnantForm onClose={() => setAdding(false)} />}
    </div>
  );
}

function RemnantForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: () => api<CatalogItem[]>('/catalog') });
  const glasses = (catalog.data ?? []).filter((c) => c.isGlass);
  const [f, setF] = useState({ catalogItemId: '', widthMm: null as number | null, heightMm: null as number | null, notes: '', photo: null as string | null });
  const m = useMutation({
    mutationFn: () => {
      const g = glasses.find((x) => x.id === f.catalogItemId);
      return api('/remnants', {
        body: { catalogItemId: g?.id ?? null, glassName: g?.name ?? 'Vidrio', thicknessMm: g?.thicknessMm ?? null, widthMm: Math.round(f.widthMm ?? 0), heightMm: Math.round(f.heightMm ?? 0), notes: f.notes, photo: f.photo },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['remnants'] });
      toast('Retazo guardado');
      onClose();
    },
    onError: (e) => toast(errMsg(e)),
  });
  return (
    <Modal title="Nuevo retazo" onClose={onClose}>
      <div className="form-grid">
        <Field label="Vidrio" wide>
          <select value={f.catalogItemId} onChange={(e) => setF({ ...f, catalogItemId: e.target.value })}>
            <option value="">Elegí el vidrio…</option>
            {glasses.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ancho (mm)">
          <NumInput value={f.widthMm} onChange={(v) => setF({ ...f, widthMm: v })} />
        </Field>
        <Field label="Alto (mm)">
          <NumInput value={f.heightMm} onChange={(v) => setF({ ...f, heightMm: v })} />
        </Field>
        <Field label="Nota" wide>
          <input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Ej.: tiene una marca en una esquina" />
        </Field>
        <label className="btn small">
          {f.photo ? 'Foto cargada ✓' : 'Sacar foto'}
          <input type="file" accept="image/*" hidden onChange={async (e) => e.target.files?.[0] && setF({ ...f, photo: await shrinkToDataUrl(e.target.files[0], 1000, 0.75) })} />
        </label>
        <div className="actions wide">
          <button type="button" className="btn primary" disabled={m.isPending || !f.catalogItemId || !f.widthMm || !f.heightMm} onClick={() => m.mutate()}>
            Guardar
          </button>
        </div>
      </div>
    </Modal>
  );
}

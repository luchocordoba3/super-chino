import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { db, newId } from '../db/db';
import { dropPhotos } from '../db/repo';
import { shrinkImage } from '../lib/image';
import { Icon } from './icons';
import { toast } from './ui';

/** Guarda una foto achicada en el celular y devuelve su id. */
export async function addPhoto(file: File): Promise<string> {
  const blob = await shrinkImage(file, 1280, 0.72);
  const id = newId();
  await db.photos.add({ id, type: blob.type || 'image/jpeg', data: await blob.arrayBuffer(), createdAt: new Date().toISOString() });
  return id;
}

export function usePhotoUrl(id?: string) {
  const photo = useLiveQuery(() => (id ? db.photos.get(id) : undefined), [id]);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!photo) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(new Blob([photo.data], { type: photo.type }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  return url;
}

/**
 * Fotos de un formulario: las nuevas se guardan al toque; si cancelás se borran,
 * y al guardar se borran las que sacaste.
 */
export function usePhotos(initial: string[] = []) {
  const [ids, setIds] = useState(initial);
  const start = useRef(initial);
  const added = useRef<string[]>([]);
  return {
    ids,
    add: (more: string[]) => {
      added.current.push(...more);
      setIds((x) => [...x, ...more]);
    },
    remove: (id: string) => setIds((x) => x.filter((y) => y !== id)),
    commit: async () => {
      await dropPhotos([...start.current, ...added.current], ids);
    },
    cancel: async () => {
      await dropPhotos(added.current, []);
    },
  };
}

function Thumb({ id, onRemove }: { id: string; onRemove?: () => void }) {
  const url = usePhotoUrl(id);
  const [big, setBig] = useState(false);
  return (
    <>
      <div className="photo">
        <button type="button" className="ghost" style={{ padding: 0, width: '100%', height: '100%', minHeight: 0 }} onClick={() => setBig(true)} aria-label="Ver foto">
          {url && <img src={url} alt="" />}
        </button>
        {onRemove && (
          <button type="button" className="photo-x" onClick={onRemove} aria-label="Sacar foto">
            <Icon name="x" className="icon" />
          </button>
        )}
      </div>
      {big && url && (
        <div className="viewer" onClick={() => setBig(false)} role="dialog" aria-label="Foto">
          <img src={url} alt="" />
        </div>
      )}
    </>
  );
}

export function PhotoPicker({ photos, max = 8, label = 'Foto' }: { photos: ReturnType<typeof usePhotos>; max?: number; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const onFiles = async (files: FileList) => {
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const f of Array.from(files).slice(0, max - photos.ids.length)) ids.push(await addPhoto(f));
      photos.add(ids);
    } catch {
      toast('No se pudo guardar la foto');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="photos">
      {photos.ids.map((id) => (
        <Thumb key={id} id={id} onRemove={() => photos.remove(id)} />
      ))}
      {photos.ids.length < max && (
        <button type="button" className="photo-add" onClick={() => input.current?.click()} disabled={busy}>
          <Icon name="camera" />
          {busy ? 'Guardando…' : label}
        </button>
      )}
      <input ref={input} type="file" accept="image/*" multiple={max > 1} hidden onChange={(e) => e.target.files && void onFiles(e.target.files)} />
    </div>
  );
}

/** Fotos para mirar, sin editar. */
export function PhotoStrip({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <div className="photos">
      {ids.map((id) => (
        <Thumb key={id} id={id} />
      ))}
    </div>
  );
}

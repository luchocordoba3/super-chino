import { db, TABLES } from './db';
import type { Photo } from './types';

// Copia de seguridad: un archivo JSON con todo (y las fotos en base64).

const APP = 'mi-remis';
const VERSION = 1;

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function exportBackup(includePhotos = true): Promise<string> {
  const tables: Record<string, unknown[]> = {};
  for (const name of TABLES) {
    if (name === 'photos') {
      if (!includePhotos) continue;
      const photos = await db.photos.toArray();
      tables.photos = photos.map((p) => ({ ...p, data: bufToB64(p.data) }));
    } else tables[name] = await db.table(name).toArray();
  }
  return JSON.stringify({ app: APP, version: VERSION, exportedAt: new Date().toISOString(), tables });
}

/** Reemplaza todo lo del celular por lo que trae la copia. */
export async function importBackup(text: string) {
  let data: { app?: string; version?: number; tables?: Record<string, unknown[]> };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es una copia de Mi Remis.');
  }
  if (data?.app !== APP || !data.tables) throw new Error('El archivo no es una copia de Mi Remis.');
  if ((data.version ?? 0) > VERSION) throw new Error('La copia es de una versión más nueva de la app. Actualizá la app y probá de nuevo.');
  const tables = data.tables;
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
    for (const name of TABLES) {
      const rows = tables[name];
      if (!Array.isArray(rows)) continue;
      if (name === 'photos')
        await db.photos.bulkAdd((rows as (Omit<Photo, 'data'> & { data: string })[]).map((p) => ({ ...p, data: b64ToBuf(p.data) })));
      else await db.table(name).bulkAdd(rows);
    }
  });
}

export const backupFileName = (d = new Date()) =>
  `mi-remis-copia-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;

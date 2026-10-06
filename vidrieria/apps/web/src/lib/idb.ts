/** Fotos de la medición guardadas en el celular hasta que haya señal (IndexedDB: localStorage no alcanza). */
const DB = 'vd';
const STORE = 'photos';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const putPhoto = (key: string, dataUrl: string) => run('readwrite', (s) => s.put(dataUrl, key));
export const getPhoto = (key: string) => run<string | undefined>('readonly', (s) => s.get(key));
export const delPhoto = (key: string) => run('readwrite', (s) => s.delete(key));

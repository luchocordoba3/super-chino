import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { derive } from '../lib/derive';
import { exportBackup, importBackup } from './backup';
import { db } from './db';
import { loadDemo } from './demo';
import { loadAll, removeRecord, setup, wipeAll } from './repo';

beforeEach(() => wipeAll());

describe('datos en el celular', () => {
  it('la primera vez arma el plan, los papeles y el checklist', async () => {
    await setup({
      vehicle: { name: 'Corolla', plate: 'AA 000 AA', fuels: ['nafta'], initialKm: 50_000, shared: false },
      oil: { km: 45_000 },
      agency: { mode: 'percent', percent: 20 },
      docs: { vtv: '2026-12-01' },
    });
    const d = (await loadAll())!;
    expect(d.vehicle.name).toBe('Corolla');
    expect(d.items.find((i) => i.name.startsWith('Aceite'))!.baseKm).toBe(45_000);
    expect(d.docs.find((x) => x.type === 'vtv')!.expires).toBe('2026-12-01');
    expect(d.docs.some((x) => x.type === 'oblea_gnc')).toBe(false);
    expect(d.checkItems.length).toBeGreaterThan(5);
    expect(d.settings.agency).toEqual({ mode: 'percent', percent: 20 });
  });

  it('guarda y restaura la copia de seguridad, fotos incluidas', async () => {
    await loadDemo(new Date(2026, 4, 20, 12));
    await db.photos.add({ id: 'p1', type: 'image/jpeg', data: new Uint8Array([1, 2, 3, 250]).buffer, createdAt: '2026-05-20T12:00:00.000Z' });
    const before = await loadAll();
    const json = await exportBackup();
    await wipeAll();
    expect(await loadAll()).toBeNull();
    await importBackup(json);
    expect(await loadAll()).toEqual(before);
    const p = await db.photos.get('p1');
    expect([...new Uint8Array(p!.data)]).toEqual([1, 2, 3, 250]);
    expect(JSON.parse(await exportBackup(false)).tables.photos).toBeUndefined();
  });

  it('rechaza archivos que no son copias', async () => {
    await expect(importBackup('{"hola":1}')).rejects.toThrow(/no es una copia/);
    await expect(importBackup('no es json')).rejects.toThrow(/no es una copia/);
  });

  it('al borrar un registro borra sus fotos', async () => {
    await db.photos.bulkAdd([
      { id: 'a', type: 'image/jpeg', data: new ArrayBuffer(1), createdAt: '' },
      { id: 'b', type: 'image/jpeg', data: new ArrayBuffer(1), createdAt: '' },
    ]);
    await db.incidents.add({ id: 'i1', vehicleId: 'v', at: '', photos: ['a', 'b'], other: {}, insurerNotified: false, closed: false });
    await removeRecord('incidents', 'i1');
    expect(await db.photos.count()).toBe(0);
  });

  it('los datos de ejemplo muestran los avisos principales', async () => {
    const now = new Date(2026, 4, 20, 12);
    await loadDemo(now);
    const d = derive((await loadAll())!, now);
    const titles = d.alerts.map((a) => a.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        'Venció: Oblea de GNC',
        'Toca: Rotación de cubiertas',
        'Se acerca: Aceite y filtro de aceite',
        'Por vencer: VTV / RTO',
        'Revisar: Luces y balizas',
        expect.stringMatching(/^Rinde menos el GNC/),
      ]),
    );
    expect(d.open).toBeUndefined();
    expect(d.km).toBeGreaterThan(190_000);
    expect(d.kmRate).toBeGreaterThan(200);
  });
});

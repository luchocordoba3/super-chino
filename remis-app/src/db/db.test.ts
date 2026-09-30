import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { derive } from '../lib/derive';
import { exportBackup, importBackup } from './backup';
import { db } from './db';
import { loadDemo } from './demo';
import { addVehicle, loadAll, removeRecord, removeVehicle, setup, wipeAll } from './repo';

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
    // El auto con chofer: sus avisos aparecen con la patente y llevan a ese auto.
    const other = d.alerts.filter((a) => a.vehicleId);
    expect(other.map((a) => a.title)).toEqual(
      expect.arrayContaining(['AC 456 EF: Falta cargar la quincena del 1 al 15/05', 'AC 456 EF: Por vencer: Seguro']),
    );
    expect(d.alerts.filter((a) => a.id.endsWith('backup'))).toHaveLength(0);
    expect(d.fleet.map((f) => f.vehicle.plate)).toEqual(['AB 123 CD', 'AC 456 EF']);
    expect(d.others[0].settlements).toHaveLength(2);
  });

  it('suma otro auto, cambia al nuevo y lo borra con todo lo suyo', async () => {
    await setup({ vehicle: { name: 'Corolla', plate: 'AA 000 AA', fuels: ['nafta'], initialKm: 50_000, shared: false }, agency: { mode: 'none' }, docs: {} });
    const first = (await loadAll())!.vehicle.id;
    const second = await addVehicle({
      vehicle: { name: 'Cronos', plate: 'BB 111 BB', fuels: ['nafta', 'gnc'], initialKm: 20_000, shared: false, driver: 'chofer', chofer: { name: 'Juan', percent: 50, period: 'quincena' } },
      docs: { seguro: '2026-12-01' },
    });
    let d = (await loadAll())!;
    expect(d.vehicle.id).toBe(second);
    expect(d.settings.agency).toEqual({ mode: 'none' });
    expect(d.others.map((o) => o.vehicle.id)).toEqual([first]);
    expect(d.docs.some((x) => x.type === 'oblea_gnc')).toBe(true);
    await db.photos.add({ id: 'p', type: 'image/jpeg', data: new ArrayBuffer(1), createdAt: '' });
    await db.settlements.add({ id: 's1', vehicleId: second, from: '2026-10-01', to: '2026-10-15', gross: 1_000_000, tolls: 200_000, percent: 50 });
    await db.expenses.add({ id: 'e1', vehicleId: second, at: '2026-10-02T12:00:00.000Z', category: 'seguro', amount: 70_000, photoId: 'p' });
    await removeVehicle(second);
    d = (await loadAll())!;
    expect(d.vehicle.id).toBe(first);
    expect(d.vehicles).toHaveLength(1);
    expect(await db.settlements.count()).toBe(0);
    expect(await db.items.where('vehicleId').equals(second).count()).toBe(0);
    expect(await db.photos.count()).toBe(0);
  });

  it('restaura copias de la versión anterior (sin liquidaciones)', async () => {
    await loadDemo(new Date(2026, 4, 20, 12));
    const v2 = JSON.parse(await exportBackup(false));
    delete v2.tables.settlements;
    await importBackup(JSON.stringify({ ...v2, version: 1 }));
    const d = (await loadAll())!;
    expect(d.vehicle.plate).toBe('AB 123 CD');
    expect(d.others[0].settlements).toEqual([]);
    await expect(importBackup(JSON.stringify({ ...v2, version: 3 }))).rejects.toThrow(/más nueva/);
  });
});

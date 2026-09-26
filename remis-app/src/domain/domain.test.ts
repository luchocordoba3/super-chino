import { describe, expect, it } from 'vitest';
import type { DocumentRec, Expense, FuelLoad, Income, MaintItem, ServiceLog, Shift } from '../db/types';
import { parseNum, parseKm } from '../lib/format';
import { buildAlerts } from './alerts';
import { pendingProblems } from './checks';
import { addMonths, diffDays, startOfWeek } from './dates';
import { calendarFile, docEvents, docStatus, googleCalendarUrl, suggestRenewal } from './documents';
import { avgKmPerUnit, consumptionDrop, segments } from './fuel';
import { currentKm, gapsBetweenShifts, kmByDay, kmPerDay, kmWarning, readings } from './km';
import { defaultItems, maintStatus } from './maintenance';
import { movements, movementsCsv, toCsv } from './movements';
import { agencyDue, agencyFeeFor, splitByKm, summarize } from './money';

const V = 'v1';
const iso = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
let n = 0;
const id = () => `id${++n}`;

const shift = (day: number, startKm: number, endKm?: number, h1 = 6, h2 = 16): Shift => ({
  id: id(),
  vehicleId: V,
  startAt: iso(2026, 5, day, h1),
  startKm,
  ...(endKm != null ? { endAt: iso(2026, 5, day, h2), endKm } : {}),
});
const load = (day: number, h: number, km: number | undefined, qty: number, full = true, fuel: FuelLoad['fuel'] = 'gnc'): FuelLoad => ({
  id: id(),
  vehicleId: V,
  at: iso(2026, 5, day, h),
  km,
  fuel,
  qty,
  total: qty * 800,
  full,
});
const item = (p: Partial<MaintItem>): MaintItem => ({ id: id(), vehicleId: V, name: 'Aceite', warnKm: 1000, warnDays: 30, enabled: true, order: 0, ...p });

describe('fechas', () => {
  it('suma meses sin pasarse de fin de mes', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-03-10', -4)).toBe('2025-11-10');
  });
  it('cuenta días y arranca la semana el lunes', () => {
    expect(diffDays('2026-05-01', '2026-05-31')).toBe(30);
    expect(diffDays('2026-05-31', '2026-05-01')).toBe(-30);
    expect(startOfWeek('2026-05-17')).toBe('2026-05-11'); // domingo -> lunes anterior
    expect(startOfWeek('2026-05-11')).toBe('2026-05-11');
  });
});

describe('números escritos a mano', () => {
  it('entiende miles con punto y decimales con coma', () => {
    expect(parseNum('15.000')).toBe(15000);
    expect(parseNum('1.234.567')).toBe(1234567);
    expect(parseNum('1.234,50')).toBe(1234.5);
    expect(parseNum('35,5')).toBe(35.5);
    expect(parseNum('35.5')).toBe(35.5);
    expect(parseNum('$ 2.300')).toBe(2300);
    expect(parseNum('')).toBeNull();
    expect(parseNum('abc')).toBeNull();
    expect(parseKm('123.456 km')).toBe(123456);
  });
});

describe('km', () => {
  const shifts = [shift(4, 1000, 1200), shift(5, 1350, 1600), shift(6, 1600, 1810), shift(7, 1900)];
  it('toma como km actual el mayor anotado', () => {
    expect(currentKm({ initialKm: 900 }, readings({ shifts, fuel: [load(7, 10, 1950, 5)] }))).toBe(1950);
    expect(currentKm({ initialKm: 900 }, [])).toBe(900);
  });
  it('separa tus km de los del otro chofer', () => {
    expect(gapsBetweenShifts(shifts).map((g) => g.km)).toEqual([150, 90]);
    const { mine, other } = kmByDay(shifts, '2026-05-01', '2026-05-31');
    expect(mine.get('2026-05-04')).toBe(200);
    expect(mine.get('2026-05-07')).toBe(0); // turno abierto
    expect(other.get('2026-05-05')).toBe(150);
    expect(other.get('2026-05-07')).toBe(90);
  });
  it('calcula los km por día del auto', () => {
    const rs = [
      { at: iso(2026, 5, 1, 8), km: 1000 },
      { at: iso(2026, 5, 11, 8), km: 3000 },
    ];
    expect(kmPerDay(rs, new Date(2026, 4, 12))).toBeCloseTo(200);
    expect(kmPerDay(rs.slice(0, 1), new Date(2026, 4, 12))).toBeNull();
  });
  it('avisa si el km no cierra', () => {
    expect(kmWarning(900, 1000)).toMatch(/menor/);
    expect(kmWarning(5000, 1000)).toMatch(/4\.000 km más/);
    expect(kmWarning(1200, 1000)).toBeNull();
  });
});

describe('mantenimiento', () => {
  it('arma el plan según el combustible', () => {
    const gnc = defaultItems(V, ['nafta', 'gnc'], id).map((i) => i.name);
    const diesel = defaultItems(V, ['gasoil'], id).map((i) => i.name);
    expect(gnc).toContain('Service del equipo de GNC');
    expect(diesel).not.toContain('Service del equipo de GNC');
    expect(diesel).not.toContain('Bujías');
  });
  it('dice si está al día, cerca o vencido, por km o por fecha', () => {
    const oil = item({ everyKm: 10_000, everyMonths: 12, baseKm: 100_000, baseDate: '2026-01-10' });
    expect(maintStatus(oil, [], 105_000, 200, '2026-05-10')).toMatchObject({ state: 'ok', kmLeft: 5000, etaDays: 25 });
    expect(maintStatus(oil, [], 109_500, 200, '2026-05-10')).toMatchObject({ state: 'soon', kmLeft: 500 });
    expect(maintStatus(oil, [], 110_200, 200, '2026-05-10')).toMatchObject({ state: 'due', kmLeft: -200 });
    expect(maintStatus(oil, [], 101_000, 200, '2027-01-20')).toMatchObject({ state: 'due', daysLeft: -10 });
    expect(maintStatus(item({ everyKm: 10_000 }), [], 105_000, 200).state).toBe('unknown');
  });
  it('usa el último service registrado', () => {
    const oil = item({ everyKm: 10_000, baseKm: 90_000 });
    const logs: ServiceLog[] = [{ id: 's1', vehicleId: V, date: '2026-04-01', km: 100_000, itemIds: [oil.id], cost: 50_000 }];
    expect(maintStatus(oil, logs, 101_000, null)).toMatchObject({ state: 'ok', lastKm: 100_000, nextKm: 110_000 });
  });
});

describe('papeles', () => {
  const doc: DocumentRec = { id: 'd1', vehicleId: V, type: 'vtv', name: 'VTV / RTO', expires: '2026-06-01', warnDays: 30 };
  it('avisa antes de que venza', () => {
    expect(docStatus(doc, '2026-04-01').state).toBe('ok');
    expect(docStatus(doc, '2026-05-10')).toEqual({ state: 'soon', daysLeft: 22 });
    expect(docStatus(doc, '2026-06-01').state).toBe('soon');
    expect(docStatus(doc, '2026-06-02').state).toBe('expired');
    expect(docStatus({ ...doc, expires: undefined }).state).toBe('unknown');
  });
  it('sugiere la próxima fecha al renovar', () => {
    expect(suggestRenewal(doc, '2026-05-10')).toBe('2027-06-01');
    expect(suggestRenewal(doc, '2026-07-10')).toBe('2027-07-10');
    expect(suggestRenewal({ ...doc, type: 'licencia' })).toBeUndefined();
  });
  it('arma el archivo de calendario y el link de Google', () => {
    const evs = docEvents(doc, '2026-04-01');
    expect(evs).toHaveLength(2);
    const ics = calendarFile(evs);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260601');
    expect(ics).toContain('TRIGGER:-P30D');
    expect(ics).toContain('SUMMARY:Renovar VTV / RTO (vence el 01/06/2026)');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(googleCalendarUrl(evs[0])).toContain('dates=20260601%2F20260602');
  });
});

describe('combustible', () => {
  it('calcula el rendimiento entre tanques llenos', () => {
    const loads = [load(1, 8, 1000, 10), load(1, 12, undefined, 4, false), load(1, 16, 1200, 10), load(2, 16, 1400, 14)];
    const segs = segments(loads, 'gnc');
    expect(segs.map((s) => s.kmPerUnit)).toEqual([200 / 14, 200 / 14]);
    expect(avgKmPerUnit(segs)).toBeCloseTo(200 / 14);
  });
  it('no mezcla cargas de otro combustible ni km del otro chofer', () => {
    const loads = [load(1, 8, 1000, 10), load(1, 10, 1050, 5, false, 'nafta'), load(1, 16, 1200, 10), load(2, 8, 1400, 10)];
    const segs = segments(loads, 'gnc', [iso(2026, 5, 2, 6)]);
    expect(segs.map((s) => s.mixed)).toEqual([true, true]);
    expect(avgKmPerUnit(segs)).toBeNull();
  });
  it('avisa si el consumo sube de golpe', () => {
    const ok = [load(1, 8, 1000, 10), load(2, 8, 1140, 10), load(3, 8, 1280, 10), load(4, 8, 1420, 10)];
    expect(consumptionDrop(segments(ok, 'gnc'))).toBeNull();
    const bad = [...ok, load(5, 8, 1520, 10)];
    expect(consumptionDrop(segments(bad, 'gnc'))).toMatchObject({ dropPct: 29 });
  });
});

describe('plata', () => {
  const shifts = [shift(4, 1000, 1200), shift(5, 1350, 1600)];
  const incomes: Income[] = [
    { id: 'i1', vehicleId: V, at: iso(2026, 5, 4, 16), gross: 100_000, tips: 2000, agencyFee: 20_000, trips: 10 },
    { id: 'i2', vehicleId: V, at: iso(2026, 5, 5, 16), gross: 80_000, agencyFee: 16_000 },
  ];
  const expenses: Expense[] = [
    { id: 'e1', vehicleId: V, at: iso(2026, 5, 4, 10), category: 'peaje', amount: 1500 },
    { id: 'e2', vehicleId: V, at: iso(2026, 5, 11, 7), category: 'agencia', amount: 50_000 },
  ];
  const fuel = [load(4, 8, 1004, 10)];
  const services: ServiceLog[] = [{ id: 's1', vehicleId: V, date: '2026-05-05', km: 1350, itemIds: [], cost: 30_000 }];
  it('calcula la ganancia real de la semana', () => {
    const s = summarize({ shifts, incomes, expenses, fuel, services }, '2026-05-04', '2026-05-10');
    expect(s.km).toEqual({ mine: 450, other: 150 });
    expect(s.hours).toBe(20);
    expect(s.income).toMatchObject({ gross: 180_000, tips: 2000, agency: 36_000, net: 146_000, trips: 10 });
    expect(s.costs.by).toEqual({ combustible: 8000, peaje: 1500, mantenimiento: 30_000 });
    expect(s.profit).toBe(146_000 - 39_500);
    expect(s.perKm.profit).toBeCloseTo(106_500 / 450);
    expect(s.perHour).toBeCloseTo(106_500 / 20);
  });
  it('calcula la comisión y la base de la agencia', () => {
    expect(agencyFeeFor(100_000, { mode: 'percent', percent: 20 })).toBe(20_000);
    expect(agencyFeeFor(100_000, { mode: 'fixed', amount: 50_000 })).toBe(0);
    expect(agencyDue({ mode: 'fixed', amount: 80_000, period: 'week' }, expenses, '2026-05-13')).toMatchObject({ from: '2026-05-11', paid: 50_000, left: 30_000 });
    expect(agencyDue({ mode: 'none' }, expenses, '2026-05-13')).toBeNull();
  });
  it('divide el mantenimiento por km con el otro chofer', () => {
    expect(splitByKm(100_000, { mine: 600, other: 400 })).toMatchObject({ share: 0.6, mine: 60_000, other: 40_000 });
  });
});

describe('avisos', () => {
  it('junta mantenimiento, papeles, checklist, siniestros y copia', () => {
    const alerts = buildAlerts(
      {
        fuels: ['gnc'],
        shared: false,
        shifts: [],
        fuel: [],
        items: [item({ name: 'Aceite', everyKm: 10_000, baseKm: 100_000 })],
        services: [],
        docs: [{ id: 'd1', vehicleId: V, type: 'seguro', name: 'Seguro', expires: '2026-05-01', warnDays: 30 }],
        checkItems: [{ id: 'c1', label: 'Luces', order: 0, enabled: true }],
        checks: [{ id: 'r1', vehicleId: V, at: iso(2026, 5, 9), results: { c1: 'mal' } }],
        incidents: [{ id: 'x1', vehicleId: V, at: iso(2026, 5, 9), photos: [], other: {}, insurerNotified: false, closed: false }],
        currentKm: 109_600,
        kmRate: 200,
        hasData: true,
      },
      new Date(2026, 4, 10, 12),
    );
    expect(alerts.map((a) => a.title)).toEqual([
      'Venció: Seguro',
      'Avisá al seguro del siniestro',
      'Se acerca: Aceite',
      'Revisar: Luces',
      'Guardá una copia de tus datos',
    ]);
    expect(alerts[2].detail).toBe('faltan 400 km · a tu ritmo, en unos 2 días');
  });
  it('el problema del checklist se va cuando se arregla o da bien', () => {
    const items = [{ id: 'c1', label: 'Luces', order: 0, enabled: true }];
    const bad = { id: 'r1', vehicleId: V, at: iso(2026, 5, 9), results: { c1: 'mal' as const } };
    expect(pendingProblems(items, [bad])).toHaveLength(1);
    expect(pendingProblems(items, [{ ...bad, fixed: ['c1'] }])).toHaveLength(0);
    expect(pendingProblems(items, [bad, { ...bad, id: 'r2', at: iso(2026, 5, 10), results: { c1: 'ok' as const } }])).toHaveLength(0);
  });
});

describe('historial y Excel', () => {
  it('arma el CSV con punto y coma y coma decimal', () => {
    expect(toCsv([['a;b', 1.5, null]])).toBe('﻿"a;b";1,5;\r\n');
    const list = movements({
      shifts: [shift(4, 1000, 1200)],
      fuel: [],
      expenses: [{ id: 'e1', vehicleId: V, at: iso(2026, 5, 4, 10), category: 'peaje', amount: 1500, note: 'Autopista' }],
      incomes: [],
      services: [],
      items: [],
    });
    const csv = movementsCsv(list, '2026-05-01', '2026-05-31');
    expect(csv).toContain('04/05/2026;06:00;Turno;Turno · 200 km · 1.000 → 1.200 km;200;;');
    expect(csv).toContain('04/05/2026;10:00;Gasto;Peaje · Autopista;;;1500');
  });
});

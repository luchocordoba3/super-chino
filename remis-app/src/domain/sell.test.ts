import { describe, expect, it } from 'vitest';
import type { Expense, Income, Sale, Shift } from '../db/types';
import { canWrite, codeProblem, entitlement, extractCode, formatId, generateSellerKey, type LicensePayload, newInstallId, normalizeId, publicFromPrivate, signCode, verifyCode } from './license';
import { monoAlerts, MONO_TABLE } from './monotributo';
import { bestDays, fixedDue, summarize } from './money';
import { activePlatforms, feeFor, platformList, platformsFrom } from './platforms';
import { activeClients, planRange, salesStats } from './sales';
import { tripVerdict } from './trip';

const iso = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

describe('códigos de activación', () => {
  it('firma en el panel y verifica en la app, solo en el celular correcto', async () => {
    const seller = await generateSellerKey();
    const other = await generateSellerKey();
    const p: LicensePayload = { v: 1, d: 'K7P29QXM', p: 'anual', s: '2026-10-28', x: '2027-10-27', n: 'Juan' };
    const code = await signCode(seller.privateJwk, p);
    expect(await publicFromPrivate(seller.privateJwk)).toBe(seller.publicKey);
    expect(await verifyCode(code, [seller.publicKey])).toEqual(p);
    // Con varias claves (si cambiaste la tuya) también anda; con otra clave, no.
    expect(await verifyCode(code, [other.publicKey, seller.publicKey])).toEqual(p);
    expect(await verifyCode(code, [other.publicKey])).toBeNull();
    // Trucho: cambiar el plan o el vencimiento rompe la firma.
    const [data, sig] = code.split('.');
    const fake = btoa(JSON.stringify({ ...p, x: '2099-01-01' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await verifyCode(`${fake}.${sig}`, [seller.publicKey])).toBeNull();
    expect(await verifyCode(`${data}.xx`, [seller.publicKey])).toBeNull();
    expect(await verifyCode('cualquier cosa', [seller.publicKey])).toBeNull();
    // Del link de WhatsApp sale el código.
    expect(extractCode(` https://rinde.app/activar#${code}\n`)).toBe(code);
    expect(codeProblem(p, 'K7P29QXM', '2026-10-28')).toBeNull();
    expect(codeProblem(p, 'OTRO1234', '2026-10-28')).toMatch(/otro celular/);
    expect(codeProblem(p, 'K7P29QXM', '2027-10-28')).toMatch(/venció/);
    expect(codeProblem({ ...p, d: '' }, 'OTRO1234', '2026-10-28')).toBeNull();
  });

  it('el código del celular es fácil de dictar', () => {
    const id = newInstallId();
    expect(id).toMatch(/^[2-9A-HJKMNP-TV-Z]{8}$/);
    expect(normalizeId(` ${formatId(id).toLowerCase()} `)).toBe(id);
  });

  it('prueba, plan activo, vencido y app libre', () => {
    const base = { licensing: true, license: null, installId: 'K7P29QXM', trialStart: iso(2026, 10, 1, 9), trialDays: 14 };
    expect(entitlement({ ...base, licensing: false, today: '2027-01-01' })).toEqual({ state: 'free' });
    expect(entitlement({ ...base, today: '2026-10-01' })).toMatchObject({ state: 'trial', daysLeft: 14, until: '2026-10-14' });
    expect(entitlement({ ...base, today: '2026-10-14' })).toMatchObject({ state: 'trial', daysLeft: 1 });
    const over = entitlement({ ...base, today: '2026-10-15' });
    expect(over).toMatchObject({ state: 'expired', wasTrial: true });
    expect(canWrite(over)).toBe(false);
    const lic: LicensePayload = { v: 1, d: 'K7P29QXM', p: 'mes', s: '2026-10-15', x: '2026-11-13' };
    expect(entitlement({ ...base, license: lic, today: '2026-10-20' })).toMatchObject({ state: 'active', until: '2026-11-13', daysLeft: 25, plan: 'mes' });
    expect(entitlement({ ...base, license: lic, today: '2026-11-14' })).toMatchObject({ state: 'expired', wasTrial: false });
    // Un código de otro celular no cuenta.
    expect(entitlement({ ...base, license: { ...lic, d: 'OTRO1234' }, today: '2026-10-20' })).toMatchObject({ state: 'expired', wasTrial: true });
  });
});

describe('panel del vendedor', () => {
  const sale = (o: Partial<Sale>): Sale => ({ id: Math.random().toString(36), at: iso(2026, 10, 1), plan: 'anual', starts: '2026-10-01', expires: '2027-09-30', amount: 20_000, code: 'x', ...o });

  it('la renovación arranca cuando termina el plan que tiene', () => {
    const sales = [sale({ installId: 'AAAA2222', plan: 'mes', starts: '2026-10-10', expires: '2026-11-08' })];
    expect(planRange('anual', 'AAAA2222', sales, '2026-11-01')).toEqual({ starts: '2026-11-09', expires: '2027-11-08', renewal: true });
    expect(planRange('mes', 'BBBB3333', sales, '2026-11-01')).toEqual({ starts: '2026-11-01', expires: '2026-11-30', renewal: false });
    expect(planRange('promo', undefined, sales, '2026-11-01', 7)).toMatchObject({ starts: '2026-11-01', expires: '2026-11-07' });
  });

  it('cuenta clientes activos, el estimado por año y quién vence pronto', () => {
    const sales = [
      sale({ installId: 'AAAA2222', plan: 'anual', starts: '2026-01-01', expires: '2026-12-31', name: 'Ana' }),
      sale({ installId: 'BBBB3333', plan: 'mes', starts: '2026-10-20', expires: '2026-11-18', amount: 3500 }),
      sale({ installId: 'CCCC4444', plan: 'mes', starts: '2026-09-01', expires: '2026-09-30', amount: 3500 }),
      sale({ plan: 'promo', starts: '2026-10-25', expires: '2026-10-31', amount: 0 }),
      // Ya renovó: no aparece en "por vencer".
      sale({ installId: 'DDDD5555', plan: 'mes', starts: '2026-10-05', expires: '2026-11-03', amount: 3500 }),
      sale({ installId: 'DDDD5555', plan: 'anual', starts: '2026-11-04', expires: '2027-11-03' }),
    ];
    expect(activeClients(sales, '2026-10-28')).toHaveLength(4);
    const st = salesStats(sales, '2026-10-28', { mes: 3500, anual: 20_000 });
    expect(st.active).toEqual({ anual: 1, mes: 2, promo: 1 });
    expect(st.yearly).toBe(20_000 + 2 * 3500 * 12);
    expect(st.upcoming.map((s) => s.installId)).toEqual(['BBBB3333']);
  });
});

describe('choferes de apps', () => {
  it('cada app con su comisión y el resumen por app', () => {
    const s = { agency: { mode: 'percent' as const, percent: 20 }, platforms: platformsFrom(['uber', 'didi', 'agencia']) };
    s.platforms = s.platforms.map((p) => (p.id === 'uber' ? { ...p, mode: 'bruto', percent: 30 } : p));
    expect(activePlatforms(s).map((p) => p.id)).toEqual(['uber', 'didi', 'agencia']);
    expect(feeFor('uber', 10_000, s)).toBe(3000);
    expect(feeFor('didi', 10_000, s)).toBe(0);
    expect(feeFor('agencia', 10_000, s)).toBe(2000);
    // Datos de antes (sin plataformas): solo la agencia.
    expect(platformList({}).filter((p) => p.on).map((p) => p.id)).toEqual(['agencia']);

    const incomes: Income[] = [
      { id: 'a', vehicleId: 'v', at: iso(2026, 10, 5), platform: 'uber', gross: 40_000, trips: 8, agencyFee: 12_000 },
      { id: 'b', vehicleId: 'v', at: iso(2026, 10, 5), platform: 'didi', gross: 30_000, trips: 5, tips: 1000, agencyFee: 0 },
      { id: 'c', vehicleId: 'v', at: iso(2026, 10, 6), gross: 20_000, agencyFee: 0 },
    ];
    const sum = summarize({ shifts: [], fuel: [], expenses: [], incomes, services: [] }, '2026-10-01', '2026-10-31');
    expect(sum.byPlatform).toEqual({ uber: { net: 28_000, fee: 12_000, trips: 8 }, didi: { net: 31_000, fee: 0, trips: 5 }, agencia: { net: 20_000, fee: 0, trips: 0 } });
  });

  it('¿conviene el viaje?', () => {
    const base = { kmPickup: 2, kmTrip: 8, costKm: 200, minKm: 200, minHour: 8000 };
    expect(tripVerdict({ ...base, pay: 5000, minutes: 25 })).toMatchObject({ km: 10, cost: 2000, net: 3000, perKm: 300, perHour: 7200, verdict: 'meh' });
    expect(tripVerdict({ ...base, pay: 7000, minutes: 25 }).verdict).toBe('good');
    expect(tripVerdict({ ...base, pay: 3000 }).verdict).toBe('bad');
    expect(tripVerdict({ ...base, pay: 1500 })).toMatchObject({ net: -500, verdict: 'bad' });
    expect(tripVerdict({ ...base, kmPickup: 6, kmTrip: 4, pay: 9000 }).pickupShare).toBe(0.6);
  });

  it('alquiler del auto y mejores días', () => {
    const expenses: Expense[] = [{ id: 'e', vehicleId: 'v', at: iso(2026, 10, 27), category: 'alquiler', amount: 50_000 }];
    expect(fixedDue(120_000, 'week', 'alquiler', expenses, '2026-10-28')).toMatchObject({ from: '2026-10-26', to: '2026-11-01', paid: 50_000, left: 70_000 });
    const shifts: Shift[] = [
      { id: 's1', vehicleId: 'v', startAt: iso(2026, 10, 23, 8), startKm: 0, endAt: iso(2026, 10, 23, 18), endKm: 200 },
      { id: 's2', vehicleId: 'v', startAt: iso(2026, 10, 26, 8), startKm: 200, endAt: iso(2026, 10, 26, 16), endKm: 380 },
    ];
    const incomes: Income[] = [
      { id: 'i1', vehicleId: 'v', at: iso(2026, 10, 23, 18), shiftId: 's1', gross: 80_000, agencyFee: 0 },
      { id: 'i2', vehicleId: 'v', at: iso(2026, 10, 26, 16), shiftId: 's2', gross: 40_000, agencyFee: 0 },
    ];
    const days = bestDays(shifts, incomes, '2026-10-01', '2026-10-31');
    expect(days[0]).toMatchObject({ label: 'Lunes', perHour: 5000, shifts: 1 });
    expect(days[4]).toMatchObject({ label: 'Viernes', perHour: 8000 });
    expect(days[6]).toMatchObject({ label: 'Domingo', perHour: null });
  });

  it('monotributo: la cuota del 20, la recategorización y el tope (categoría G)', () => {
    const cfg = { cat: 'G' as const, monthly: MONO_TABLE.G.monthly, limit: MONO_TABLE.G.limit };
    expect(MONO_TABLE.G).toEqual({ limit: 53_995_798.87, monthly: 230_312.94 });
    const none = { incomes: [], expenses: [], settlements: [] };
    expect(monoAlerts(cfg, none, '2026-10-05')).toEqual([]);
    expect(monoAlerts(cfg, none, '2026-10-12').map((a) => [a.id, a.level])).toEqual([['mono-pay', 'warn']]);
    expect(monoAlerts(cfg, none, '2026-10-21')[0].level).toBe('danger');
    const paid = { ...none, expenses: [{ id: 'm', vehicleId: 'v', at: iso(2026, 10, 15), category: 'monotributo' as const, amount: 230_313 }] };
    expect(monoAlerts(cfg, paid, '2026-10-21')).toEqual([]);
    expect(monoAlerts(cfg, paid, '2026-07-10').map((a) => a.id)).toContain('mono-recat');
    const big = { ...paid, incomes: [{ id: 'i', vehicleId: 'v', at: iso(2026, 8, 1), gross: 45_000_000, agencyFee: 0 }] };
    expect(monoAlerts(cfg, big, '2026-10-21').find((a) => a.id === 'mono-limit')?.title).toBe('Llegaste al 83% del tope de la categoría G');
  });
});

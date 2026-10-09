// Ajustes de la casa de celulares: dólar, cuotas, garantías, plazos, comisiones y controles.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { StoreSettings } from '@super-chino/shared';
import { api, errMsg } from '../api';
import { Field, toast, toNum } from '../components/ui';
import { dateTimeFmt, money } from '../lib/format';
import { useMe } from '../lib/me';
import { useFx } from './common';

type NumKey = { [K in keyof StoreSettings]: StoreSettings[K] extends number ? K : never }[keyof StoreSettings];
const NUMS: { k: NumKey; label: string; hint?: string }[] = [
  { k: 'warrantyNewMonths', label: 'Garantía equipos nuevos (meses)', hint: 'Mínimo legal: 6' },
  { k: 'warrantyUsedMonths', label: 'Garantía usados (meses)', hint: 'Mínimo legal: 3' },
  { k: 'repairWarrantyDays', label: 'Garantía de reparaciones (días)' },
  { k: 'depositDays', label: 'Días que dura una seña' },
  { k: 'agingDays', label: 'Avisar equipos parados después de (días)' },
  { k: 'repairStuckDays', label: 'Avisar reparación sin movimiento (días)' },
  { k: 'repairPickupDays', label: 'Avisar reparación lista sin retirar (días)' },
  { k: 'upgradeMonths', label: 'Ofrecer cambio de equipo a los (meses, 0 = no)' },
  { k: 'commissionPct', label: 'Comisión de vendedores (%)' },
  { k: 'cashDiffThreshold', label: 'Avisar diferencia de caja desde ($)' },
  { k: 'courierDiffThreshold', label: 'Avisar diferencia de cadete desde ($)' },
  { k: 'voidAlertThreshold', label: 'Avisar anulaciones por turno desde' },
  { k: 'countItemsPerDay', label: 'Conteo sorpresa de accesorios (productos por día)' },
  { k: 'lateToleranceMin', label: 'Tolerancia de llegada tarde (min)' },
  { k: 'absentAfterMin', label: 'Avisar ausencia después de (min)' },
  { k: 'aiDailyScanLimit', label: 'Fotos por día leídas con IA' },
];

export function PhoneSettings() {
  const me = useMe();
  const qc = useQueryClient();
  const fx = useFx();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<{ id: string; name: string }[]>('/categories') });
  const [name, setName] = useState(me.store.name);
  const [s, setS] = useState<StoreSettings>(me.store.settings);
  const [nums, setNums] = useState(() => Object.fromEntries(NUMS.map(({ k }) => [k, String(me.store.settings[k])])) as Record<NumKey, string>);
  const [fxNums, setFxNums] = useState({ fxManual: String(s.fxManual || ''), fxMarkup: String(s.fxMarkup || '') });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const settings: StoreSettings = { ...s, fxManual: toNum(fxNums.fxManual) ?? 0, fxMarkup: toNum(fxNums.fxMarkup) ?? 0 };
      for (const { k } of NUMS) {
        const v = toNum(nums[k]);
        if (v != null) (settings as Record<string, unknown>)[k] = v;
      }
      await api('/store', { method: 'PATCH', body: { name, settings } });
      await qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['fx'] });
      toast('Guardado');
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    try {
      await api('/fx/refresh', { method: 'POST' });
      void qc.invalidateQueries({ queryKey: ['fx'] });
      toast('Dólar actualizado');
    } catch (e) {
      toast(errMsg(e));
    }
  };
  const plans = s.cardPlans;
  const setPlan = (i: number, patch: Partial<(typeof plans)[number]>) => setS({ ...s, cardPlans: plans.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <div className="card stack">
      <h2>Local</h2>
      <Field label="Nombre del local">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <h3>Dólar</h3>
      <div className="small">
        {fx.data?.quotes.map((q) => (
          <span key={q.casa} style={{ marginRight: 12 }}>
            {q.casa === 'bolsa' ? 'MEP' : q.casa}: {money(q.venta)}
          </span>
        ))}
        {fx.data?.quotes[0] && <span className="muted">· {dateTimeFmt(fx.data.quotes[0].fetchedAt)}</span>}
        <button className="small" onClick={() => void refresh()}>
          Actualizar
        </button>
      </div>
      <div className="grid2">
        <Field label="Cotización que usa el local">
          <select value={s.fxSource} onChange={(e) => setS({ ...s, fxSource: e.target.value as StoreSettings['fxSource'] })}>
            <option value="blue">Blue</option>
            <option value="oficial">Oficial</option>
            <option value="bolsa">MEP</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="manual">La pongo yo</option>
          </select>
        </Field>
        <Field label="Valor">
          <select value={s.fxSide} onChange={(e) => setS({ ...s, fxSide: e.target.value as StoreSettings['fxSide'] })}>
            <option value="venta">Venta</option>
            <option value="compra">Compra</option>
          </select>
        </Field>
        <Field label="Ajuste ($ por dólar)" hint="Ej. +10 sobre el blue">
          <input inputMode="decimal" value={fxNums.fxMarkup} onChange={(e) => setFxNums({ ...fxNums, fxMarkup: e.target.value })} />
        </Field>
        <Field label="Cotización propia" hint="Se usa si elegís “La pongo yo” o si no hay internet">
          <input inputMode="decimal" value={fxNums.fxManual} onChange={(e) => setFxNums({ ...fxNums, fxManual: e.target.value })} />
        </Field>
      </div>
      <p className="small">
        Hoy el local cobra el dólar a <strong>{fx.data?.rate ? money(fx.data.rate) : '—'}</strong>.
      </p>

      <h3>Cuotas con tarjeta</h3>
      {plans.map((p, i) => (
        <div key={p.id} className="row">
          <input style={{ flex: 2 }} value={p.name} onChange={(e) => setPlan(i, { name: e.target.value })} />
          <input style={{ width: 70 }} inputMode="numeric" value={p.installments} onChange={(e) => setPlan(i, { installments: Number(e.target.value) || 1 })} title="Cuotas" />
          <span className="small">cuotas</span>
          <input style={{ width: 80 }} inputMode="decimal" value={p.pct} onChange={(e) => setPlan(i, { pct: toNum(e.target.value) ?? 0 })} title="Recargo %" />
          <span className="small">% recargo</span>
          <button className="small ghost" onClick={() => setS({ ...s, cardPlans: plans.filter((_, j) => j !== i) })}>
            ✕
          </button>
        </div>
      ))}
      <button className="small" onClick={() => setS({ ...s, cardPlans: [...plans, { id: `p${Date.now().toString(36)}`, name: 'Plan', installments: 3, pct: 0 }] })}>
        + Plan de cuotas
      </button>

      <h3>Plazos, garantías y avisos</h3>
      <div className="grid2">
        {NUMS.map(({ k, label, hint }) => (
          <Field key={k} label={label} hint={hint}>
            <input inputMode="decimal" value={nums[k]} onChange={(e) => setNums({ ...nums, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      {(cats.data?.length ?? 0) > 0 && (
        <>
          <h3>Comisión por categoría (%)</h3>
          <div className="grid2">
            {cats.data!.map((c) => (
              <Field key={c.id} label={c.name}>
                <input
                  inputMode="decimal"
                  placeholder={String(s.commissionPct)}
                  value={s.commissionByCategory[c.id] ?? ''}
                  onChange={(e) => {
                    const v = toNum(e.target.value);
                    const next = { ...s.commissionByCategory };
                    if (v == null) delete next[c.id];
                    else next[c.id] = v;
                    setS({ ...s, commissionByCategory: next });
                  }}
                />
              </Field>
            ))}
          </div>
        </>
      )}
      <Field label="Seguimiento por WhatsApp después de vender (días, separados por coma)">
        <input
          defaultValue={s.followUpDays.join(', ')}
          onBlur={(e) => setS({ ...s, followUpDays: e.target.value.split(/[ ,;]+/).map(Number).filter((n) => n > 0).slice(0, 5) })}
        />
      </Field>
      <Field label="Condiciones de garantía (van en el certificado)">
        <textarea value={s.warrantyTerms} onChange={(e) => setS({ ...s, warrantyTerms: e.target.value })} placeholder="La garantía no cubre golpes, humedad ni pantallas rotas…" />
      </Field>
      <button className="primary big" disabled={busy} onClick={() => void save()}>
        Guardar
      </button>
    </div>
  );
}

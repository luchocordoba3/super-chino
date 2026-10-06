import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CUSTOMER_TYPES, CUSTOMER_TYPE_LABEL } from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { ErrorBox, Field, Loading, NumInput, toast } from '../components/ui';
import { dateTimeFmt, money2 } from '../lib/format';
import type { Business, User } from '../lib/types';
import { PushCard } from './Dashboard';

export default function Settings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['business'], queryFn: () => api<Business>('/business') });
  const [f, setF] = useState<Business | null>(null);
  useEffect(() => {
    if (q.data && !f) setF(q.data);
  }, [q.data, f]);
  const save = useMutation({
    mutationFn: (b: Business) =>
      api<Business>('/business', {
        method: 'PATCH',
        body: {
          name: b.name,
          slug: b.slug,
          customDomain: b.customDomain || null,
          whatsapp: b.whatsapp,
          email: b.email,
          address: b.address,
          zones: b.zones,
          hours: b.hours,
          instagram: b.instagram,
          dollarSource: b.dollarSource,
          dollarManual: b.dollarManual,
          wastePct: b.wastePct,
          depositPct: b.depositPct,
          urgencyPct: b.urgencyPct,
          freightPerKm: b.freightPerKm,
          pricesIncludeVat: b.pricesIncludeVat,
          vatPct: b.vatPct,
          roundToCm: b.roundToCm,
          minAreaM2: b.minAreaM2,
          validDays: b.validDays,
          customerAdjust: b.customerAdjust,
          quoteFooter: b.quoteFooter,
          dollarAlertPct: b.dollarAlertPct,
          payAlias: b.payAlias,
          payCbu: b.payCbu,
          payHolder: b.payHolder,
          payNote: b.payNote,
          supplierName: b.supplierName,
          supplierWhatsapp: b.supplierWhatsapp,
        },
      }),
    onSuccess: (b) => {
      setF(b);
      qc.setQueryData(['business'], b);
      qc.invalidateQueries({ queryKey: ['quote-settings'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast('Ajustes guardados');
    },
    onError: (e) => toast(errMsg(e)),
  });
  if (q.isLoading || !f) return q.error ? <ErrorBox error={q.error} /> : <Loading />;
  const set = <K extends keyof Business>(k: K, v: Business[K]) => setF({ ...f, [k]: v });
  const text = (
    k: 'name' | 'slug' | 'whatsapp' | 'email' | 'address' | 'zones' | 'hours' | 'instagram' | 'payAlias' | 'payCbu' | 'payHolder' | 'payNote' | 'supplierName' | 'supplierWhatsapp',
  ) => ({
    value: f[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value),
  });

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(f);
      }}
    >
      <div className="page-head">
        <h1>Ajustes</h1>
        <button className="btn primary" disabled={save.isPending}>
          Guardar
        </button>
      </div>

      <section className="card">
        <h2>Presupuestos</h2>
        <div className="form-grid">
          <Field label="Dólar" hint={dollarHint(f)}>
            <select value={f.dollarSource} onChange={(e) => set('dollarSource', e.target.value as Business['dollarSource'])}>
              <option value="OFICIAL">Oficial (automático)</option>
              <option value="BLUE">Blue (automático)</option>
              <option value="MANUAL">Lo cargo yo</option>
            </select>
          </Field>
          <Field label={f.dollarSource === 'MANUAL' ? 'Valor del dólar' : 'Valor si no hay conexión'}>
            <NumInput value={f.dollarManual} onChange={(v) => set('dollarManual', v ?? 1)} />
          </Field>
          <Field label="Desperdicio en vidrios (%)">
            <NumInput value={f.wastePct} onChange={(v) => set('wastePct', v ?? 0)} />
          </Field>
          <Field label="Seña (%)">
            <NumInput value={f.depositPct} onChange={(v) => set('depositPct', v ?? 0)} />
          </Field>
          <Field label="Recargo por urgencia (%)">
            <NumInput value={f.urgencyPct} onChange={(v) => set('urgencyPct', v ?? 0)} />
          </Field>
          <Field label="Traslado ($ por km)">
            <NumInput value={f.freightPerKm} onChange={(v) => set('freightPerKm', v ?? 0)} />
          </Field>
          <Field label="Validez (días)">
            <NumInput value={f.validDays} onChange={(v) => set('validDays', Math.max(1, Math.round(v ?? 10)))} />
          </Field>
          <Field label="Redondear medidas (cm)" hint="0 = cobrar la medida exacta">
            <NumInput value={f.roundToCm} onChange={(v) => set('roundToCm', Math.round(v ?? 0))} />
          </Field>
          <Field label="Mínimo por pieza (m²)" hint="0 = sin mínimo">
            <NumInput value={f.minAreaM2} onChange={(v) => set('minAreaM2', v ?? 0)} />
          </Field>
          <Field label="IVA (%)">
            <NumInput value={f.vatPct} onChange={(v) => set('vatPct', v ?? 0)} />
          </Field>
          <Field label="Avisarme si el dólar sube más de (%)" hint="En Inicio te muestra los presupuestos mandados que quedaron baratos">
            <NumInput value={f.dollarAlertPct} onChange={(v) => set('dollarAlertPct', v ?? 0)} />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={f.pricesIncludeVat} onChange={(e) => set('pricesIncludeVat', e.target.checked)} />
          Mis precios ya incluyen IVA
        </label>
        <h3>Ajuste por tipo de cliente (%)</h3>
        <p className="muted small">Se aplica solo al elegir el cliente. Negativo = descuento (ej. −10 a otras vidrierías).</p>
        <div className="form-grid">
          {CUSTOMER_TYPES.map((t) => (
            <Field key={t} label={CUSTOMER_TYPE_LABEL[t]}>
              <NumInput value={f.customerAdjust[t] ?? 0} onChange={(v) => set('customerAdjust', { ...f.customerAdjust, [t]: v ?? 0 })} />
            </Field>
          ))}
        </div>
        <Field label="Texto al pie del presupuesto" wide>
          <textarea rows={2} value={f.quoteFooter} onChange={(e) => set('quoteFooter', e.target.value)} placeholder="Ej.: Seña del 50 % para empezar; el saldo, al terminar." />
        </Field>
      </section>

      <section className="card">
        <h2>Cobro de señas</h2>
        <p className="muted small">Cuando el cliente acepta, ve estos datos para transferir la seña y sube el comprobante. Te llega el aviso para confirmar el cobro.</p>
        <div className="form-grid">
          <Field label="Alias">
            <input {...text('payAlias')} placeholder="cristales.ariel" autoComplete="off" />
          </Field>
          <Field label="CBU o CVU">
            <input {...text('payCbu')} inputMode="numeric" autoComplete="off" />
          </Field>
          <Field label="Titular">
            <input {...text('payHolder')} />
          </Field>
          <Field label="Aclaración (opcional)" hint="Ej.: También aceptamos efectivo en el local.">
            <input {...text('payNote')} />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>Proveedor</h2>
        <p className="muted small">Para mandarle el pedido desde Compras con un toque.</p>
        <div className="form-grid">
          <Field label="Nombre">
            <input {...text('supplierName')} placeholder="Ej.: Elasic" />
          </Field>
          <Field label="WhatsApp">
            <input {...text('supplierWhatsapp')} inputMode="tel" />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>Avisos en este dispositivo</h2>
        <PushCard always />
        <p className="muted small">Se activa en cada celular o compu por separado (vos y tu socio, cada uno en el suyo).</p>
      </section>

      <section className="card">
        <h2>Tu negocio</h2>
        <div className="form-grid">
          <Field label="Nombre">
            <input {...text('name')} required />
          </Field>
          <Field label="WhatsApp" hint="Ahí te llegan los avisos de la web">
            <input {...text('whatsapp')} inputMode="tel" />
          </Field>
          <Field label="Email">
            <input {...text('email')} type="email" />
          </Field>
          <Field label="Dirección">
            <input {...text('address')} />
          </Field>
          <Field label="Zonas que cubrís">
            <input {...text('zones')} />
          </Field>
          <Field label="Horario">
            <input {...text('hours')} />
          </Field>
          <Field label="Instagram">
            <input {...text('instagram')} />
          </Field>
          <Field label="Dirección de tu web" hint={`${location.host}/${f.slug}`}>
            <input {...text('slug')} />
          </Field>
          <Field label="Dominio propio (opcional)" hint="Ej.: cristalesariel.com.ar. Primero hay que apuntarlo a este servidor.">
            <input value={f.customDomain ?? ''} onChange={(e) => set('customDomain', e.target.value)} />
          </Field>
        </div>
      </section>
      <Users />
    </form>
  );
}

function dollarHint(b: Business) {
  if (b.dollarSource === 'MANUAL') return 'Usás el valor que cargues abajo.';
  if (b.dollar.fallback) return 'Todavía no se pudo leer de internet: se usa el valor de abajo.';
  return `Hoy: ${money2(b.dollar.rate)}${b.dollar.fetchedAt ? ` (leído ${dateTimeFmt(b.dollar.fetchedAt)})` : ''}`;
}

function Users() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const add = useMutation({
    mutationFn: () => api('/users', { body: f }),
    onSuccess: () => {
      setF({ name: '', email: '', password: '' });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast('Usuario creado');
    },
    onError: (e) => toast(errMsg(e)),
  });
  const toggle = useMutation({
    mutationFn: (u: User) => api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e) => toast(errMsg(e)),
  });
  return (
    <section className="card">
      <h2>Quiénes usan el panel</h2>
      <ul className="list">
        {q.data?.map((u) => (
          <li key={u.id} className="list-row">
            <span className="grow">
              <strong>{u.name}</strong> <span className="muted small">{u.email}</span>
            </span>
            <span className="muted small">{u.role === 'OWNER' ? 'Dueño' : 'Socio / empleado'}</span>
            {u.role !== 'OWNER' && (
              <button type="button" className="btn small" onClick={() => toggle.mutate(u)}>
                {u.active ? 'Dar de baja' : 'Reactivar'}
              </button>
            )}
          </li>
        ))}
      </ul>
      <h3>Agregar socio o empleado</h3>
      <p className="muted small">Puede presupuestar y ver todo, pero no cambia precios ni ajustes.</p>
      <div className="form-grid">
        <Field label="Nombre">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Contraseña" hint="Al menos 8 caracteres">
          <input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
      </div>
      <button type="button" className="btn" disabled={!f.name || !f.email || f.password.length < 8 || add.isPending} onClick={() => add.mutate()}>
        Agregar
      </button>
    </section>
  );
}

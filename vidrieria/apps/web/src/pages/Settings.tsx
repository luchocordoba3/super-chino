import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CUSTOMER_TYPES, CUSTOMER_TYPE_LABEL, MONOTRIBUTO_CAPS, PAY_METHODS, PAY_METHOD_LABEL } from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { Gate } from '../components/Locked';
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
          temperDays: b.temperDays,
          glassDays: b.glassDays,
          warrantyMonths: b.warrantyMonths,
          payFees: b.payFees,
          monotributoCategory: b.monotributoCategory,
          monotributoCap: b.monotributoCap,
          installmentRates: b.installmentRates,
          priceTestPct: b.priceTestPct,
          reviewUrl: b.reviewUrl,
          referralBenefit: b.referralBenefit,
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
        <h2>Plazos y garantía</h2>
        <div className="form-grid">
          <Field label="Templado, laminado y DVH (días hábiles)" hint="Lo que tarda el proveedor en fabricarlo">
            <NumInput value={f.temperDays} onChange={(v) => set('temperDays', Math.round(v ?? 0))} />
          </Field>
          <Field label="Vidrio común cortado (días hábiles)">
            <NumInput value={f.glassDays} onChange={(v) => set('glassDays', Math.round(v ?? 0))} />
          </Field>
          <Field label="Garantía de colocación (meses)">
            <NumInput value={f.warrantyMonths} onChange={(v) => set('warrantyMonths', Math.round(v ?? 0))} />
          </Field>
        </div>
      </section>

      <Gate feature="installments" inline>
        <section className="card">
          <h2>Cuotas</h2>
          <p className="muted small">Recargo por cantidad de cuotas (por ejemplo, lo que te cobra Mercado Pago). Si cargás alguno, el cliente ve "o 6 cuotas de $X" en el presupuesto. Vacío = no se muestran.</p>
          <div className="form-grid">
            {['3', '6', '12'].map((n) => (
              <Field key={n} label={`${n} cuotas: recargo %`}>
                <NumInput
                  value={f.installmentRates[n] ?? null}
                  onChange={(v) => {
                    const r = { ...f.installmentRates };
                    if (v == null) delete r[n];
                    else r[n] = v;
                    set('installmentRates', r);
                  }}
                />
              </Field>
            ))}
          </div>
        </section>
      </Gate>

      <Gate feature="numbers" inline>
        <section className="card">
          <h2>Prueba de precio</h2>
          <p className="muted small">Si cerrás casi todos los presupuestos, quizás cobrás poco. Con un %, la mitad de los presupuestos nuevos sale con ese recargo y en Números ves si cierran igual. 0 = apagado.</p>
          <Field label="Recargo de prueba (%)">
            <NumInput value={f.priceTestPct} onChange={(v) => set('priceTestPct', v ?? 0)} />
          </Field>
        </section>
      </Gate>

      <Gate feature="cash" inline>
        <section className="card">
          <h2>Comisiones de cobro</h2>
          <p className="muted small">Lo que te descuenta cada medio de pago, en %. Sirve para saber cuánto te queda de verdad de cada cobro.</p>
          <div className="form-grid">
            {PAY_METHODS.filter((m) => m !== 'EFECTIVO' && m !== 'OTRO').map((m) => (
              <Field key={m} label={PAY_METHOD_LABEL[m]}>
                <NumInput value={f.payFees[m] ?? null} onChange={(v) => set('payFees', { ...f.payFees, [m]: v ?? 0 })} />
              </Field>
            ))}
          </div>
        </section>
        <section className="card">
          <h2>Monotributo</h2>
          <div className="form-grid">
            <Field label="Categoría" hint="Topes vigentes desde agosto 2026">
              <select value={f.monotributoCategory} onChange={(e) => set('monotributoCategory', e.target.value)}>
                <option value="">No soy monotributista / no sé</option>
                {Object.entries(MONOTRIBUTO_CAPS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {k} · hasta {money2(v)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tope propio (opcional)" hint="Si tu contador te indica otro número">
              <NumInput value={f.monotributoCap} onChange={(v) => set('monotributoCap', v)} />
            </Field>
          </div>
        </section>
      </Gate>

      <Gate feature="mercadopago" inline>
        <MercadoPago connected={f.mpConnected} onSaved={(b) => setF({ ...f, mpConnected: b.mpConnected })} />
      </Gate>

      <Gate feature="arca" inline>
        <Arca biz={f} onSaved={(b) => setF({ ...f, arcaReady: b.arcaReady, arcaCertLoaded: b.arcaCertLoaded, arcaCuit: b.arcaCuit, arcaPtoVta: b.arcaPtoVta, arcaProduction: b.arcaProduction })} />
      </Gate>

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

function MercadoPago({ connected, onSaved }: { connected: boolean; onSaved: (b: Business) => void }) {
  const [token, setToken] = useState('');
  const m = useMutation({
    mutationFn: (value: string | null) => api<Business>('/business', { method: 'PATCH', body: { mpAccessToken: value } }),
    onSuccess: (b) => {
      onSaved(b);
      setToken('');
      toast(b.mpConnected ? 'Mercado Pago conectado' : 'Mercado Pago desconectado');
    },
    onError: (e) => toast(errMsg(e)),
  });
  return (
    <section className="card">
      <h2>Mercado Pago</h2>
      <p className="muted small">
        Con Mercado Pago conectado, el cliente paga la seña desde el presupuesto y el cobro entra solo a la caja. La comisión la cobra Mercado Pago, como siempre. El token se saca en Mercado Pago → Tu negocio → Configuración → Credenciales (Access Token de producción).
      </p>
      {connected ? (
        <div className="row wrap">
          <span className="pill good">Conectado</span>
          <button type="button" className="btn small" onClick={() => m.mutate(null)}>
            Desconectar
          </button>
        </div>
      ) : (
        <div className="row wrap">
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="APP_USR-…" aria-label="Access Token de Mercado Pago" autoComplete="off" />
          <button type="button" className="btn primary" disabled={!token.trim() || m.isPending} onClick={() => m.mutate(token.trim())}>
            Conectar
          </button>
        </div>
      )}
    </section>
  );
}

function Arca({ biz, onSaved }: { biz: Business; onSaved: (b: Business) => void }) {
  const [f, setF] = useState({ arcaCuit: biz.arcaCuit, arcaPtoVta: biz.arcaPtoVta, arcaProduction: biz.arcaProduction, arcaCert: '', arcaKey: '' });
  const m = useMutation({
    mutationFn: () =>
      api<Business>('/business', {
        method: 'PATCH',
        body: { arcaCuit: f.arcaCuit, arcaPtoVta: f.arcaPtoVta, arcaProduction: f.arcaProduction, ...(f.arcaCert ? { arcaCert: f.arcaCert } : {}), ...(f.arcaKey ? { arcaKey: f.arcaKey } : {}) },
      }),
    onSuccess: (b) => {
      onSaved(b);
      setF({ ...f, arcaCert: '', arcaKey: '' });
      toast(b.arcaReady ? 'ARCA listo para facturar' : 'Guardado');
    },
    onError: (e) => toast(errMsg(e)),
  });
  const readFile = (k: 'arcaCert' | 'arcaKey') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setF({ ...f, [k]: await file.text() });
  };
  return (
    <section className="card" id="arca">
      <h2>Factura electrónica (ARCA)</h2>
      <p className="muted small">
        Emití la factura C desde la caja, sin pagar otro sistema. Necesitás un certificado digital de ARCA para "facturación electrónica" (wsfe) y un punto de venta tipo "Web services". Lo puede sacar tu contador en minutos.
      </p>
      <div className="form-grid">
        <Field label="CUIT">
          <input value={f.arcaCuit} inputMode="numeric" onChange={(e) => setF({ ...f, arcaCuit: e.target.value })} placeholder="20-12345678-9" />
        </Field>
        <Field label="Punto de venta">
          <NumInput value={f.arcaPtoVta} onChange={(v) => setF({ ...f, arcaPtoVta: Math.round(v ?? 1) })} />
        </Field>
        <label className="btn small">
          {f.arcaCert ? 'Certificado listo ✓' : biz.arcaCertLoaded ? 'Cambiar certificado (.crt)' : 'Subir certificado (.crt)'}
          <input type="file" accept=".crt,.pem,.cer,text/plain" hidden onChange={readFile('arcaCert')} />
        </label>
        <label className="btn small">
          {f.arcaKey ? 'Clave lista ✓' : biz.arcaCertLoaded ? 'Cambiar clave (.key)' : 'Subir clave privada (.key)'}
          <input type="file" accept=".key,.pem,text/plain" hidden onChange={readFile('arcaKey')} />
        </label>
        <label className="check">
          <input type="checkbox" checked={f.arcaProduction} onChange={(e) => setF({ ...f, arcaProduction: e.target.checked })} /> Facturar de verdad (sacalo para probar en homologación)
        </label>
        <div className="actions wide">
          {biz.arcaReady && <span className="pill good">Listo para facturar</span>}
          <button type="button" className="btn primary" disabled={m.isPending} onClick={() => m.mutate()}>
            Guardar datos de ARCA
          </button>
        </div>
      </div>
    </section>
  );
}

import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { activate, copy } from '../components/access';
import { moneyInput } from '../components/forms/money';
import { Icon } from '../components/icons';
import { Empty, Field, MoneyField, Seg, toast } from '../components/ui';
import { BRAND } from '../brand';
import { CONFIG } from '../config';
import { db, newId } from '../db/db';
import type { Sale, SalePlan, SellerKey } from '../db/types';
import { dayKey } from '../domain/dates';
import { type LicensePayload, PLAN_LABEL, formatId, generateSellerKey, normalizeId, publicFromPrivate, signCode } from '../domain/license';
import { toCsv } from '../domain/movements';
import { planRange, salesCsvRows, salesStats } from '../domain/sales';
import { useData } from '../lib/data';
import { dayFmt, money, parseNum } from '../lib/format';
import { download, shareText } from '../lib/share';

// Panel del vendedor: tu clave, los códigos que das cuando llega una transferencia, tus ventas y renovaciones.

const linkFor = (code: string) => `${location.origin}/activar#${code}`;

/** WhatsApp al cliente (o el menú de compartir si no hay número). */
function sendTo(phone: string | undefined, text: string) {
  const n = (phone ?? '').replace(/\D/g, '');
  if (n) window.open(`https://wa.me/${n}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  else void shareText(text);
}

function KeyCard({ k }: { k: SellerKey | null }) {
  const file = useRef<HTMLInputElement>(null);
  const create = async () => {
    const { privateJwk, publicKey } = await generateSellerKey();
    await db.seller.put({ id: 'main', privateJwk, publicKey, createdAt: new Date().toISOString() });
    toast('Clave creada. Ahora bajala y guardala aparte.');
  };
  const load = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as { privateJwk?: JsonWebKey } & JsonWebKey;
      const jwk = data.privateJwk ?? data;
      if (!jwk.d) throw new Error();
      await db.seller.put({ id: 'main', privateJwk: jwk, publicKey: await publicFromPrivate(jwk), createdAt: new Date().toISOString() });
      toast('Clave cargada');
    } catch {
      toast('Ese archivo no es una clave de vendedor.');
    }
  };
  const save = () => {
    if (!k) return;
    const blob = new Blob([JSON.stringify({ app: 'rinde-vendedor', privateJwk: k.privateJwk, publicKey: k.publicKey }, null, 2)], { type: 'application/json' });
    download(blob, 'clave-vendedor.json');
  };
  const known = !!k && CONFIG.licenseKeys.includes(k.publicKey);
  return (
    <section className="card stack">
      <h2>Tu clave de vendedor</h2>
      {!k ? (
        <>
          <p className="muted small">Con tu clave generás los códigos de activación. Se crea una sola vez y vive solo en este celular.</p>
          <button type="button" className="primary" onClick={() => void create()}>
            Crear mi clave de vendedor
          </button>
          <button type="button" onClick={() => file.current?.click()}>
            <Icon name="upload" /> Ya tengo una: cargar mi clave
          </button>
          <input ref={file} type="file" accept="application/json,.json" hidden data-testid="seller-key" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0]).finally(() => (e.target.value = ''))} />
        </>
      ) : (
        <>
          <p className={known ? 'small good' : 'notice'}>
            {known
              ? 'Listo: esta versión de la app reconoce tu clave. Los códigos que generes sirven.'
              : 'Falta un paso: copiá la clave pública, pegala en Render (tu sitio → Environment → VITE_LICENSE_PUBLIC_KEYS) y volvé a desplegar. Hasta entonces la app no pide códigos.'}
          </p>
          <Field label="Clave pública (para Render)">
            <textarea readOnly value={k.publicKey} rows={2} className="mono" onFocus={(e) => e.target.select()} />
          </Field>
          <div className="grid2">
            <button type="button" onClick={() => void copy(k.publicKey, 'Clave pública copiada')}>
              Copiar clave pública
            </button>
            <button type="button" onClick={save}>
              <Icon name="download" /> Bajar mi clave
            </button>
          </div>
          <p className="hint">Guardá el archivo de tu clave en un lugar seguro (Drive o tu WhatsApp). Si perdés el celular sin él, los códigos nuevos dejan de servir. No se lo pases a nadie.</p>
        </>
      )}
    </section>
  );
}

function NewCode({ k, sales }: { k: SellerKey; sales: Sale[] }) {
  const d = useData();
  const today = dayKey(d.now);
  const [promo, setPromo] = useState(false);
  const [device, setDevice] = useState('');
  const [plan, setPlan] = useState<'anual' | 'mes'>('anual');
  const [promoDays, setPromoDays] = useState('7');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState(moneyInput(CONFIG.prices.anual));
  const [done, setDone] = useState<Sale | null>(null);
  const id = normalizeId(device);
  const kind: SalePlan = promo ? 'promo' : plan;
  const range = planRange(kind, promo ? undefined : id, sales, today, Number(promoDays) || 7);
  const mine = d.settings.installId;

  // Formulario limpio para el próximo cliente.
  const reset = () => {
    setDone(null);
    setDevice('');
    setName('');
    setPhone('');
  };
  const pickPlan = (p: 'anual' | 'mes') => {
    setPlan(p);
    setAmount(moneyInput(CONFIG.prices[p]));
  };
  const generate = async () => {
    if (!promo && id.length !== 8) return toast('El código del celular tiene 8 letras y números (te lo pasa el cliente).');
    const payload: LicensePayload = { v: 1, d: promo ? '' : id, p: kind, s: range.starts, x: range.expires, ...(name.trim() ? { n: name.trim() } : {}) };
    const code = await signCode(k.privateJwk, payload);
    const sale: Sale = {
      id: newId(),
      at: new Date().toISOString(),
      installId: promo ? undefined : id,
      plan: kind,
      starts: range.starts,
      expires: range.expires,
      name: name.trim() || undefined,
      phone: phone.replace(/\D/g, '') || undefined,
      amount: parseNum(amount) ?? 0,
      code,
    };
    await db.sales.add(sale);
    setDone(sale);
  };
  const message = (s: Sale) =>
    `${s.name ? `Hola ${s.name}! ` : 'Hola! '}${s.plan === 'promo' ? `Te regalo ${BRAND.name} hasta el ${dayFmt(s.expires)}.` : `Ya llegó tu pago. Tu ${BRAND.name} (plan ${PLAN_LABEL[s.plan].toLowerCase()}) queda activo hasta el ${dayFmt(s.expires)}.`} Tocá este link desde el celular donde tenés la app para activarla: ${linkFor(s.code)}`;

  if (done)
    return (
      <section className="card stack">
        <h2>Código listo</h2>
        <p className="small">
          {done.name ?? 'Cliente'} · {PLAN_LABEL[done.plan]} · vale del {dayFmt(done.starts)} al {dayFmt(done.expires)}
          {done.installId ? ` · celular ${formatId(done.installId)}` : ' · para cualquier celular'}
        </p>
        <Field label="Link de activación">
          <textarea readOnly value={linkFor(done.code)} rows={3} className="mono" data-testid="activation-link" onFocus={(e) => e.target.select()} />
        </Field>
        <button type="button" className="primary" onClick={() => sendTo(done.phone, message(done))}>
          <Icon name="share" /> Mandar por WhatsApp
        </button>
        <div className="grid2">
          <button type="button" onClick={() => void copy(linkFor(done.code), 'Link copiado')}>
            Copiar link
          </button>
          {done.installId && done.installId === mine ? (
            <button
              type="button"
              onClick={() =>
                void activate(done.code, mine).then((r) => toast('error' in r ? r.error : `Activada en este celular hasta el ${dayFmt(r.until)}`))
              }
            >
              Activar en este celular
            </button>
          ) : (
            <button type="button" onClick={reset}>
              Otro código
            </button>
          )}
        </div>
      </section>
    );

  return (
    <section className="card stack">
      <h2>Nuevo código</h2>
      <p className="muted small">Cuando te llega la transferencia, cargá el código de celular que te mandó el cliente.</p>
      <Seg
        label="Para quién"
        options={[
          { id: 'device', label: 'Para un celular' },
          { id: 'promo', label: 'Promo para cualquiera' },
        ]}
        value={promo ? 'promo' : 'device'}
        onChange={(v) => {
          setPromo(v === 'promo');
          setAmount(v === 'promo' ? '' : moneyInput(CONFIG.prices[plan]));
        }}
      />
      {promo ? (
        <Field label="Días" hint="Cualquiera que tenga el link lo puede usar: ideal para regalos o promociones cortas.">
          <input inputMode="numeric" value={promoDays} onChange={(e) => setPromoDays(e.target.value.replace(/\D/g, '').slice(0, 3))} />
        </Field>
      ) : (
        <>
          <Field label="Código del celular del cliente" hint={mine ? `El de este celular es ${formatId(mine)}.` : undefined}>
            <input value={device} onChange={(e) => setDevice(e.target.value)} placeholder="K7P2-9QXM" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
          </Field>
          {mine && id !== mine && (
            <button type="button" className="link" onClick={() => setDevice(formatId(mine))} style={{ alignSelf: 'flex-start' }}>
              Es para este celular
            </button>
          )}
          <Seg
            label="Plan"
            options={[
              { id: 'anual', label: `Anual (${money(CONFIG.prices.anual)})` },
              { id: 'mes', label: `Mensual (${money(CONFIG.prices.mes)})` },
            ]}
            value={plan}
            onChange={pickPlan}
          />
        </>
      )}
      <div className="grid2">
        <Field label="Nombre (opcional)">
          <input value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="words" />
        </Field>
        <Field label="WhatsApp (opcional)">
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11 2233 4455" />
        </Field>
      </div>
      <MoneyField label="Cobraste" value={amount} onChange={setAmount} />
      <p className="small">
        Vale del {dayFmt(range.starts)} al {dayFmt(range.expires)}
        {range.renewal ? ' (renovación: arranca cuando termina el plan que tiene)' : ''}.
      </p>
      <button type="button" className="primary" onClick={() => void generate()}>
        Generar código
      </button>
    </section>
  );
}

function SalesCards({ sales }: { sales: Sale[] }) {
  const d = useData();
  const today = dayKey(d.now);
  const st = salesStats(sales, today, CONFIG.prices);
  const { pay } = CONFIG;
  const renewMsg = (s: Sale) =>
    `${s.name ? `Hola ${s.name}! ` : 'Hola! '}Tu ${BRAND.name} vence el ${dayFmt(s.expires)}. Para renovar transferí ${money(CONFIG.prices.anual)} (un año) o ${money(CONFIG.prices.mes)} (un mes)${pay.alias ? ` al alias ${pay.alias}` : ''} y mandame el comprobante. ¡Gracias!`;
  const csv = () => download(new Blob([toCsv(salesCsvRows(sales))], { type: 'text/csv;charset=utf-8' }), `ventas-${today}.csv`);
  const recent = [...sales].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
  return (
    <>
      <section className="card stack-s">
        <h2>Tus ventas</h2>
        <div className="stats" style={{ marginTop: 0 }}>
          <div className="stat">
            <div className="l">Clientes activos</div>
            <div className="v">{st.active.anual + st.active.mes}</div>
            <div className="s">
              {st.active.anual} {st.active.anual === 1 ? 'anual' : 'anuales'} · {st.active.mes} {st.active.mes === 1 ? 'mensual' : 'mensuales'}
              {st.active.promo ? ` · ${st.active.promo} promo` : ''}
            </div>
          </div>
          <div className="stat">
            <div className="l">Estimado por año</div>
            <div className="v" data-testid="yearly">
              {money(st.yearly)}
            </div>
            <div className="s">Si todos renuevan</div>
          </div>
          <div className="stat">
            <div className="l">Cobrado este mes</div>
            <div className="v">{money(st.month.total)}</div>
            <div className="s">{st.month.count === 1 ? '1 código' : `${st.month.count} códigos`}</div>
          </div>
        </div>
      </section>

      <section className="card stack-s">
        <h2>Próximos vencimientos</h2>
        {st.upcoming.length ? (
          <div className="list">
            {st.upcoming.map((s) => (
              <div key={s.id} className="item">
                <span className="grow">
                  <div className="t">{s.name ?? (s.installId ? formatId(s.installId) : 'Cliente')}</div>
                  <div className="d">
                    {PLAN_LABEL[s.plan]} · vence el {dayFmt(s.expires)}
                  </div>
                </span>
                <button type="button" className="small" onClick={() => sendTo(s.phone, renewMsg(s))}>
                  Avisar
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="Nadie vence en los próximos 30 días." />
        )}
      </section>

      <section className="card stack-s">
        <div className="row between">
          <h2>Códigos que diste</h2>
          {sales.length > 0 && (
            <button type="button" className="ghost small" onClick={csv}>
              <Icon name="download" /> Excel
            </button>
          )}
        </div>
        {recent.length ? (
          <div className="list">
            {recent.map((s) => (
              <div key={s.id} className="item">
                <span className="grow">
                  <div className="t">{s.name ?? (s.installId ? formatId(s.installId) : 'Promo')}</div>
                  <div className="d">
                    {dayFmt(dayKey(s.at))} · {PLAN_LABEL[s.plan]} · hasta el {dayFmt(s.expires)}
                  </div>
                </span>
                <span className="amt">{money(s.amount)}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="Todavía no diste ningún código." />
        )}
      </section>
    </>
  );
}

export function Seller() {
  const key = useLiveQuery(() => db.seller.get('main'), [], 'loading' as const);
  const sales = useLiveQuery(() => db.sales.toArray(), [], [] as Sale[]);
  if (key === 'loading') return null;
  return (
    <div className="stack">
      <h1>Vendedor</h1>
      <KeyCard k={key ?? null} />
      {key && <NewCode k={key} sales={sales} />}
      {key && <SalesCards sales={sales} />}
    </div>
  );
}

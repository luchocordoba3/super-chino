import { useEffect, useState } from 'react';
import { BRAND } from '../brand';
import { CONFIG } from '../config';
import { saveSettings } from '../db/repo';
import type { SalePlan } from '../db/types';
import { dayKey } from '../domain/dates';
import { codeProblem, extractCode, formatId, PLAN_LABEL, verifyCode } from '../domain/license';
import { useData } from '../lib/data';
import { dayFmt, money } from '../lib/format';
import { shareText } from '../lib/share';
import { Icon } from './icons';
import { Field, Sheet, toast } from './ui';

// Prueba, compra casera (transferencia + comprobante por WhatsApp) y código de activación.

type Listener = (kind: 'buy' | 'code') => void;
const listeners = new Set<Listener>();
/** Abre la hoja para comprar o renovar (o la de ingresar código) desde cualquier pantalla. */
export const openBuy = (kind: 'buy' | 'code' = 'buy') => listeners.forEach((l) => l(kind));

/** Envuelve una acción de "anotar algo nuevo": si el plan venció, abre la hoja de compra en vez de la acción. */
export function useGuard() {
  const d = useData();
  return <A extends unknown[]>(fn: (...a: A) => void) =>
    (...a: A) =>
      d.writable ? fn(...a) : openBuy('buy');
}

/** Copia al portapapeles con aviso. */
export async function copy(text: string, what = 'Copiado') {
  try {
    await navigator.clipboard.writeText(text);
    toast(what);
  } catch {
    toast('No se pudo copiar. Mantené apretado el texto para copiarlo.');
  }
}

/** Verifica un código (o link) pegado y lo guarda. Devuelve el error para mostrar, o null si quedó activo. */
export async function activate(text: string, installId: string | undefined): Promise<{ error: string } | { until: string; plan: SalePlan }> {
  const code = extractCode(text);
  const p = await verifyCode(code, CONFIG.licenseKeys);
  if (!p) return { error: 'El código no es válido. Copialo completo, tal cual te llegó.' };
  const problem = codeProblem(p, installId, dayKey(new Date()));
  if (problem) return { error: problem };
  await saveSettings({ license: code });
  return { until: p.x, plan: p.p };
}

/** WhatsApp al vendedor con el mensaje armado. Sin número configurado, el menú de compartir. */
export function whatsappSeller(text: string) {
  if (CONFIG.sellerWhatsapp) window.open(`https://wa.me/${CONFIG.sellerWhatsapp}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  else void shareText(text);
}

function PayRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="item pay-row">
      <span className="grow">
        <div className="d">{label}</div>
        <div className="t">{value}</div>
      </span>
      <button type="button" className="ghost small" onClick={() => void copy(value, `${label} copiado`)} aria-label={`Copiar ${label.toLowerCase()}`}>
        Copiar
      </button>
    </div>
  );
}

export function BuySheet({ onClose, onCode }: { onClose: () => void; onCode: () => void }) {
  const d = useData();
  const [plan, setPlan] = useState<'anual' | 'mes'>('anual');
  const { prices, pay } = CONFIG;
  const id = formatId(d.settings.installId ?? '');
  const a = d.access;
  const saving = prices.mes * 12 - prices.anual;
  const msg = `Hola! Quiero activar ${BRAND.name}, plan ${PLAN_LABEL[plan].toLowerCase()} (${money(prices[plan])}). Mi código de celular es ${id}. Te paso el comprobante.`;
  const hasPay = pay.alias || pay.cbu;
  return (
    <Sheet title={a.state === 'active' ? 'Renovar tu plan' : `Activá ${BRAND.name}`} onClose={onClose}>
      {a.state === 'expired' && (
        <p className="notice">
          {a.wasTrial ? 'Se terminó la prueba gratis.' : 'Venció tu plan.'} Podés ver todo y hacer la copia; para anotar cosas nuevas, activá un plan.
        </p>
      )}
      {a.state === 'trial' && <p className="muted small">Te quedan {a.daysLeft === 1 ? '1 día' : `${a.daysLeft} días`} de prueba gratis.</p>}
      {a.state === 'active' && <p className="muted small">Tu plan vale hasta el {dayFmt(a.until)}. Si renovás ahora, el nuevo arranca cuando termine este.</p>}

      <div className="plans" role="radiogroup" aria-label="Plan">
        <button type="button" role="radio" aria-checked={plan === 'anual'} className={`plan ${plan === 'anual' ? 'on' : ''}`} onClick={() => setPlan('anual')}>
          <span className="pl-name">Anual</span>
          <span className="pl-price">{money(prices.anual)}</span>
          <span className="pl-note">{saving > 0 ? `Ahorrás ${money(saving)} contra 12 meses` : '365 días'}</span>
        </button>
        <button type="button" role="radio" aria-checked={plan === 'mes'} className={`plan ${plan === 'mes' ? 'on' : ''}`} onClick={() => setPlan('mes')}>
          <span className="pl-name">Mensual</span>
          <span className="pl-price">{money(prices.mes)}</span>
          <span className="pl-note">30 días</span>
        </button>
      </div>

      <h3>1. Transferí {money(prices[plan])}</h3>
      {hasPay ? (
        <div className="list">
          {pay.alias && <PayRow label="Alias" value={pay.alias} />}
          {pay.cbu && <PayRow label="CBU / CVU" value={pay.cbu} />}
          {(pay.holder || pay.bank) && (
            <div className="item pay-row">
              <span className="grow">
                <div className="d">Titular</div>
                <div className="t">{[pay.holder, pay.bank].filter(Boolean).join(' · ')}</div>
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="muted small">Pedile los datos para transferir al vendedor por WhatsApp.</p>
      )}

      <h3>2. Mandá el comprobante</h3>
      <p className="muted small">
        Con tu código de celular: <strong className="mono">{id}</strong>
      </p>
      <button type="button" className="primary" onClick={() => whatsappSeller(msg)}>
        <Icon name="share" /> Mandar comprobante por WhatsApp
      </button>

      <h3>3. Cargá el código que te llega</h3>
      <p className="muted small">Cuando llega la transferencia te mandamos un link: lo tocás y queda activada. O pegá el código acá.</p>
      <button type="button" onClick={onCode}>
        Ingresar código
      </button>
    </Sheet>
  );
}

export function CodeSheet({ onClose }: { onClose: () => void }) {
  const d = useData();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await activate(text, d.settings.installId);
    setBusy(false);
    if ('error' in r) return toast(r.error);
    toast(`¡Listo! ${BRAND.name} activa hasta el ${dayFmt(r.until)}`);
    onClose();
  };
  return (
    <Sheet
      title="Ingresar código"
      onClose={onClose}
      footer={
        <button type="button" className="primary" onClick={() => void save()} disabled={busy || !text.trim()}>
          Activar
        </button>
      }
    >
      <Field label="Código o link de activación" hint={`Tu código de celular es ${formatId(d.settings.installId ?? '')}.`}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </Field>
    </Sheet>
  );
}

/** Escucha openBuy() y muestra la hoja de compra o la de ingresar código. Va una sola vez, en el Layout. */
export function BuyHost() {
  const [sheet, setSheet] = useState<'buy' | 'code' | null>(null);
  useEffect(() => {
    const l: Listener = (kind) => setSheet(kind);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  if (sheet === 'buy') return <BuySheet onClose={() => setSheet(null)} onCode={() => setSheet('code')} />;
  if (sheet === 'code') return <CodeSheet onClose={() => setSheet(null)} />;
  return null;
}

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';

// Piezas de pantalla. Field, toast y Toaster vienen de Super Chino.

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

const intFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

/** Km del odómetro: solo cifras, con puntos de miles mientras escribís. */
export function KmField({ label, value, onChange, hint, big }: { label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode; big?: boolean }) {
  return (
    <Field label={label} hint={hint}>
      <input
        inputMode="numeric"
        autoComplete="off"
        className={big ? 'big-input' : undefined}
        value={value}
        placeholder="0"
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 7);
          onChange(digits ? intFmt.format(Number(digits)) : '');
        }}
      />
    </Field>
  );
}

/** Pesos: puntos de miles mientras escribís y coma para centavos. */
export function MoneyField({ label, value, onChange, hint, big, autoFocus }: { label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode; big?: boolean; autoFocus?: boolean }) {
  return (
    <Field label={label} hint={hint}>
      <input
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        className={big ? 'big-input' : undefined}
        value={value}
        placeholder="$ 0"
        onChange={(e) => {
          const s = e.target.value.replace(/[^\d,]/g, '');
          const [int, ...rest] = s.split(',');
          const digits = int.replace(/^0+(?=\d)/, '').slice(0, 10);
          const dec = rest.join('').slice(0, 2);
          onChange((digits ? intFmt.format(Number(digits)) : rest.length ? '0' : '') + (s.includes(',') ? `,${dec}` : ''));
        }}
      />
    </Field>
  );
}

/** Cantidad con decimales (litros, m³, porcentaje). */
export function QtyField({ label, value, onChange, hint }: { label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode }) {
  return (
    <Field label={label} hint={hint}>
      <input inputMode="decimal" autoComplete="off" value={value} placeholder="0" onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))} />
    </Field>
  );
}

/** Hoja que sube desde abajo (en la compu, ventana al medio). */
export function Sheet({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);
  return createPortal(
    <div className="sheet-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="grab" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="ghost small" onClick={onClose} aria-label="Cerrar">
            <Icon name="x" />
          </button>
        </div>
        <div className="stack">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Seg<T extends string | number>({ options, value, onChange, label }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.id)} type="button" role="radio" aria-checked={o.id === value} className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="stat">
      <div className="l">{label}</div>
      <div className={`v ${tone ?? ''}`}>{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

export function Meter({ value, state, label }: { value: number; state: 'ok' | 'soon' | 'due' | 'unknown'; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={`meter ${state}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ text }: { text: ReactNode }) {
  return <p className="empty">{text}</p>;
}

// Aviso flotante simple: toast('Guardado')
type Listener = (msg: string) => void;
const listeners = new Set<Listener>();
export const toast = (msg: string) => listeners.forEach((l) => l(msg));

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const l: Listener = (m) => {
      setMsg(m);
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 2600);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
      clearTimeout(timer);
    };
  }, []);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

/** Botonera de guardar/borrar al pie de una hoja. */
export function SaveBar({ onSave, onDelete, saving, label = 'Guardar' }: { onSave: () => void; onDelete?: () => void; saving?: boolean; label?: string }) {
  return (
    <>
      {onDelete && (
        <button type="button" className="danger" onClick={onDelete}>
          Borrar
        </button>
      )}
      <button type="button" className="primary" onClick={onSave} disabled={saving}>
        {label}
      </button>
    </>
  );
}

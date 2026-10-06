import { type ReactNode, useEffect, useState } from 'react';
import { QUOTE_STATUS_LABEL, type QuoteStatus } from '@vidrieria/shared';
import { errMsg } from '../api';
import { parseNumber } from '../lib/sheet';

export function Field({ label, hint, children, wide }: { label: ReactNode; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={'field' + (wide ? ' wide' : '')}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export const Loading = () => <p className="muted pad">Cargando…</p>;

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {errMsg(error)}
    </p>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} type="button" aria-label="Cerrar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const STATUS_TONE: Record<QuoteStatus, string> = {
  DRAFT: 'neutral',
  SENT: 'info',
  VIEWED: 'warn',
  ACCEPTED: 'good',
  REJECTED: 'bad',
  EXPIRED: 'neutral',
};

export const StatusChip = ({ status }: { status: QuoteStatus }) => <span className={`chip-status ${STATUS_TONE[status]}`}>{QUOTE_STATUS_LABEL[status]}</span>;

type Listener = (msg: string) => void;
const listeners = new Set<Listener>();
/** Aviso flotante: toast('Guardado') */
export const toast = (msg: string) => listeners.forEach((l) => l(msg));

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const l: Listener = (m) => {
      setMsg(m);
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 3000);
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

/** Input numérico que acepta coma decimal y deja el campo vacío mientras se escribe. */
export function NumInput({
  value,
  onChange,
  placeholder,
  className,
  id,
  ariaLabel,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  ariaLabel?: string;
}) {
  const fmt = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));
  const [text, setText] = useState(fmt(value));
  useEffect(() => {
    const parsed = text.trim() === '' ? null : parseNumber(text);
    if (parsed !== value) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      className={className}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const s = e.target.value.trim();
        if (s === '') return onChange(null);
        const n = parseNumber(s);
        if (n != null) onChange(n);
      }}
    />
  );
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado');
  } catch {
    window.prompt('Copiá el texto:', text);
  }
}

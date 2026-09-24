import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errMsg } from '../api';

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Loading() {
  const { t } = useTranslation();
  return <p className="muted">{t('common.loading')}</p>;
}

export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <p className="error">
      {t('common.error')}: {errMsg(error)}
    </p>
  );
}

export function Empty({ text }: { text?: string }) {
  const { t } = useTranslation();
  return <p className="muted">{text ?? t('common.noData')}</p>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button key={tab.id} className={tab.id === value ? 'active' : ''} onClick={() => onChange(tab.id)} type="button">
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog">
        <div className="row between">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} type="button" aria-label="close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
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
      timer = setTimeout(() => setMsg(null), 3000);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
      clearTimeout(timer);
    };
  }, []);
  return msg ? <div className="toast">{msg}</div> : null;
}

/** Número desde un input (vacío = null). */
export const toNum = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// Piezas que comparten las pantallas de la casa de celulares (solo en español).
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isValidImei, waLink } from '@super-chino/shared';
import { api, errMsg } from '../api';
import { ScanButton } from '../components/BarcodeScanner';
import { Field, toast } from '../components/ui';
import { money } from '../lib/format';

export const usd = (n: number | null | undefined) => `US$ ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n ?? 0)}`;
export const inCur = (n: number | null | undefined, currency: string) => (currency === 'USD' ? usd(n) : money(n));
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface Fx {
  rate: number | null;
  quotes: { casa: string; compra: number; venta: number; fetchedAt: string }[];
}
/** Cotización del local (pesos por dólar). */
export function useFx() {
  return useQuery({ queryKey: ['fx'], queryFn: () => api<Fx>('/fx'), staleTime: 60_000, refetchInterval: 5 * 60_000 });
}
/** Precio en su moneda -> pesos. */
export const toArs = (amount: number, currency: string, rate: number | null | undefined) => (currency === 'USD' ? round2(amount * (rate ?? 0)) : amount);

export interface Customer {
  id: string;
  name: string;
  dni: string | null;
  phone: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
}

/** Buscar un cliente por nombre, DNI o teléfono, o cargar uno nuevo. */
export function CustomerPicker({ value, onChange, required }: { value: Customer | null; onChange: (c: Customer | null) => void; required?: boolean }) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', dni: '', phone: '' });
  const list = useQuery({ queryKey: ['customers', q], queryFn: () => api<Customer[]>(`/customers?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 && !value });
  if (value) {
    return (
      <div className="row card" style={{ padding: 10 }}>
        <div className="grow">
          <strong>{value.name}</strong>
          <div className="small muted">{[value.dni && `DNI ${value.dni}`, value.phone].filter(Boolean).join(' · ')}</div>
        </div>
        <button type="button" className="small" onClick={() => onChange(null)}>
          Cambiar
        </button>
      </div>
    );
  }
  const create = async () => {
    if (!form.name.trim()) return;
    try {
      onChange(await api<Customer>('/customers', { body: { name: form.name, dni: form.dni || null, phone: form.phone || null } }));
      setCreating(false);
    } catch (e) {
      toast(errMsg(e));
    }
  };
  return (
    <div className="stack">
      {!creating ? (
        <>
          <input placeholder={`Buscar cliente (nombre, DNI o teléfono)${required ? ' *' : ''}`} value={q} onChange={(e) => setQ(e.target.value)} />
          {list.data?.slice(0, 8).map((c) => (
            <button type="button" key={c.id} className="small" style={{ justifyContent: 'flex-start' }} onClick={() => onChange(c)}>
              {c.name} <span className="muted">{[c.dni, c.phone].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          <button type="button" className="small" onClick={() => (setCreating(true), setForm({ ...form, name: /\d/.test(q) ? '' : q }))}>
            + Cliente nuevo
          </button>
        </>
      ) : (
        <div className="grid2">
          <Field label="Nombre y apellido *">
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="DNI">
            <input inputMode="numeric" value={form.dni} onChange={(e) => setForm({ ...form, dni: e.target.value })} />
          </Field>
          <Field label="WhatsApp" hint="Con código de área, sin 0 ni 15">
            <input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <div className="row">
            <button type="button" className="primary" onClick={() => void create()}>
              Guardar cliente
            </button>
            <button type="button" className="ghost" onClick={() => setCreating(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export interface ProductLite {
  id: string;
  name: string;
  price: number;
  currency: string;
  serialized: boolean;
  isService: boolean;
  stock: number;
  barcode: string | null;
}

/** Elegir un producto del catálogo (modelos de celular, accesorios o repuestos). */
export function ProductPicker({ onPick, placeholder, filter }: { onPick: (p: ProductLite) => void; placeholder?: string; filter?: (p: ProductLite) => boolean }) {
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['products', 'pick', q], queryFn: () => api<ProductLite[]>(`/products?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 });
  const rows = (list.data ?? []).filter((p) => !filter || filter(p)).slice(0, 10);
  return (
    <div className="stack">
      <input placeholder={placeholder ?? 'Buscar producto o modelo'} value={q} onChange={(e) => setQ(e.target.value)} />
      {rows.map((p) => (
        <button
          type="button"
          key={p.id}
          className="small"
          style={{ justifyContent: 'space-between' }}
          onClick={() => {
            onPick(p);
            setQ('');
          }}
        >
          <span>{p.name}</span>
          <span className="muted">
            {inCur(p.price, p.currency)} · stock {p.stock}
          </span>
        </button>
      ))}
    </div>
  );
}

/** IMEI con lector de cámara y control del dígito verificador. */
export function ImeiInput({ value, onChange, label = 'IMEI', autoFocus, onEnter }: { value: string; onChange: (v: string) => void; label?: string; autoFocus?: boolean; onEnter?: () => void }) {
  const clean = value.replace(/\D/g, '');
  const bad = clean.length > 0 && clean.length >= 15 && !isValidImei(clean);
  return (
    <Field label={label} hint={bad ? <span className="error">El IMEI no es válido (revisá los números)</span> : clean.length === 15 ? <span className="ok">IMEI válido ✓</span> : 'Marcá *#06# en el equipo o escaneá la caja'}>
      <div className="row">
        <input
          className="grow"
          style={{ width: 'auto' }}
          inputMode="numeric"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
        />
        <ScanButton onCode={(c) => onChange(c.replace(/\D/g, '').slice(0, 15))} />
      </div>
    </Field>
  );
}

/** Subir una foto (en el celular abre la cámara). */
export function PhotoButton({ label, url, upload }: { label: string; url?: string | null; upload: (f: File) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className="card stack" style={{ padding: 10, cursor: 'pointer', alignItems: 'center', textAlign: 'center' }}>
      {url ? <img src={url} alt={label} style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8 }} /> : <span style={{ fontSize: '2rem' }}>📷</span>}
      <span className="small">
        {busy ? 'Subiendo…' : label} {url ? '✓' : ''}
      </span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            await upload(f);
          } catch (err) {
            toast(errMsg(err));
          } finally {
            setBusy(false);
            e.target.value = '';
          }
        }}
      />
    </label>
  );
}

/** Sube una imagen a un endpoint multipart. */
export async function uploadImage(path: string, file: Blob, name = 'foto.jpg') {
  const form = new FormData();
  form.append('photo', file, name);
  return api<{ url?: string; path?: string }>(path, { method: 'POST', form });
}

/** Firma con el dedo (o el mouse). Devuelve un PNG. */
export function SignaturePad({ onSave, saved }: { onSave: (png: Blob) => Promise<unknown>; saved?: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
    const pos = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height] as const;
    };
    const down = (e: PointerEvent) => {
      drawing.current = true;
      const [x, y] = pos(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    };
    const move = (e: PointerEvent) => {
      if (!drawing.current) return;
      e.preventDefault();
      const [x, y] = pos(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      setDirty(true);
    };
    const up = () => (drawing.current = false);
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);
  const clear = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setDirty(false);
  };
  return (
    <div className="stack">
      {saved && <img src={saved} alt="firma" style={{ maxHeight: 80, alignSelf: 'flex-start', border: '1px solid var(--line)', borderRadius: 8 }} />}
      <canvas ref={canvas} width={600} height={200} style={{ width: '100%', height: 140, border: '1px dashed #999', borderRadius: 10, background: '#fff', touchAction: 'none' }} />
      <div className="row">
        <button type="button" className="small" onClick={clear}>
          Borrar
        </button>
        <button type="button" className="small primary" disabled={!dirty} onClick={() => canvas.current!.toBlob((b) => b && void onSave(b).then(() => toast('Firma guardada')), 'image/png')}>
          Guardar firma
        </button>
      </div>
    </div>
  );
}

/** Botón que abre WhatsApp con el mensaje ya escrito. */
export function WaButton({ phone, text, children = 'WhatsApp' }: { phone: string | null | undefined; text: string; children?: ReactNode }) {
  return (
    <a className="btn" style={{ background: '#25d366', color: '#fff', borderColor: '#25d366' }} href={waLink(phone, text)} target="_blank" rel="noreferrer">
      💬 {children}
    </a>
  );
}

/** Patrón de desbloqueo de Android: se tocan los puntos en orden (queda como "1-5-9-6"). */
export function PatternPad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const seq = value ? value.split('-').map(Number) : [];
  return (
    <div className="stack" style={{ alignItems: 'flex-start' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 48px)', gap: 10 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
          const i = seq.indexOf(n);
          return (
            <button type="button" key={n} className={i >= 0 ? 'primary' : ''} style={{ borderRadius: '50%', height: 48, padding: 0 }} onClick={() => i < 0 && onChange([...seq, n].join('-'))}>
              {i >= 0 ? i + 1 : '•'}
            </button>
          );
        })}
      </div>
      <button type="button" className="small ghost" onClick={() => onChange('')}>
        Borrar patrón
      </button>
    </div>
  );
}

/** Descargar una tabla como CSV (abre en Excel). */
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: 'green',
  RESERVED: 'gold',
  IN_REPAIR: 'gold',
  SOLD: 'gray',
  RMA: 'red',
  SCRAPPED: 'gray',
  RECEIVED: 'gray',
  DIAGNOSIS: 'gold',
  QUOTE_SENT: 'gold',
  APPROVED: 'green',
  REJECTED: 'red',
  WAITING_PART: 'gold',
  READY: 'green',
  DELIVERED: 'gray',
  CANCELLED: 'gray',
  INQUIRY: 'gray',
  PAID: 'green',
  PREPARING: 'gold',
  ASSIGNED: 'gold',
  ON_THE_WAY: 'gold',
  FAILED: 'red',
  RETURNED: 'red',
  DRAFT: 'gold',
  ACCEPTED: 'green',
  ACTIVE: 'gold',
  USED: 'gray',
  EXPIRED: 'red',
};
export const Badge = ({ status, label }: { status: string; label: string }) => <span className={`badge ${STATUS_COLORS[status] ?? 'gray'}`}>{label}</span>;

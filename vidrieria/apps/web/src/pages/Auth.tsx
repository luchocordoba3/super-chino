import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ErrorBox, Field } from '../components/ui';
import { forgetMe } from '../lib/me';

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <Link to="/" className="auth-brand">
          <span className="brand-mark" aria-hidden="true" /> Lumina
        </Link>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const m = useMutation({
    mutationFn: () => api('/auth/login', { body: { email, password } }),
    onSuccess: () => {
      qc.clear();
      forgetMe();
      nav('/panel');
    },
  });
  return (
    <AuthShell title="Entrar a tu panel">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Email">
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Contraseña">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorBox error={m.error} />
        <button className="btn primary block" disabled={m.isPending}>
          {m.isPending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="muted small">
        ¿Tu vidriería todavía no tiene cuenta? <Link to="/crear-cuenta">Creala gratis</Link>
      </p>
    </AuthShell>
  );
}

export function Signup() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState({ businessName: '', name: '', email: '', password: '', whatsapp: '', zones: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => api('/auth/signup', { body: f }),
    onSuccess: () => {
      qc.clear();
      forgetMe();
      nav('/panel');
    },
  });
  return (
    <AuthShell title="Crear la cuenta de tu vidriería">
      <p className="muted">Arrancás con precios de ejemplo y plantillas de mamparas, espejos, cambio de vidrio y barandas. Después cargás tus precios.</p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
      >
        <Field label="Nombre de la vidriería">
          <input value={f.businessName} onChange={set('businessName')} required />
        </Field>
        <Field label="Tu nombre">
          <input value={f.name} onChange={set('name')} autoComplete="name" required />
        </Field>
        <Field label="WhatsApp del negocio">
          <input value={f.whatsapp} onChange={set('whatsapp')} inputMode="tel" placeholder="11 2345-6789" />
        </Field>
        <Field label="Zonas que cubrís" hint="Ej.: CABA y zona norte">
          <input value={f.zones} onChange={set('zones')} />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email} onChange={set('email')} autoComplete="email" required />
        </Field>
        <Field label="Contraseña" hint="Al menos 8 caracteres">
          <input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" minLength={8} required />
        </Field>
        <ErrorBox error={m.error} />
        <button className="btn primary block" disabled={m.isPending}>
          {m.isPending ? 'Creando…' : 'Crear cuenta'}
        </button>
      </form>
      <p className="muted small">
        ¿Ya tenés cuenta? <Link to="/login">Entrá</Link>
      </p>
    </AuthShell>
  );
}

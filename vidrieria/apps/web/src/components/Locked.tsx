import type { Feature } from '@vidrieria/shared';
import type { ReactNode } from 'react';
import { planNameFor, useFeature } from '../lib/plan';

/** Muestra el contenido si el plan lo incluye; si no, un aviso para pasarse de plan. */
export function Gate({ feature, children, inline }: { feature: Feature; children: ReactNode; inline?: boolean }) {
  const ok = useFeature(feature);
  if (ok) return <>{children}</>;
  return <Locked feature={feature} inline={inline} />;
}

export function Locked({ feature, inline }: { feature: Feature; inline?: boolean }) {
  const plan = planNameFor(feature);
  if (inline)
    return (
      <p className="locked-inline small">
        <LockIcon /> Disponible en el plan {plan}.
      </p>
    );
  return (
    <section className="card locked">
      <LockIcon big />
      <h2>Esta parte viene en el plan {plan}</h2>
      <p className="muted">Escribinos y te la activamos: sigue todo lo que ya cargaste.</p>
      <a className="btn primary" href={`mailto:lucianocordoba3@gmail.com?subject=${encodeURIComponent(`Quiero el plan ${plan}`)}`}>
        Quiero el plan {plan}
      </a>
    </section>
  );
}

export const LockIcon = ({ big }: { big?: boolean }) => (
  <svg viewBox="0 0 24 24" width={big ? 36 : 14} height={big ? 36 : 14} aria-hidden="true" className="lock-icon">
    <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

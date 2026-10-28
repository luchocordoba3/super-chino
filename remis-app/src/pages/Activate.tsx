import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BRAND } from '../brand';
import { CONFIG } from '../config';
import { db } from '../db/db';
import { saveSettings } from '../db/repo';
import { dayKey } from '../domain/dates';
import { codeProblem, extractCode, PLAN_LABEL, verifyCode } from '../domain/license';
import { dayFmt } from '../lib/format';
import { pendingCode } from '../lib/install';

type State = { s: 'checking' } | { s: 'ok'; text: string } | { s: 'pending' } | { s: 'error'; text: string };

/** El link de activación (/activar#código): se verifica sin internet y queda guardado. */
export function Activate() {
  const nav = useNavigate();
  const { hash } = useLocation();
  const [st, setSt] = useState<State>({ s: 'checking' });
  // Se vuelve a revisar si llega otro link estando en esta pantalla (solo cambia lo que va después del #).
  useEffect(() => {
    setSt({ s: 'checking' });
    const code = extractCode(decodeURIComponent(hash.slice(1)));
    void (async () => {
      if (!code) return setSt({ s: 'error', text: 'El link no trae ningún código. Pedile al vendedor que te lo mande de nuevo.' });
      const p = await verifyCode(code, CONFIG.licenseKeys);
      if (!p) return setSt({ s: 'error', text: 'El código no es válido. Abrí el link completo, tal cual te llegó.' });
      const settings = await db.settings.get('main');
      // Todavía no configuró la app: queda guardado y se aplica al terminar la bienvenida.
      if (!settings) {
        pendingCode(code);
        return setSt({ s: 'pending' });
      }
      const problem = codeProblem(p, settings.installId, dayKey(new Date()));
      if (problem) return setSt({ s: 'error', text: problem });
      await saveSettings({ license: code });
      setSt({ s: 'ok', text: `Plan ${PLAN_LABEL[p.p].toLowerCase()}${p.n ? ` a nombre de ${p.n}` : ''}: activa hasta el ${dayFmt(p.x)}.` });
    })();
  }, [hash]);
  return (
    <div className="onb stack">
      <div className="row" style={{ gap: 14 }}>
        <img className="onb-logo" src="/icon.svg" alt="" />
        <h1>{BRAND.name}</h1>
      </div>
      <section className="card stack">
        {st.s === 'checking' && <p>Revisando el código…</p>}
        {st.s === 'ok' && (
          <>
            <h2>¡Listo!</h2>
            <p>{st.text}</p>
          </>
        )}
        {st.s === 'pending' && (
          <>
            <h2>Código guardado</h2>
            <p>Ahora configurá la app: el código se activa solo al terminar.</p>
          </>
        )}
        {st.s === 'error' && (
          <>
            <h2>No se pudo activar</h2>
            <p>{st.text}</p>
          </>
        )}
        {st.s !== 'checking' && (
          <button type="button" className="primary" onClick={() => nav('/', { replace: true })}>
            Abrir {BRAND.name}
          </button>
        )}
      </section>
    </div>
  );
}

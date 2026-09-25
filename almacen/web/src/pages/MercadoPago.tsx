import { type FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';
import QRCode from 'qrcode';
import { Field, toast, toNum } from '../components/ui';

export interface MpQr {
  table: number | null;
  externalId: string;
  qrImage: string;
}
export interface MpStatus {
  connected: boolean;
  userId: string | null;
  oauth: boolean;
  hasStore: boolean;
  qrs: MpQr[];
  webhookUrl: string;
}
export const mpQuery = { queryKey: ['mp'], queryFn: () => api<MpStatus>('/mp') };

/** Ajustes → Mercado Pago: conectar la cuenta y armar los QR fijos de las mesas y el mostrador. */
export function MercadoPagoSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery(mpQuery);
  const [params, setParams] = useSearchParams();
  const [token, setToken] = useState('');
  const [addr, setAddr] = useState({ streetName: '', streetNumber: '', city: '', state: '', latitude: '', longitude: '' });
  const [busy, setBusy] = useState(false);

  // Vuelta de "Conectar Mercado Pago".
  useEffect(() => {
    const r = params.get('mp');
    if (!r) return;
    toast(t(`mp.back.${r === 'ok' ? 'ok' : r === 'cancelled' ? 'cancelled' : 'error'}`));
    params.delete('mp');
    setParams(params, { replace: true });
  }, [params, setParams, t]);

  const reload = () => qc.invalidateQueries({ queryKey: ['mp'] });
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await f();
      await reload();
    } catch (e) {
      toast(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const d = q.data;
  if (!d) return null;

  const connect = () => run(async () => (window.location.href = (await api<{ url: string }>('/mp/connect')).url));
  const saveToken = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/mp/token', { method: 'POST', body: { accessToken: token.trim() } });
      setToken('');
      toast(t('mp.back.ok'));
    });
  };
  const locate = () =>
    navigator.geolocation?.getCurrentPosition(
      (p) => setAddr((a) => ({ ...a, latitude: String(p.coords.latitude), longitude: String(p.coords.longitude) })),
      () => toast(t('mp.noLocation')),
    );
  const setup = (e: FormEvent) => {
    e.preventDefault();
    const lat = toNum(addr.latitude);
    const lng = toNum(addr.longitude);
    void run(() =>
      api('/mp/setup', {
        method: 'POST',
        body: d.hasStore ? {} : { address: { streetName: addr.streetName, streetNumber: addr.streetNumber, city: addr.city, state: addr.state, latitude: lat ?? 0, longitude: lng ?? 0 } },
      }),
    );
  };
  const set = (k: keyof typeof addr) => (e: { target: { value: string } }) => setAddr({ ...addr, [k]: e.target.value });

  return (
    <div className="card stack">
      <h2>📱 Mercado Pago</h2>
      <p className="muted small">{t('mp.help')}</p>
      {!d.connected ? (
        <>
          {d.oauth && (
            <button type="button" className="primary" disabled={busy} onClick={() => void connect()}>
              {t('mp.connect')}
            </button>
          )}
          <details open={!d.oauth}>
            <summary className="small">{t('mp.tokenTitle')}</summary>
            <form className="stack" onSubmit={saveToken}>
              <p className="hint">{t('mp.tokenHelp')}</p>
              <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="APP_USR-..." aria-label="Access Token" autoComplete="off" />
              <button className="primary" disabled={busy || token.trim().length < 20}>
                {t('mp.connectToken')}
              </button>
            </form>
          </details>
        </>
      ) : (
        <>
          <p className="ok">✓ {t('mp.connected', { id: d.userId })}</p>
          <form className="stack" onSubmit={setup}>
            {!d.hasStore && (
              <>
                <p className="small">{t('mp.addressHelp')}</p>
                <div className="grid2">
                  <Field label={t('mp.street')}>
                    <input value={addr.streetName} onChange={set('streetName')} required />
                  </Field>
                  <Field label={t('mp.number')}>
                    <input value={addr.streetNumber} onChange={set('streetNumber')} required />
                  </Field>
                  <Field label={t('mp.city')}>
                    <input value={addr.city} onChange={set('city')} required />
                  </Field>
                  <Field label={t('mp.province')}>
                    <input value={addr.state} onChange={set('state')} required />
                  </Field>
                </div>
                <div className="row">
                  <button type="button" onClick={locate}>
                    📍 {t('mp.useLocation')}
                  </button>
                  <span className="muted small">{addr.latitude && addr.longitude ? `${addr.latitude.slice(0, 8)}, ${addr.longitude.slice(0, 8)}` : t('mp.noCoords')}</span>
                </div>
              </>
            )}
            <button className="primary" disabled={busy || (!d.hasStore && !(toNum(addr.latitude) && toNum(addr.longitude)))}>
              {d.qrs.length ? t('mp.updateQrs') : t('mp.createQrs')}
            </button>
          </form>
          {d.qrs.length > 0 && (
            <Link className="btn" to="/qrs">
              🖨 {t('mp.printQrs', { count: d.qrs.length })}
            </Link>
          )}
          <p className="hint">{t('mp.webhook', { url: d.webhookUrl })}</p>
          <button
            type="button"
            className="small danger"
            disabled={busy}
            onClick={() => window.confirm(t('mp.disconnectConfirm')) && void run(() => api('/mp', { method: 'DELETE' }))}
          >
            {t('mp.disconnect')}
          </button>
        </>
      )}
    </div>
  );
}

/** Carteles para imprimir: en cada mesa, el QR de la carta (para pedir) y el de pago de Mercado Pago. */
export function QrSheet() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const mp = useQuery(mpQuery);
  const tables = useQuery({ queryKey: ['menu-tables'], queryFn: () => api<{ table: number; path: string }[]>('/menu/tables') });
  const [codes, setCodes] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!tables.data) return;
    void Promise.all(tables.data.map(async (x) => [x.table, await QRCode.toDataURL(window.location.origin + x.path, { margin: 1, width: 360 })] as const)).then((pairs) =>
      setCodes(Object.fromEntries(pairs)),
    );
  }, [tables.data]);
  const payQr = (table: number | null) => mp.data?.qrs.find((q) => q.table === table)?.qrImage;
  const rotate = async (table: number) => {
    if (!window.confirm(t('qrs.rotateConfirm', { n: table }))) return;
    await api(`/menu/tables/${table}/rotate`, { method: 'POST' });
    await qc.invalidateQueries({ queryKey: ['menu-tables'] });
  };
  const counter = payQr(null);
  return (
    <div className="stack main">
      <div className="row between no-print">
        <Link to="/settings">← {t('common.back')}</Link>
        <button type="button" className="primary" onClick={() => window.print()}>
          🖨 {t('common.print')}
        </button>
      </div>
      <p className="muted no-print">{t('qrs.help')}</p>
      <div className="qr-sheet print-area">
        {tables.data?.map((x) => (
          <div className="qr-card" key={x.table}>
            <div className="qr-title">{t('tabs.table', { n: x.table })}</div>
            <div className="qr-pair">
              <figure>
                {codes[x.table] && <img src={codes[x.table]} alt={t('qrs.menu')} />}
                <figcaption>📋 {t('qrs.menu')}</figcaption>
              </figure>
              {payQr(x.table) && (
                <figure>
                  <img src={payQr(x.table)} alt={t('qrs.pay')} />
                  <figcaption>💳 {t('qrs.pay')}</figcaption>
                </figure>
              )}
            </div>
            <div className="qr-foot">{payQr(x.table) ? t('qrs.footBoth') : t('qrs.footMenu')}</div>
            <button type="button" className="small no-print" onClick={() => void rotate(x.table)}>
              {t('qrs.rotate')}
            </button>
          </div>
        ))}
        {counter && (
          <div className="qr-card">
            <div className="qr-title">{t('mp.counter')}</div>
            <img src={counter} alt={t('qrs.pay')} />
            <div className="qr-foot">{t('mp.payHere')}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Ajustes → Carta con QR. */
export function MenuSettings() {
  const { t } = useTranslation();
  return (
    <div className="card stack">
      <h2>📋 {t('qrs.title')}</h2>
      <p className="muted small">{t('qrs.settingsHelp')}</p>
      <Link className="btn" to="/qrs">
        🖨 {t('qrs.print')}
      </Link>
    </div>
  );
}

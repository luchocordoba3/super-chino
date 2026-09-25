import { type FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Field, Loading, toast, toNum } from '../components/ui';
import { dateTimeFmt, dayFmt, money, qtyFmt, setCurrency } from '../lib/format';

export interface InvoiceView {
  id: string;
  saleId: string;
  status: 'PENDING' | 'AUTHORIZED' | 'ERROR';
  letter: string;
  number: number | null;
  code: string | null;
  customerName: string | null;
  total: number;
  cae: string | null;
  caeDue: string | null;
  error: string | null;
  createdAt: string;
  path: string;
}
export interface InvoiceCustomer {
  docType: 80 | 96 | 99;
  docNumber: string;
  customerName?: string;
  customerVat: 1 | 5 | 6;
}

/** Datos del cliente para la factura: consumidor final (lo común), DNI o CUIT. */
export function InvoiceCustomerForm({ ri, busy, onSubmit }: { ri: boolean; busy: boolean; onSubmit: (c: InvoiceCustomer) => void }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<'cf' | 'dni' | 'cuit'>('cf');
  const [doc, setDoc] = useState('');
  const [name, setName] = useState('');
  const [isRi, setIsRi] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (kind === 'cf') return onSubmit({ docType: 99, docNumber: '0', customerVat: 5 });
    onSubmit({ docType: kind === 'dni' ? 96 : 80, docNumber: doc, customerName: name || undefined, customerVat: kind === 'cuit' && isRi ? 1 : kind === 'cuit' ? 6 : 5 });
  };
  return (
    <form className="stack" onSubmit={submit}>
      <div className="row">
        {(['cf', 'dni', 'cuit'] as const).map((k) => (
          <button type="button" key={k} className={kind === k ? 'primary' : ''} onClick={() => setKind(k)}>
            {t(`invoice.kinds.${k}`)}
          </button>
        ))}
      </div>
      {kind !== 'cf' && (
        <>
          <Field label={kind === 'dni' ? 'DNI' : 'CUIT'}>
            <input value={doc} onChange={(e) => setDoc(e.target.value)} inputMode="numeric" required autoFocus />
          </Field>
          <Field label={t('invoice.customerName')}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required={kind === 'cuit'} />
          </Field>
          {kind === 'cuit' && ri && (
            <label className="row">
              <input type="checkbox" checked={isRi} onChange={(e) => setIsRi(e.target.checked)} /> {t('invoice.customerRi')}
            </label>
          )}
        </>
      )}
      <button className="primary big" disabled={busy}>
        🧾 {t('invoice.request')}
      </button>
    </form>
  );
}

/** Estado de una factura con sus acciones (mandar por WhatsApp, imprimir, reintentar). */
export function InvoiceStatus({ inv, onRetry }: { inv: InvoiceView; onRetry?: () => void }) {
  const { t } = useTranslation();
  const url = window.location.origin + inv.path;
  if (inv.status === 'PENDING') {
    return (
      <div className="mp-wait">
        <div className="spinner" />
        <span>{t('invoice.pending')}</span>
      </div>
    );
  }
  if (inv.status === 'ERROR') {
    return (
      <div className="stack">
        <p className="error">
          {t('invoice.failed')}: {inv.error}
        </p>
        {onRetry && (
          <button type="button" onClick={onRetry}>
            {t('invoice.retry')}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="stack">
      <p className="ok">
        ✅ {t('invoice.done', { letter: inv.letter, code: inv.code })} · CAE {inv.cae}
      </p>
      <div className="row">
        <a className="btn btn-primary" href={`https://wa.me/?text=${encodeURIComponent(t('invoice.whatsappText', { url }))}`} target="_blank" rel="noreferrer">
          📲 {t('invoice.sendWhatsapp')}
        </a>
        <a className="btn" href={inv.path} target="_blank" rel="noreferrer">
          🖨 {t('invoice.open')}
        </a>
      </div>
    </div>
  );
}

interface PublicInvoice extends InvoiceView {
  date: string;
  net: number;
  vat: number;
  vatRate: number;
  docType: number;
  docNumber: string;
  issuer: { businessName: string; cuit: string; address: string | null; taxStatus: string; storeName: string };
  items: { name: string; qty: number; unitPrice: number; total: number }[];
  qr: string;
}
const cuitFmt = (c: string) => (c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);

/** La factura para el cliente (link por WhatsApp): se ve y se imprime, con el QR de ARCA. Siempre en español. */
export function InvoicePage() {
  const { token = '' } = useParams();
  const { t } = useTranslation(undefined, { lng: 'es' });
  const q = useQuery({ queryKey: ['public-invoice', token], queryFn: () => api<PublicInvoice>(`/public/invoices/${token}`), retry: false });
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (!q.data) return;
    setCurrency('ARS');
    void QRCode.toDataURL(q.data.qr, { margin: 1, width: 240 }).then(setQr);
  }, [q.data]);
  if (q.isLoading) return <Loading />;
  const f = q.data;
  if (!f) return <div className="menu center-box card">{t('invoice.notFound')}</div>;
  const doc = f.docType === 99 ? t('invoice.kinds.cf') : `${f.docType === 80 ? 'CUIT' : 'DNI'} ${f.docType === 80 ? cuitFmt(f.docNumber) : f.docNumber}`;
  return (
    <div className="invoice-page">
      <div className="row between no-print">
        <strong>{f.issuer.storeName}</strong>
        <button type="button" className="primary" onClick={() => window.print()}>
          🖨 {t('common.print')}
        </button>
      </div>
      <div className="invoice print-area">
        <div className="inv-head">
          <div>
            <div className="inv-name">{f.issuer.businessName}</div>
            <div className="small">{f.issuer.address}</div>
            <div className="small">
              CUIT {cuitFmt(f.issuer.cuit)} · {f.issuer.taxStatus === 'MONOTRIBUTO' ? 'Responsable Monotributo' : 'IVA Responsable Inscripto'}
            </div>
          </div>
          <div className="inv-letter">
            {f.letter}
            <span>Cód. {f.letter === 'A' ? '01' : f.letter === 'B' ? '06' : '11'}</span>
          </div>
          <div className="right">
            <div className="inv-name">FACTURA</div>
            <div>N° {f.code}</div>
            <div className="small">Fecha: {dayFmt(f.date)}</div>
          </div>
        </div>
        <div className="small inv-customer">
          {f.customerName ? `${f.customerName} · ` : ''}
          {doc}
        </div>
        <table className="small">
          <thead>
            <tr>
              <th>{t('invoice.item')}</th>
              <th className="num">{t('invoice.qty')}</th>
              <th className="num">{t('invoice.unit')}</th>
              <th className="num">{t('common.total')}</th>
            </tr>
          </thead>
          <tbody>
            {f.items.map((i, k) => (
              <tr key={k}>
                <td>{i.name}</td>
                <td className="num">{qtyFmt(i.qty)}</td>
                <td className="num">{money(f.letter === 'A' ? i.unitPrice / (1 + f.vatRate / 100) : i.unitPrice)}</td>
                <td className="num">{money(f.letter === 'A' ? i.total / (1 + f.vatRate / 100) : i.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="inv-totals">
          {f.letter === 'A' && (
            <>
              <div>
                {t('invoice.net')}: {money(f.net)}
              </div>
              <div>
                IVA {f.vatRate}%: {money(f.vat)}
              </div>
            </>
          )}
          <div className="inv-total">
            {t('common.total')}: {money(f.total)}
          </div>
          {f.letter === 'B' && <div className="small">{t('invoice.vatIncluded', { amount: money(f.vat) })}</div>}
        </div>
        <div className="inv-foot">
          {qr && <img src={qr} alt="QR ARCA" />}
          <div className="small">
            <div>
              <strong>CAE:</strong> {f.cae}
            </div>
            <div>
              <strong>{t('invoice.caeDue')}:</strong> {f.caeDue ? dayFmt(f.caeDue.slice(0, 10)) : ''}
            </div>
            <div className="muted">{t('invoice.authorized')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface FiscalView {
  cuit: string;
  businessName: string;
  address: string | null;
  taxStatus: 'MONOTRIBUTO' | 'RESPONSABLE_INSCRIPTO';
  pointOfSale: number;
  vatRate: number;
  production: boolean;
  enabled: boolean;
  certificate: { notAfter: string; subject: string } | null;
}

/** Ajustes → Factura electrónica (ARCA). */
export function FiscalSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fiscal'], queryFn: () => api<FiscalView | null>('/fiscal') });
  const [f, setF] = useState({ cuit: '', businessName: '', address: '', taxStatus: 'MONOTRIBUTO', pointOfSale: '', vatRate: '21', production: false, enabled: true, certPem: '', keyPem: '' });
  const [test, setTest] = useState<{ ok: boolean; last?: Record<string, number>; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = q.data;
    if (d) setF((x) => ({ ...x, cuit: d.cuit, businessName: d.businessName, address: d.address ?? '', taxStatus: d.taxStatus, pointOfSale: String(d.pointOfSale), vatRate: String(d.vatRate), production: d.production, enabled: d.enabled }));
  }, [q.data]);
  const readFile = (k: 'certPem' | 'keyPem') => (e: { target: HTMLInputElement }) => {
    const file = e.target.files?.[0];
    if (file) void file.text().then((text) => setF((x) => ({ ...x, [k]: text })));
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/fiscal', {
        method: 'PUT',
        body: {
          cuit: f.cuit.replace(/\D/g, ''),
          businessName: f.businessName,
          address: f.address || null,
          taxStatus: f.taxStatus,
          pointOfSale: toNum(f.pointOfSale) ?? 0,
          vatRate: Number(f.vatRate),
          production: f.production,
          enabled: f.enabled,
          ...(f.certPem && f.keyPem ? { certPem: f.certPem, keyPem: f.keyPem } : {}),
        },
      });
      setF((x) => ({ ...x, certPem: '', keyPem: '' }));
      toast(t('common.saved'));
      await qc.invalidateQueries({ queryKey: ['fiscal'] });
    } catch (err) {
      toast(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  const runTest = async () => {
    setBusy(true);
    try {
      setTest(await api('/fiscal/test', { method: 'POST' }));
    } finally {
      setBusy(false);
    }
  };
  const d = q.data;
  return (
    <div className="card stack">
      <h2>🧾 {t('invoice.settingsTitle')}</h2>
      <p className="muted small">{t('invoice.settingsHelp')}</p>
      <details>
        <summary className="small">{t('invoice.howTo')}</summary>
        <ol className="small">
          <li>{t('invoice.step1')}</li>
          <li>{t('invoice.step2')}</li>
          <li>{t('invoice.step3')}</li>
          <li>{t('invoice.step4')}</li>
        </ol>
      </details>
      <form className="stack" onSubmit={(e) => void save(e)}>
        <div className="grid2">
          <Field label="CUIT">
            <input value={f.cuit} onChange={(e) => setF({ ...f, cuit: e.target.value })} inputMode="numeric" required />
          </Field>
          <Field label={t('invoice.businessName')}>
            <input value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} required />
          </Field>
          <Field label={t('invoice.address')}>
            <input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          </Field>
          <Field label={t('invoice.pointOfSale')}>
            <input value={f.pointOfSale} onChange={(e) => setF({ ...f, pointOfSale: e.target.value })} inputMode="numeric" required />
          </Field>
          <Field label={t('invoice.taxStatus')}>
            <select value={f.taxStatus} onChange={(e) => setF({ ...f, taxStatus: e.target.value })}>
              <option value="MONOTRIBUTO">{t('invoice.monotributo')}</option>
              <option value="RESPONSABLE_INSCRIPTO">{t('invoice.ri')}</option>
            </select>
          </Field>
          {f.taxStatus === 'RESPONSABLE_INSCRIPTO' && (
            <Field label={t('invoice.vatRate')}>
              <select value={f.vatRate} onChange={(e) => setF({ ...f, vatRate: e.target.value })}>
                {['21', '10.5', '27'].map((r) => (
                  <option key={r} value={r}>
                    {r}%
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <Field label={t('invoice.certificate')} hint={d?.certificate ? t('invoice.certInfo', { subject: d.certificate.subject, date: dateTimeFmt(d.certificate.notAfter) }) : t('invoice.certHint')}>
          <input type="file" accept=".crt,.pem,.cer" onChange={readFile('certPem')} aria-label={t('invoice.certificate')} />
        </Field>
        <Field label={t('invoice.key')}>
          <input type="file" accept=".key,.pem" onChange={readFile('keyPem')} aria-label={t('invoice.key')} />
        </Field>
        <label className="row">
          <input type="checkbox" checked={f.production} onChange={(e) => setF({ ...f, production: e.target.checked })} /> {t('invoice.production')}
        </label>
        <label className="row">
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> {t('invoice.enabled')}
        </label>
        <button className="primary" disabled={busy}>
          {t('invoice.saveFiscal')}
        </button>
      </form>
      {d && (
        <>
          <button type="button" disabled={busy} onClick={() => void runTest()}>
            {t('invoice.test')}
          </button>
          {test && (
            <p className={test.ok ? 'ok' : 'error'}>
              {test.ok ? t('invoice.testOk', { last: Object.entries(test.last ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ') }) : test.error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Ventas → Facturas: lo pedido a ARCA, con reintento. */
export function InvoicesTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['invoices'], queryFn: () => api<InvoiceView[]>('/invoices') });
  const retry = async (id: string) => {
    try {
      await api(`/invoices/${id}/retry`, { method: 'POST' });
    } catch (e) {
      toast(errMsg(e));
    }
    await qc.invalidateQueries({ queryKey: ['invoices'] });
  };
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  if (q.data.length === 0) return <Empty text={t('invoice.none')} />;
  return (
    <div className="card table-wrap">
      <table className="small">
        <tbody>
          {q.data.map((i) => (
            <tr key={i.id}>
              <td>{dateTimeFmt(i.createdAt)}</td>
              <td>
                {i.letter} {i.code ?? ''}
              </td>
              <td>{i.customerName ?? t('invoice.kinds.cf')}</td>
              <td className="num">{money(i.total)}</td>
              <td>
                {i.status === 'AUTHORIZED' ? (
                  <a href={i.path} target="_blank" rel="noreferrer">
                    ✅ CAE {i.cae}
                  </a>
                ) : i.status === 'ERROR' ? (
                  <span className="error">
                    {i.error}{' '}
                    <button type="button" className="small" onClick={() => void retry(i.id)}>
                      {t('invoice.retry')}
                    </button>
                  </span>
                ) : (
                  <span className="muted">{t('invoice.pending')}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

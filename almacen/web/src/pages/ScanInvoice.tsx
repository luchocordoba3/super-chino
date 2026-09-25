import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { EntryEditor, type EntryLine, newLine } from '../components/EntryEditor';
import { toast } from '../components/ui';
import { shrinkImage } from '../lib/image';
import { useMe } from '../lib/me';

interface ScanResult {
  supplierName: string | null;
  supplierId: string | null;
  invoiceNumber: string | null;
  items: {
    description: string;
    barcode: string | null;
    quantity: number;
    unitCost: number | null;
    lotCode: string | null;
    expiresAt: string | null;
    match: { productId: string; name: string; score: number } | null;
    candidates: { id: string; name: string }[];
  }[];
}

/** Foto de la factura -> la IA lee los renglones -> se revisan -> se guarda el ingreso. */
export function ScanInvoice() {
  const me = useMe();
  const { t } = useTranslation();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<{ id: string; result: ScanResult; lines: EntryLine[] } | null>(null);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', await shrinkImage(file, 1800, 0.85), 'factura.jpg');
      const r = await api<{ id: string; result: ScanResult }>('/ai/scan?kind=invoice', { form });
      const lines = r.result.items.map((i) =>
        newLine({
          productId: i.match?.productId ?? null,
          name: i.match?.name ?? i.description,
          barcode: i.barcode ?? '',
          qty: String(i.quantity),
          unitCost: i.unitCost != null ? String(i.unitCost) : '',
          lotCode: i.lotCode ?? '',
          expiresAt: i.expiresAt ?? '',
          description: i.description,
          candidates: i.candidates.length ? i.candidates : undefined,
        }),
      );
      setScan({ id: r.id, result: r.result, lines });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      toast(code === 'limit_reached' ? t('scan.limitReached') : code === 'ai_disabled' ? t('scan.aiDisabled') : t('scan.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <Link to="/stock">← {t('common.back')}</Link>
      <h1>{t('scan.title')}</h1>
      {!me.aiEnabled && <p className="warn">{t('scan.aiDisabled')}</p>}
      {!scan && (
        <div className="card stack">
          <p>{t('scan.help')}</p>
          <label className="btn btn-primary big">
            📸 {busy ? t('scan.reading') : t('scan.takePhoto')}
            <input type="file" accept="image/*" capture="environment" hidden disabled={busy || !me.aiEnabled} onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          </label>
        </div>
      )}
      {scan && (
        <>
          <p className="card">
            {t('scan.review')}
            {scan.result.supplierName && (
              <>
                <br />
                <strong>{scan.result.supplierName}</strong> {scan.result.invoiceNumber}
              </>
            )}
          </p>
          <EntryEditor
            initialLines={scan.lines}
            initialSupplierId={scan.result.supplierId ?? ''}
            initialInvoiceNumber={scan.result.invoiceNumber ?? ''}
            invoiceScanId={scan.id}
            onSaved={() => nav('/stock')}
          />
        </>
      )}
    </div>
  );
}

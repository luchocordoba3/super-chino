import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { shrinkImage } from '../lib/image';
import { toast } from './ui';

export interface LabelResult {
  productName: string | null;
  barcode: string | null;
  lotCode: string | null;
  expiresAt: string | null;
}

/** Foto de la etiqueta -> la IA lee lote y vencimiento ("VTO 12/26"). */
export function LabelReader({ onRead }: { onRead: (r: LabelResult) => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', await shrinkImage(file, 1200), 'etiqueta.jpg');
      const r = await api<{ result: LabelResult }>('/ai/scan?kind=label', { form });
      onRead(r.result);
      toast(t('stock.labelRead'));
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'limit_reached' ? t('scan.limitReached') : t('scan.failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="btn">
      📸 {busy ? t('scan.reading') : t('stock.readLabel')}
      <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
    </label>
  );
}

import { useSearchParams } from 'react-router-dom';
import { Qr } from '../components/Qr';

/** Hoja para imprimir un QR grande (cartel de obra, reseñas de Google). Se imprime con Ctrl + P. */
export function QrPrintPage() {
  const [p] = useSearchParams();
  const url = p.get('u') ?? '';
  return (
    <div className="qr-print">
      <h1>{p.get('t') ?? ''}</h1>
      {p.get('s') && <p className="qr-sub">{p.get('s')}</p>}
      {url && <Qr text={url} size={340} />}
      <p className="mono">{url.replace(/^https?:\/\//, '')}</p>
      <p className="no-print muted">Imprimilo con Ctrl + P.</p>
    </div>
  );
}

import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** Código QR en SVG (para imprimir y pegar: garantía, carteles, reseñas). */
export function Qr({ text, size = 160, label }: { text: string; size?: number; label?: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return <div className="qr" role="img" aria-label={label ?? `Código QR: ${text}`} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

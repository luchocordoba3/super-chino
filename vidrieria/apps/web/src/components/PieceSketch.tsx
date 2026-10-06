import { qty } from '../lib/format';

/** Dibujo a escala de una pieza, con las cotas en mm. Sirve de croquis para el cliente y de orden de corte. */
export function PieceSketch({ widthMm, heightMm, quantity = 1, size = 'md' }: { widthMm: number; heightMm: number; quantity?: number; size?: 'sm' | 'md' }) {
  const w = Math.max(widthMm, 1);
  const h = Math.max(heightMm, 1);
  // Caja disponible para el rectángulo (deja lugar arriba y a la derecha para las cotas).
  const boxW = 112;
  const boxH = 84;
  const k = Math.min(boxW / w, boxH / h);
  const rw = Math.max(w * k, 6);
  const rh = Math.max(h * k, 6);
  const x = 8 + (boxW - rw) / 2;
  const y = 22 + (boxH - rh) / 2;
  const right = x + rw + 10;
  const reflex = Math.min(rw, rh) * 0.35;
  return (
    <svg className={`sketch ${size}`} viewBox="0 0 160 116" role="img" aria-label={`Pieza de ${qty(widthMm)} por ${qty(heightMm)} mm`}>
      <rect className="sk-glass" x={x} y={y} width={rw} height={rh} rx="1.5" />
      <path className="sk-reflex" d={`M${x + rw * 0.18} ${y + rh * 0.18 + reflex} l${reflex} ${-reflex} M${x + rw * 0.18 + 6} ${y + rh * 0.18 + reflex + 4} l${reflex * 0.6} ${-reflex * 0.6}`} />
      {/* Cota del ancho */}
      <path className="sk-dim" d={`M${x} ${y - 9} H${x + rw} M${x} ${y - 13} v8 M${x + rw} ${y - 13} v8`} />
      <text className="sk-text" x={x + rw / 2} y={y - 13} textAnchor="middle">
        {qty(widthMm)}
      </text>
      {/* Cota del alto */}
      <path className="sk-dim" d={`M${right} ${y} V${y + rh} M${right - 4} ${y} h8 M${right - 4} ${y + rh} h8`} />
      <text className="sk-text" x={right + 5} y={y + rh / 2} dominantBaseline="middle">
        {qty(heightMm)}
      </text>
      {quantity > 1 && (
        <text className="sk-qty" x={x + rw / 2} y={y + rh / 2} textAnchor="middle" dominantBaseline="middle">
          ×{quantity}
        </text>
      )}
    </svg>
  );
}

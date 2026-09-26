import { useEffect, useRef, useState } from 'react';
import { dayShort, kmFmt, money } from '../lib/format';

/** Tope "redondo" del eje: 0 / 150 / 300, 0 / 250 / 500… */
function niceMax(v: number) {
  if (v <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

/** Columna con la punta redondeada (4px) y cuadrada contra la base. */
function colPath(x: number, w: number, yTop: number, yBottom: number, round: boolean) {
  const h = yBottom - yTop;
  if (h <= 0) return '';
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${yBottom}V${yTop + r}a${r},${r} 0 0 1 ${r},${-r}H${x + w - r}a${r},${r} 0 0 1 ${r},${r}V${yBottom}Z`;
}

const short = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}`;

/** Km por día: tuyos y, con el auto compartido, los del otro chofer apilados arriba. */
export function KmChart({ days, mine, other }: { days: string[]; mine: Map<string, number>; other?: Map<string, number> }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const two = !!other && days.some((k) => (other.get(k) ?? 0) > 0);
  const vals = days.map((k) => ({ k, a: mine.get(k) ?? 0, b: two ? (other!.get(k) ?? 0) : 0 }));
  const top = niceMax(Math.max(...vals.map((v) => v.a + v.b), 0));
  const H = 190;
  const padL = 44;
  const padT = 10;
  const padB = 24;
  const plotW = w - padL;
  const plotH = H - padT - padB;
  const base = padT + plotH;
  const y = (v: number) => base - (v / top) * plotH;
  const slot = plotW / Math.max(1, days.length);
  const bw = Math.min(24, Math.max(3, slot * 0.62));
  const every = days.length <= 7 ? 1 : days.length <= 16 ? 2 : 7;
  const ticks = [0, top / 2, top];
  const hv = hover != null ? vals[hover] : null;

  return (
    <div>
      {two && (
        <div className="legend">
          <span>
            <i style={{ background: 'var(--series-1)' }} /> Vos
          </span>
          <span>
            <i style={{ background: 'var(--series-2)' }} /> Otro chofer
          </span>
        </div>
      )}
      <div className="chart-wrap" ref={box} onPointerLeave={() => setHover(null)}>
        <svg height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label="Km por día">
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'base' : 'grid'} x1={padL} x2={w} y1={y(t)} y2={y(t)} />
              <text className="tick" x={padL - 8} y={y(t) + 4} textAnchor="end">
                {new Intl.NumberFormat('es-AR').format(t)}
              </text>
            </g>
          ))}
          {vals.map((v, i) => {
            const x = padL + i * slot + (slot - bw) / 2;
            const aTop = y(v.a);
            return (
              <g key={v.k}>
                <path className="bar-1" d={colPath(x, bw, aTop, base, v.b <= 0)} />
                {v.b > 0 && <path className="bar-2" d={colPath(x, bw, y(v.a + v.b), v.a > 0 ? aTop - 2 : base, true)} />}
                {i % every === 0 && (
                  <text className="tick" x={x + bw / 2} y={H - 6} textAnchor="middle">
                    {days.length <= 7 ? dayShort(v.k).split(' ')[0] : short(v.k)}
                  </text>
                )}
                <rect
                  className="hit"
                  x={padL + i * slot}
                  y={padT}
                  width={slot}
                  height={plotH}
                  tabIndex={0}
                  aria-label={`${dayShort(v.k)}: ${kmFmt(v.a)}${two ? `, otro chofer ${kmFmt(v.b)}` : ''}`}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onClick={() => setHover((h) => (h === i ? null : i))}
                />
              </g>
            );
          })}
        </svg>
        {hv && (
          <div className="tip" style={{ left: Math.min(Math.max(padL + hover! * slot + slot / 2, 70), w - 70), top: 0 }}>
            <div className="muted">{dayShort(hv.k)}</div>
            <div className="tr">
              <span className="key" style={{ background: 'var(--series-1)' }} />
              <strong>{kmFmt(hv.a)}</strong>
              <span className="muted">{two ? 'vos' : ''}</span>
            </div>
            {two && (
              <div className="tr">
                <span className="key" style={{ background: 'var(--series-2)' }} />
                <strong>{kmFmt(hv.b)}</strong>
                <span className="muted">otro chofer</span>
              </div>
            )}
          </div>
        )}
      </div>
      <button type="button" className="link" onClick={() => setTable((t) => !t)}>
        {table ? 'Ocultar tabla' : 'Ver como tabla'}
      </button>
      {table && (
        <table>
          <thead>
            <tr>
              <th>Día</th>
              <th className="num">{two ? 'Vos' : 'Km'}</th>
              {two && <th className="num">Otro chofer</th>}
            </tr>
          </thead>
          <tbody>
            {vals
              .filter((v) => v.a || v.b)
              .map((v) => (
                <tr key={v.k}>
                  <td>{dayShort(v.k)}</td>
                  <td className="num">{kmFmt(v.a)}</td>
                  {two && <td className="num">{kmFmt(v.b)}</td>}
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Barras horizontales de gastos por rubro, con el monto en la punta. */
export function CostBars({ rows }: { rows: { label: string; value: number }[] }) {
  const sorted = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const max = sorted[0]?.value ?? 1;
  const total = sorted.reduce((a, r) => a + r.value, 0);
  return (
    <div>
      {sorted.map((r) => (
        <div key={r.label} className="hbar">
          <span className="n">{r.label}</span>
          <span className="v">
            {money(r.value)} <span className="muted small">{Math.round((r.value / total) * 100)}%</span>
          </span>
          <div className="track">
            <div className="fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

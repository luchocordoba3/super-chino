import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { money, qty } from '../lib/format';

interface Group {
  key: string;
  sent: number;
  accepted: number;
  rate: number | null;
}
interface Sales {
  sent: number;
  accepted: number;
  closeRate: number | null;
  tooCheap: boolean;
  avgTicket: number | null;
  responseHours: number | null;
  unanswered: number;
  bySource: Group[];
  byKind: Group[];
  priceTest: Group[];
}

const SOURCE: Record<string, string> = {
  WEB: 'Web',
  GOOGLE: 'Google',
  INSTAGRAM: 'Instagram',
  CARTEL: 'Cartel de obra',
  RECOMENDACION: 'Recomendación',
  WHATSAPP: 'WhatsApp',
  OTRO: 'Otro',
  SIN_DATO: 'Sin dato',
  A: 'Precio normal',
  B: 'Con recargo de prueba',
};
const pct = (x: number | null) => (x == null ? '—' : `${qty(Math.round(x * 100))} %`);

function GroupTable({ title, rows }: { title: string; rows: Group[] }) {
  if (!rows.length) return null;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{title}</th>
            <th className="num">Mandados</th>
            <th className="num">Aceptados</th>
            <th className="num">Cierre</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.key}>
              <td>{SOURCE[g.key] ?? g.key}</td>
              <td className="num">{g.sent}</td>
              <td className="num">{g.accepted}</td>
              <td className="num">{pct(g.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tablero de cierre: cuántos presupuestos se cierran de verdad, de dónde vienen y si se está cobrando poco. */
export function SalesNumbers() {
  const q = useQuery({ queryKey: ['numbers-sales'], queryFn: () => api<Sales>('/numbers/sales') });
  if (!q.data) return null;
  const s = q.data;
  return (
    <section className="card">
      <h2>Cómo cerrás tus presupuestos</h2>
      <p className="muted small">Últimos 90 días, contando también los que nunca respondieron.</p>
      <div className="mini-stats">
        <div>
          <strong>{pct(s.closeRate)}</strong>
          <span>
            cierre ({s.accepted} de {s.sent})
          </span>
        </div>
        <div>
          <strong>{s.avgTicket ? money(s.avgTicket) : '—'}</strong>
          <span>ticket promedio</span>
        </div>
        <div>
          <strong>{s.responseHours == null ? '—' : `${qty(s.responseHours)} h`}</strong>
          <span>de la consulta al presupuesto</span>
        </div>
        <div>
          <strong>{s.unanswered}</strong>
          <span>consultas sin presupuesto</span>
        </div>
      </div>
      {s.tooCheap && (
        <p className="note">
          Cerrás más del 85 %. En los oficios lo normal es entre 10 % y 35 %: puede que estés cobrando poco. Probá la <strong>prueba de precio</strong> en Ajustes: sube un % a la mitad de los presupuestos y acá ves si igual cierran.
        </p>
      )}
      <GroupTable title="De dónde vienen" rows={s.bySource} />
      <GroupTable title="Tipo de trabajo" rows={s.byKind} />
      {!!s.priceTest.length && <GroupTable title="Prueba de precio" rows={s.priceTest} />}
    </section>
  );
}

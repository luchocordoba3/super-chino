import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ErrorBox, Loading } from '../components/ui';
import { money, qty } from '../lib/format';
import type { Numbers as N } from '../lib/types';
import { SalesNumbers } from './SalesNumbers';

const pct = (x: number | null | undefined) => (x == null ? '—' : `${qty(Math.round(x * 100))} %`);

/** Números del negocio: monotributo, mes, próximos 30 días, punto de equilibrio y ganancia real por trabajo. */
export default function Numbers() {
  const q = useQuery({ queryKey: ['numbers'], queryFn: () => api<N>('/numbers') });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBox error={q.error} />;
  const n = q.data;
  const m = n.monotributo;
  const result = n.month.net - n.month.expenses - n.month.wages;
  const flow = n.cashflow30.receivable + n.cashflow30.cheques - n.cashflow30.fixed - n.cashflow30.wages;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Números</h1>
          <p className="muted small">Salen solos de lo que cargás en presupuestos, caja y jornales.</p>
        </div>
      </div>

      <section className={'card' + (m.pct != null && m.pct >= 0.8 ? ' attention-card' : '')}>
        <h2>Monotributo</h2>
        {m.cap == null ? (
          <p className="muted">
            Elegí tu categoría en <Link to="/panel/ajustes">Ajustes</Link> y acá vas a ver cuánto te falta para el tope.
          </p>
        ) : (
          <>
            <p>
              Facturaste <strong>{money(m.invoiced)}</strong> en los últimos 12 meses, el {pct(m.pct)} del tope de la categoría {m.category} ({money(m.cap)}).
            </p>
            <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((m.pct ?? 0) * 100)} aria-label="Facturado contra el tope">
              <i style={{ width: `${Math.min(100, (m.pct ?? 0) * 100)}%` }} className={m.pct != null && m.pct >= 0.8 ? 'warn' : ''} />
            </div>
            <p className="small muted">A este ritmo facturarías {money(m.projection)} en un año.</p>
            {m.pct != null && m.pct >= 0.8 && <p className="note">Estás cerca del tope. Hablalo con tu contador antes de la próxima recategorización.</p>}
          </>
        )}
        {m.banked > m.invoiced && (
          <p className="note">
            Por bancos y billeteras te entraron {money(m.banked)}, más de lo que facturaste. ARCA cruza esos datos: conviene facturar esos cobros o revisarlo con tu contador.
          </p>
        )}
      </section>

      <section className="tiles">
        <div className="tile">
          <span className="tile-label">Entró este mes</span>
          <strong className="tile-num">{money(n.month.net)}</strong>
          <span className="tile-sub">neto de comisiones (cobrado {money(n.month.income)})</span>
        </div>
        <div className="tile">
          <span className="tile-label">Salió este mes</span>
          <strong className="tile-num">{money(n.month.expenses + n.month.wages)}</strong>
          <span className="tile-sub">
            gastos {money(n.month.expenses)} · jornales {money(n.month.wages)}
          </span>
        </div>
        <div className={'tile' + (result < 0 ? ' attention' : ' profit')}>
          <span className="tile-label">Quedó</span>
          <strong className="tile-num">{money(result)}</strong>
          <span className="tile-sub">de caja este mes</span>
        </div>
        <div className="tile">
          <span className="tile-label">Próximos 30 días</span>
          <strong className="tile-num">{money(flow)}</strong>
          <span className="tile-sub">
            a cobrar {money(n.cashflow30.receivable + n.cashflow30.cheques)} − fijos y jornales {money(n.cashflow30.fixed + n.cashflow30.wages)}
          </span>
        </div>
      </section>

      <section className="card">
        <h2>Punto de equilibrio</h2>
        {n.breakeven.salesNeeded == null || n.breakeven.fixedMonthly <= 0 ? (
          <p className="muted">
            Cargá tus gastos fijos en <Link to="/panel/caja">Caja</Link> y el costo de tus materiales en <Link to="/panel/materiales">Precios</Link> para calcularlo.
          </p>
        ) : (
          <p>
            Con gastos fijos de <strong>{money(n.breakeven.fixedMonthly)}</strong> por mes y un margen promedio del <strong>{pct(n.breakeven.marginPct)}</strong>, necesitás vender{' '}
            <strong>{money(n.breakeven.salesNeeded)}</strong> por mes para no perder plata. Todo lo que vendas arriba de eso es ganancia.
          </p>
        )}
      </section>

      <SalesNumbers />

      <section className="card">
        <h2>Qué te deja cada tipo de trabajo</h2>
        <p className="muted small">Presupuestos aceptados de los últimos 6 meses.</p>
        {!n.byKind.length ? (
          <p className="muted">Todavía no hay trabajos aceptados.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Trabajo</th>
                  <th className="num">Cant.</th>
                  <th className="num">Vendido</th>
                  <th className="num">Margen</th>
                </tr>
              </thead>
              <tbody>
                {n.byKind.map((k) => (
                  <tr key={k.kind}>
                    <td>{k.kind}</td>
                    <td className="num">{k.count}</td>
                    <td className="num">{money(k.revenue)}</td>
                    <td className="num">{pct(k.marginPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Ganancia real de los últimos trabajos</h2>
        <p className="muted small">Precio menos material, jornales, gastos del trabajo (nafta, flete) y comisiones de cobro.</p>
        {!n.jobs.length ? (
          <p className="muted">Aparecen cuando marcás trabajos como colocados.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Trabajo</th>
                  <th className="num">Precio</th>
                  <th className="num hide-sm">Material</th>
                  <th className="num hide-sm">Jornales</th>
                  <th className="num hide-sm">Gastos y comisiones</th>
                  <th className="num">Te quedó</th>
                </tr>
              </thead>
              <tbody>
                {n.jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      N° {j.number} · {j.customer ?? j.title}
                    </td>
                    <td className="num">{money(j.price)}</td>
                    <td className="num hide-sm">{j.materialKnown ? money(j.material) : '—'}</td>
                    <td className="num hide-sm">{money(j.wages)}</td>
                    <td className="num hide-sm">{money(j.expenses + j.fees)}</td>
                    <td className={'num strong ' + (j.profit < 0 ? 'bad-text' : 'good-text')}>{money(j.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

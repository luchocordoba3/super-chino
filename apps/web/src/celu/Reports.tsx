// Números del negocio en pesos y dólares, y el panel de inicio de la casa de celulares.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ORDER_CHANNEL_LABELS, type OrderChannel, REPAIR_STATUS_LABELS, type RepairStatus } from '@super-chino/shared';
import { api } from '../api';
import { ErrorBox, Field, Loading } from '../components/ui';
import { dateTimeFmt, dayFmt, money, todayISO } from '../lib/format';

/** Pesos sin centavos para los recuadros. */
const big = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
const bigUsd = (n: number) => `US$ ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n)}`;
import { can, useMe } from '../lib/me';
import { downloadCsv, usd, useFx } from './common';

interface PhoneReport {
  rate: number | null;
  sales: {
    count: number;
    total: number;
    cost: number;
    profit: number;
    totalUsd: number;
    profitUsd: number;
    surcharge: number;
    bySeller: { id: string; name: string; count: number; total: number; profit: number; commission: number }[];
    byChannel: { channel: string; count: number; total: number }[];
    byMethod: { method: string; amount: number; usd: number }[];
    byCategory: { name: string; total: number; profit: number }[];
    topModels: { name: string; units: number; revenueUsd: number; profitUsd: number }[];
    units: { saleId: string; date: string; name: string; imei: string | null; priceArs: number; rate: number | null; priceUsd: number; costUsd: number; profitUsd: number; seller: string | null }[];
  };
  stock: { units: number; costUsd: number; priceUsd: number; accessoriesUsd: number; aging: { bucket: string; units: number; costUsd: number }[]; aged: { id: string; name: string; imei: string | null; days: number; costUsd: number; status: string }[] };
  repairs: { open: { status: RepairStatus; count: number }[]; byTechnician: { id: string; name: string; delivered: number; revenue: number; parts: number; comebacks: number; avgDays: number | null; margin: number }[] };
  tradeIns: { count: number; paidUsd: number; resold: number; resoldProfitUsd: number; avgDaysToSell: number | null };
  couriers: { id: string; name: string; delivered: number; failed: number; pendingArs: number; pendingUsd: number }[];
  cash: { id: string; openedAt: string; closedAt: string | null; user: string | null; expected: number | null; counted: number | null; difference: number | null; expectedUsd: number | null; countedUsd: number | null; differenceUsd: number | null }[];
}
const METHOD: Record<string, string> = { CASH: 'Efectivo $', CASH_USD: 'Efectivo US$', DEBIT: 'Débito', CREDIT: 'Crédito', QR: 'QR', TRANSFER: 'Transferencia', TRADE_IN: 'Usado tomado', DEPOSIT: 'Seña' };
const CHANNEL: Record<string, string> = { POS: 'Local', ORDER: 'Pedidos (WhatsApp/Instagram)' };

const Stat = ({ v, l, to }: { v: string; l: string; to?: string }) => {
  const body = (
    <div className="stat">
      <div className="v">{v}</div>
      <div className="l">{l}</div>
    </div>
  );
  return to ? (
    <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>
      {body}
    </Link>
  ) : (
    body
  );
};

const firstOfMonth = () => `${todayISO().slice(0, 8)}01`;

export function PhoneReports() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayISO());
  const q = useQuery({ queryKey: ['phone-reports', from, to], queryFn: () => api<PhoneReport>(`/phone-reports?from=${from}&to=${to}`) });
  const r = q.data;
  return (
    <div className="stack">
      <h1>Números</h1>
      <div className="row">
        <Field label="Desde">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Hasta">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <button className="small" onClick={() => (setFrom(todayISO()), setTo(todayISO()))}>
          Hoy
        </button>
        <button className="small" onClick={() => (setFrom(firstOfMonth()), setTo(todayISO()))}>
          Este mes
        </button>
      </div>
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} />
      {r && (
        <>
          <div className="grid2">
            <Stat v={big(r.sales.total)} l={`Ventas (${r.sales.count})`} />
            <Stat v={bigUsd(r.sales.totalUsd)} l="Ventas en dólares" />
            <Stat v={big(r.sales.profit)} l="Ganancia" />
            <Stat v={bigUsd(r.sales.profitUsd)} l="Ganancia en dólares" />
            <Stat v={bigUsd(r.stock.costUsd + r.stock.accessoriesUsd)} l={`Stock al costo (${r.stock.units} equipos + accesorios)`} />
            <Stat v={bigUsd(r.stock.priceUsd)} l="Equipos a precio de venta" />
          </div>
          {r.sales.surcharge > 0 && <p className="small muted">Recargos por cuotas cobrados: {money(r.sales.surcharge)} (no cuentan como ganancia: cubren el costo de la financiación).</p>}

          <div className="card table-wrap">
            <div className="row between">
              <h3>Ganancia por equipo</h3>
              <button
                className="small"
                onClick={() =>
                  downloadCsv(`equipos-${from}-${to}.csv`, [
                    ['Fecha', 'Equipo', 'IMEI', 'Vendedor', 'Precio $', 'Dólar', 'Precio US$', 'Costo US$', 'Ganancia US$'],
                    ...r.sales.units.map((u) => [dayFmt(u.date), u.name, u.imei, u.seller, u.priceArs, u.rate, u.priceUsd, u.costUsd, u.profitUsd]),
                  ])
                }
              >
                ⬇ Excel
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Equipo</th>
                  <th className="num">Precio</th>
                  <th className="num">Costo</th>
                  <th className="num">Ganancia</th>
                </tr>
              </thead>
              <tbody>
                {r.sales.units.slice(0, 100).map((u, i) => (
                  <tr key={i}>
                    <td>
                      {u.name}
                      <div className="small muted">
                        {dayFmt(u.date)} · {u.imei} · {u.seller}
                      </div>
                    </td>
                    <td className="num">{usd(u.priceUsd)}</td>
                    <td className="num">{usd(u.costUsd)}</td>
                    <td className={`num ${u.profitUsd < 0 ? 'error' : ''}`}>{usd(u.profitUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid2">
            <div className="card">
              <h3>Modelos más vendidos</h3>
              {r.sales.topModels.map((m) => (
                <div key={m.name} className="kv small">
                  <span>
                    {m.units} × {m.name}
                  </span>
                  <span>{usd(m.profitUsd)}</span>
                </div>
              ))}
            </div>
            <div className="card">
              <h3>Vendedores</h3>
              {r.sales.bySeller.map((s) => (
                <div key={s.id} className="kv small">
                  <span>
                    {s.name} ({s.count})
                  </span>
                  <span>
                    {money(s.total)} {s.commission > 0 ? <span className="muted">· comisión {money(s.commission)}</span> : null}
                  </span>
                </div>
              ))}
            </div>
            <div className="card">
              <h3>Medios de pago</h3>
              {r.sales.byMethod.map((m) => (
                <div key={m.method} className="kv small">
                  <span>{METHOD[m.method] ?? m.method}</span>
                  <span>{m.method === 'CASH_USD' ? usd(m.usd) : money(m.amount)}</span>
                </div>
              ))}
            </div>
            <div className="card">
              <h3>Canales y categorías</h3>
              {r.sales.byChannel.map((c) => (
                <div key={c.channel} className="kv small">
                  <span>
                    {CHANNEL[c.channel] ?? ORDER_CHANNEL_LABELS[c.channel as OrderChannel] ?? c.channel} ({c.count})
                  </span>
                  <span>{money(c.total)}</span>
                </div>
              ))}
              <hr />
              {r.sales.byCategory.map((c) => (
                <div key={c.name} className="kv small">
                  <span>{c.name}</span>
                  <span>
                    {money(c.total)} <span className="muted">· gan. {money(c.profit)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>Antigüedad del stock</h3>
            <div className="grid2">
              {r.stock.aging.map((a) => (
                <Stat key={a.bucket} v={`${a.units}`} l={`${a.bucket} días · ${usd(a.costUsd)}`} />
              ))}
            </div>
            {r.stock.aged.length > 0 && (
              <>
                <h3 style={{ marginTop: 10 }}>Parados hace mucho</h3>
                {r.stock.aged.slice(0, 30).map((a) => (
                  <div key={a.id} className="kv small">
                    <Link to={`/serials/${a.id}`}>
                      {a.name} {a.imei ? `· ${a.imei}` : ''}
                    </Link>
                    <span>
                      {a.days} días · {usd(a.costUsd)}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="grid2">
            <div className="card">
              <h3>Servicio técnico</h3>
              {r.repairs.open.map((o) => (
                <div key={o.status} className="kv small">
                  <span>{REPAIR_STATUS_LABELS[o.status]}</span>
                  <strong>{o.count}</strong>
                </div>
              ))}
              <hr />
              {r.repairs.byTechnician.map((t) => (
                <div key={t.id} className="small">
                  <strong>{t.name}</strong>: {t.delivered} entregadas · {money(t.revenue)} · margen {money(t.margin)}
                  {t.avgDays != null ? ` · ${t.avgDays} días promedio` : ''}
                  {t.comebacks ? ` · ${t.comebacks} reingresos` : ''}
                </div>
              ))}
            </div>
            <div className="card">
              <h3>Usados</h3>
              <div className="small">Tomados: {r.tradeIns.count} por {usd(r.tradeIns.paidUsd)}</div>
              <div className="small">
                Revendidos: {r.tradeIns.resold} · ganancia {usd(r.tradeIns.resoldProfitUsd)}
                {r.tradeIns.avgDaysToSell != null ? ` · ${r.tradeIns.avgDaysToSell} días en venderse` : ''}
              </div>
              <hr />
              <h3>Cadetes</h3>
              {r.couriers.map((c) => (
                <div key={c.id} className="small">
                  <strong>{c.name}</strong>: {c.delivered} entregas · {c.failed} fallidas
                  {c.pendingArs || c.pendingUsd ? ` · debe rendir ${money(c.pendingArs)}${c.pendingUsd ? ` y ${usd(c.pendingUsd)}` : ''}` : ''}
                </div>
              ))}
            </div>
          </div>

          <div className="card table-wrap">
            <h3>Cierres de caja</h3>
            <table>
              <thead>
                <tr>
                  <th>Turno</th>
                  <th className="num">Pesos</th>
                  <th className="num">Dólares</th>
                </tr>
              </thead>
              <tbody>
                {r.cash.map((c) => (
                  <tr key={c.id}>
                    <td className="small">
                      {dateTimeFmt(c.openedAt)} · {c.user}
                    </td>
                    <td className={`num ${c.difference ? 'error' : ''}`}>{c.closedAt ? `${money(c.counted)} (${c.difference && c.difference > 0 ? '+' : ''}${money(c.difference)})` : 'abierta'}</td>
                    <td className={`num ${c.differenceUsd ? 'error' : ''}`}>{c.closedAt && c.expectedUsd != null ? `${usd(c.countedUsd)} (${usd(c.differenceUsd)})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

interface Brief {
  sales: PhoneReport['sales'];
  repairs: PhoneReport['repairs'];
  stock: PhoneReport['stock'];
}

/** Inicio de la casa de celulares: lo del día y accesos rápidos. */
export function PhoneHome() {
  const me = useMe();
  const fx = useFx();
  const today = todayISO();
  const rep = useQuery({ queryKey: ['phone-reports', today, today], queryFn: () => api<Brief>(`/phone-reports?from=${today}&to=${today}`), enabled: can(me, 'reports') });
  const ready = useQuery({ queryKey: ['repairs', 'READY', ''], queryFn: () => api<unknown[]>('/repairs?status=READY'), enabled: can(me, 'repairs') || can(me, 'sell') });
  const orders = useQuery({ queryKey: ['orders', 'open'], queryFn: () => api<unknown[]>('/orders?open=true'), enabled: can(me, 'orders') });
  const r = rep.data;
  const openRepairs = r?.repairs.open.reduce((s, x) => s + x.count, 0);
  const blue = fx.data?.quotes.find((x) => x.casa === 'blue');
  return (
    <div className="stack">
      <h1>¡Hola, {me.user.name}!</h1>
      <div className="grid2">
        <Stat v={fx.data?.rate ? money(fx.data.rate) : '—'} l={`Dólar del local${blue ? ` · blue ${money(blue.venta)}` : ''}`} to={can(me, 'owner') ? '/settings' : undefined} />
        {r && <Stat v={big(r.sales.total)} l={`Ventas de hoy (${r.sales.count})`} to="/reports" />}
        {r && <Stat v={bigUsd(r.sales.profitUsd)} l="Ganancia de hoy" to="/reports" />}
        {openRepairs != null && <Stat v={String(openRepairs)} l="Reparaciones en curso" to="/repairs" />}
        {ready.data && <Stat v={String(ready.data.length)} l="Listas para retirar" to="/repairs" />}
        {orders.data && <Stat v={String(orders.data.length)} l="Pedidos en curso" to="/orders" />}
        {r && <Stat v={String(r.stock.units)} l={`Equipos en el local (${usd(r.stock.priceUsd)})`} to="/serials" />}
      </div>
      <div className="grid2">
        {can(me, 'sell') && (
          <Link className="btn btn-primary big" to="/pos">
            🧾 Caja
          </Link>
        )}
        <Link className="btn big" to="/repairs/new">
          🔧 Recibir equipo
        </Link>
        {can(me, 'tradeins') && (
          <Link className="btn big" to="/tradeins/new">
            ♻️ Tomar un usado
          </Link>
        )}
        {can(me, 'orders') && (
          <Link className="btn big" to="/orders/new">
            📦 Pedido nuevo
          </Link>
        )}
        {can(me, 'deliveries') && (
          <Link className="btn big" to="/deliveries">
            🛵 Mis entregas
          </Link>
        )}
        <Link className="btn big" to="/serials">
          📱 Equipos
        </Link>
      </div>
    </div>
  );
}

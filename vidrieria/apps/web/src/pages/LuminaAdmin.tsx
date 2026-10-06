import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PLANS, PLAN_INFO, type PlanId } from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { ErrorBox, Loading, toast } from '../components/ui';
import { ago, dateFmt } from '../lib/format';

interface Row {
  id: string;
  slug: string;
  name: string;
  plan: PlanId;
  createdAt: string;
  customDomain: string | null;
  owner: { email: string; name: string } | null;
  counts: { quotes: number; leads: number; jobs: number };
  rendersMonth: number;
  lastActivity: string | null;
}

/** Lumina: las vidrierías clientas, su plan y su uso. */
export default function LuminaAdmin() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-businesses'], queryFn: () => api<Row[]>('/admin/businesses') });
  const set = useMutation({
    mutationFn: ({ id, plan }: { id: string; plan: PlanId }) => api(`/admin/businesses/${id}`, { method: 'PATCH', body: { plan } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-businesses'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast('Plan actualizado');
    },
    onError: (e) => toast(errMsg(e)),
  });
  if (q.isLoading) return <Loading />;
  const rows = q.data ?? [];
  const mrr = rows.reduce((a, r) => a + PLAN_INFO[r.plan].monthlyUsd, 0);
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Lumina · clientes</h1>
          <p className="muted small">
            {rows.length} vidrierías · abono total US$ {mrr} por mes (si todas pagan)
          </p>
        </div>
      </div>
      <ErrorBox error={q.error} />
      <div className="table-wrap card flush">
        <table className="table">
          <thead>
            <tr>
              <th>Vidriería</th>
              <th>Plan</th>
              <th className="hide-sm">Uso</th>
              <th className="hide-sm">Alta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={`/${r.slug}`} target="_blank" rel="noreferrer">
                    <strong>{r.name}</strong>
                  </a>
                  <span className="muted small block">{r.owner?.email ?? 'sin dueño'}</span>
                </td>
                <td>
                  <select value={r.plan} aria-label={`Plan de ${r.name}`} onChange={(e) => set.mutate({ id: r.id, plan: e.target.value as PlanId })}>
                    {PLANS.map((p) => (
                      <option key={p} value={p}>
                        {PLAN_INFO[p].name} · US$ {PLAN_INFO[p].monthlyUsd}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="hide-sm small">
                  {r.counts.quotes} presup. · {r.counts.leads} consultas · {r.counts.jobs} trabajos · {r.rendersMonth}/{PLAN_INFO[r.plan].renders} fotos IA
                  <span className="muted block">{r.lastActivity ? `activo ${ago(r.lastActivity)}` : 'sin actividad'}</span>
                </td>
                <td className="hide-sm muted small">{dateFmt(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

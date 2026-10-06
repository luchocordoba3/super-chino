import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CATEGORY_LABEL } from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { Empty, Loading, NumInput, toast } from '../components/ui';
import type { CatalogItem } from '../lib/types';

export const isLow = (c: Pick<CatalogItem, 'stockQty' | 'stockMin'>) => c.stockQty != null && c.stockMin != null && Number(c.stockQty) <= Number(c.stockMin);

/** Stock de herrajes, perfiles e insumos: cantidad y mínimo. Se descuenta solo al colocar cada trabajo. */
export default function Stock() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['stock'], queryFn: () => api<CatalogItem[]>('/stock') });
  const m = useMutation({
    mutationFn: ({ id, ...body }: { id: string; stockQty?: number | null; stockMin?: number | null }) => api(`/stock/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock'] }),
    onError: (e) => toast(errMsg(e)),
  });
  if (q.isLoading) return <Loading />;
  const items = q.data ?? [];
  const low = items.filter(isLow);
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Stock</h1>
          <p className="muted small">Cargá lo que tenés y el mínimo. Al marcar un trabajo como colocado se descuenta solo, y te avisamos cuando haya que reponer.</p>
        </div>
      </div>
      {!!low.length && <p className="note">Para reponer: {low.map((c) => c.name).join(', ')}.</p>}
      {!items.length ? (
        <Empty>No hay herrajes ni perfiles en tu catálogo.</Empty>
      ) : (
        <div className="table-wrap card flush">
          <table className="table">
            <thead>
              <tr>
                <th>Ítem</th>
                <th className="num">Tengo</th>
                <th className="num">Mínimo</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className={isLow(c) ? 'row-low' : ''}>
                  <td>
                    <strong>{c.name}</strong>
                    <span className="muted small block">{CATEGORY_LABEL[c.category]}</span>
                  </td>
                  <td className="num stock-cell">
                    <SaveOnBlur value={c.stockQty} label={`Stock de ${c.name}`} onSave={(v) => m.mutate({ id: c.id, stockQty: v })} />
                  </td>
                  <td className="num stock-cell">
                    <SaveOnBlur value={c.stockMin} label={`Mínimo de ${c.name}`} onSave={(v) => m.mutate({ id: c.id, stockMin: v })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Número que se guarda al salir del campo (no en cada tecla). */
function SaveOnBlur({ value, label, onSave }: { value: number | null; label: string; onSave: (v: number | null) => void }) {
  const [v, setV] = useState<number | null>(value == null ? null : Number(value));
  return (
    <span onBlur={() => v !== (value == null ? null : Number(value)) && onSave(v)}>
      <NumInput value={v} placeholder="—" ariaLabel={label} onChange={setV} />
    </span>
  );
}

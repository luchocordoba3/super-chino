import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LEAD_SOURCE_LABEL } from '@vidrieria/shared';
import { api, errMsg } from '../api';
import { Empty, ErrorBox, Loading, Modal, toast } from '../components/ui';
import { ago, dateTimeFmt, qty } from '../lib/format';
import { useMe } from '../lib/me';
import type { Lead } from '../lib/types';
import { leadReply, waLink } from '../lib/whatsapp';

const STATUS = { NEW: 'Nuevas', QUOTED: 'Presupuestadas', CLOSED: 'Cerradas' } as const;
type St = keyof typeof STATUS;

export const leadSize = (l: Pick<Lead, 'widthCm' | 'heightCm' | 'quantity'>) =>
  l.widthCm && l.heightCm ? `${qty(l.widthCm)} × ${qty(l.heightCm)} cm${l.quantity && l.quantity > 1 ? ` · ${l.quantity} u` : ''}` : 'sin medidas';

export default function Leads() {
  const [status, setStatus] = useState<St>('NEW');
  const [open, setOpen] = useState<Lead | null>(null);
  const q = useQuery({ queryKey: ['leads', status], queryFn: () => api<Lead[]>(`/leads?status=${status}`) });
  const me = useMe();
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Consultas</h1>
        {me.data && (
          <a className="btn" href={`/${me.data.business.slug}#presupuesto`} target="_blank" rel="noreferrer">
            Ver el formulario de mi web ↗
          </a>
        )}
      </div>
      <div className="seg" role="group" aria-label="Estado">
        {(Object.keys(STATUS) as St[]).map((s) => (
          <button key={s} type="button" className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
            {STATUS[s]}
          </button>
        ))}
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <Empty>{status === 'NEW' ? 'No hay consultas nuevas. Las que lleguen desde tu web aparecen acá.' : 'No hay consultas en esta lista.'}</Empty>
      ) : (
        <ul className="cards">
          {q.data.map((l) => (
            <li key={l.id}>
              <button type="button" className={'card lead-card' + (l.urgent ? ' urgent' : '')} onClick={() => setOpen(l)}>
                <span className="row between">
                  <strong>{l.kind}</strong>
                  <span className="muted small">{ago(l.createdAt)}</span>
                </span>
                <span className="row wrap">
                  {l.urgent && <span className="pill">Urgente</span>}
                  {l.source !== 'WEB' && <span className="pill neutral">{LEAD_SOURCE_LABEL[l.source]}</span>}
                </span>
                <span className="mono small">{leadSize(l)}</span>
                <span>
                  {l.name}
                  {l.zone && <span className="muted"> · {l.zone}</span>}
                </span>
                {l.when && <span className="pill">{l.when}</span>}
                {l.details && <span className="muted small clamp">{l.details}</span>}
                {!!l.photoIds.length && <span className="small muted">📷 {l.photoIds.length} foto(s)</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <LeadModal lead={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function LeadModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const close = useMutation({
    mutationFn: (status: 'CLOSED' | 'NEW') => api(`/leads/${lead.id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast('Listo');
      onClose();
    },
    onError: (e) => toast(errMsg(e)),
  });
  return (
    <Modal title={lead.kind} onClose={onClose}>
      <dl className="dl">
        <dt>Medidas</dt>
        <dd className="mono">{leadSize(lead)}</dd>
        <dt>Cliente</dt>
        <dd>
          {lead.name} · <span className="mono">{lead.phone}</span>
        </dd>
        {lead.zone && (
          <>
            <dt>Zona</dt>
            <dd>{lead.zone}</dd>
          </>
        )}
        {lead.when && (
          <>
            <dt>Para cuándo</dt>
            <dd>{lead.when}</dd>
          </>
        )}
        {lead.details && (
          <>
            <dt>Detalle</dt>
            <dd>{lead.details}</dd>
          </>
        )}
        <dt>Llegó</dt>
        <dd>
          {dateTimeFmt(lead.createdAt)} · {LEAD_SOURCE_LABEL[lead.source]}
        </dd>
      </dl>
      {!!lead.photoIds.length && (
        <div className="photos">
          {lead.photoIds.map((id) => (
            <a key={id} href={`/api/assets/${id}`} target="_blank" rel="noreferrer">
              <img src={`/api/assets/${id}`} alt="Foto de la consulta" />
            </a>
          ))}
        </div>
      )}
      {!!lead.quotes.length && (
        <p className="small">
          Presupuestos:{' '}
          {lead.quotes.map((q) => (
            <Link key={q.id} to={`/panel/presupuestos/${q.id}`} onClick={onClose}>
              N° {q.number}{' '}
            </Link>
          ))}
        </p>
      )}
      <div className="actions">
        <button className="btn primary" type="button" onClick={() => nav(`/panel/presupuestos/nuevo?consulta=${lead.id}`)}>
          Presupuestar
        </button>
        <a className="btn wa" href={waLink(lead.phone, leadReply(lead, me.data?.user.name ?? '', me.data?.business.name ?? ''))} target="_blank" rel="noreferrer">
          Responder por WhatsApp
        </a>
        {lead.status !== 'CLOSED' ? (
          <button className="btn ghost" type="button" onClick={() => close.mutate('CLOSED')}>
            Cerrar consulta
          </button>
        ) : (
          <button className="btn ghost" type="button" onClick={() => close.mutate('NEW')}>
            Volver a nuevas
          </button>
        )}
      </div>
    </Modal>
  );
}

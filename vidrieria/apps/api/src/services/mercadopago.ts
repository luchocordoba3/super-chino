import type { Business, Quote } from '@prisma/client';
import { env } from '../env';
import { HttpError } from '../lib/http';
import { open } from '../lib/secret';

const MP = 'https://api.mercadopago.com';

/** Token de Mercado Pago de la vidriería (guardado cifrado). */
export const mpToken = (b: Pick<Business, 'mpAccessToken'>) => open(b.mpAccessToken);

async function mp<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(MP + path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new HttpError(502, 'mp_error', `Mercado Pago respondió: ${data.message ?? res.status}`);
  return data;
}

/** Link de pago (Checkout Pro) para la seña o el saldo. La comisión la paga la vidriería. */
export async function paymentLink(b: Business, q: Quote, kind: 'SENA' | 'SALDO', amount: number, origin: string) {
  const token = mpToken(b);
  if (!token) throw new HttpError(409, 'mp_not_connected', 'La vidriería todavía no conectó Mercado Pago');
  const base = env.PUBLIC_URL || origin;
  const back = `${base}/p/${q.publicToken}`;
  const pref = await mp<{ id: string; init_point: string }>(token, '/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ title: `${kind === 'SENA' ? 'Seña' : 'Saldo'} · Presupuesto N° ${q.number}${q.title ? ` · ${q.title}` : ''}`, quantity: 1, unit_price: Math.round(amount), currency_id: 'ARS' }],
      external_reference: `${q.id}:${kind}`,
      notification_url: `${base}/api/public/mp/${b.id}`,
      back_urls: { success: back, pending: back, failure: back },
      auto_return: 'approved',
      statement_descriptor: b.name.slice(0, 22),
    }),
  });
  return pref.init_point;
}

export interface MpPayment {
  id: number;
  status: string;
  external_reference: string | null;
  transaction_amount: number;
  date_approved: string | null;
  transaction_details?: { net_received_amount?: number };
}

/** Consulta el pago en Mercado Pago (nunca se confía en lo que dice el aviso). */
export const getPayment = (token: string, id: string) => mp<MpPayment>(token, `/v1/payments/${encodeURIComponent(id)}`);

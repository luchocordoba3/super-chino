/**
 * Mercado Pago, cobro con QR "modelo atendido": cada mesa y el mostrador tienen un QR fijo (una "caja" de
 * Mercado Pago). La caja crea una orden con el monto en el QR de esa mesa; el cliente escanea y solo paga.
 * Docs: https://www.mercadopago.com.ar/developers/es/docs/qr-code/integration-configuration/qr-attended/introduction
 */
import { round2 } from '@almacen/shared';
import { num, prisma } from '../db';
import { env } from '../env';
import { decrypt, encrypt, hmacSha256, safeEqual } from '../lib/crypto';
import { HttpError } from '../lib/http';

export class MpError extends HttpError {
  constructor(
    public readonly mpStatus: number,
    public readonly detail: unknown,
  ) {
    super(502, 'mp_error');
  }
}

type Json = Record<string, unknown>;

async function mpFetch<T = Json>(token: string, method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const res = await fetch(env.MP_API_BASE + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new MpError(res.status, data);
  return data;
}

// ---------- Cuenta ----------

export const oauthEnabled = () => !!(env.MP_CLIENT_ID && env.MP_CLIENT_SECRET);

export function authorizeUrl(redirectUri: string, state: string) {
  const q = new URLSearchParams({ client_id: env.MP_CLIENT_ID, response_type: 'code', platform_id: 'mp', state, redirect_uri: redirectUri });
  return `${env.MP_AUTH_BASE}/authorization?${q}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  user_id: number | string;
}

async function saveAccount(storeId: string, t: TokenResponse) {
  const data = {
    userId: String(t.user_id),
    accessToken: encrypt(t.access_token),
    refreshToken: t.refresh_token ? encrypt(t.refresh_token) : null,
    expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
  };
  await prisma.mpAccount.upsert({ where: { storeId }, create: { storeId, ...data }, update: data });
}

async function oauthToken(body: Json) {
  const res = await fetch(`${env.MP_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: env.MP_CLIENT_ID, client_secret: env.MP_CLIENT_SECRET, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) throw new MpError(res.status, data);
  return data;
}

/** "Conectar Mercado Pago": el dueño autorizó en Mercado Pago y vuelve con un código. */
export async function connectWithCode(storeId: string, code: string, redirectUri: string) {
  await saveAccount(storeId, await oauthToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }));
}

/** Alternativa sin aplicación del sistema: el dueño pega el Access Token de su cuenta. */
export async function connectWithToken(storeId: string, accessToken: string) {
  const me = await mpFetch<{ id: number | string }>(accessToken, 'GET', '/users/me');
  await saveAccount(storeId, { access_token: accessToken, user_id: me.id });
}

/** Access Token vigente (lo renueva si vence en menos de una semana). */
export async function accessToken(storeId: string) {
  const acc = await prisma.mpAccount.findUnique({ where: { storeId } });
  if (!acc) throw new HttpError(409, 'mp_not_connected');
  if (acc.refreshToken && acc.expiresAt && acc.expiresAt.getTime() - Date.now() < 7 * 86_400_000 && oauthEnabled()) {
    const t = await oauthToken({ grant_type: 'refresh_token', refresh_token: decrypt(acc.refreshToken) });
    await saveAccount(storeId, t);
    return { token: t.access_token, userId: String(t.user_id) };
  }
  return { token: decrypt(acc.accessToken), userId: acc.userId };
}

// ---------- QR fijos: sucursal y "cajas" de Mercado Pago ----------

export interface StoreAddress {
  streetName: string;
  streetNumber: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
}

const posExternalId = (code: string, table: number | null) => `ALM${code}${table == null ? 'CAJA' : `M${table}`}`;

/** Crea (solo lo que falta) la sucursal y un QR por mesa más el del mostrador. */
export async function setupQrs(storeId: string, address: StoreAddress | null) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const tables = Math.max(0, Number((store.settings as { tables?: number })?.tables ?? 6));
  const { token, userId } = await accessToken(storeId);
  const acc = await prisma.mpAccount.findUniqueOrThrow({ where: { storeId } });
  let mpStoreId = acc.mpStoreId;
  if (!mpStoreId) {
    if (!address) throw new HttpError(400, 'mp_address_required');
    const created = await mpFetch<{ id: number | string }>(token, 'POST', `/users/${userId}/stores`, {
      name: store.name.slice(0, 60),
      external_id: `ALM${store.code}`,
      location: {
        street_name: address.streetName,
        street_number: address.streetNumber,
        city_name: address.city,
        state_name: address.state,
        latitude: address.latitude,
        longitude: address.longitude,
        reference: store.name.slice(0, 60),
      },
    });
    mpStoreId = String(created.id);
    await prisma.mpAccount.update({ where: { storeId }, data: { mpStoreId } });
  }
  const existing = await prisma.mpPos.findMany({ where: { storeId } });
  const wanted: (number | null)[] = [null, ...Array.from({ length: tables }, (_, i) => i + 1)];
  for (const table of wanted) {
    if (existing.some((p) => p.table === table)) continue;
    const externalId = posExternalId(store.code, table);
    const pos = await mpFetch<{ id: number | string; qr?: { image?: string } }>(token, 'POST', '/pos', {
      name: table == null ? 'Mostrador' : `Mesa ${table}`,
      fixed_amount: true,
      store_id: Number(mpStoreId) || mpStoreId,
      external_store_id: `ALM${store.code}`,
      external_id: externalId,
    });
    await prisma.mpPos.create({ data: { storeId, table, externalId, mpPosId: String(pos.id), qrImage: pos.qr?.image ?? '' } });
  }
  return listQrs(storeId);
}

export async function listQrs(storeId: string) {
  const rows = await prisma.mpPos.findMany({ where: { storeId } });
  return rows
    .map((p) => ({ table: p.table, externalId: p.externalId, qrImage: p.qrImage }))
    .sort((a, b) => (a.table ?? 0) - (b.table ?? 0));
}

// ---------- Cobros ----------

interface MpOrder {
  id: string;
  status: string;
  transactions?: { payments?: { id?: string; status?: string }[] };
}
const money = (n: number) => round2(n).toFixed(2);
const FINAL = new Set(['processed', 'canceled', 'expired', 'failed', 'refunded']);

/** Crea la orden con el monto en el QR de la mesa (o del mostrador). Si la caja reintenta, no duplica. */
export async function createCharge(storeId: string, a: { chargeId: string; amount: number; table: number | null; description: string }) {
  const prev = await prisma.mpCharge.findUnique({ where: { id: a.chargeId } });
  if (prev) {
    if (prev.storeId !== storeId) throw new HttpError(409, 'charge_conflict');
    return chargeView(prev);
  }
  const pos =
    (await prisma.mpPos.findFirst({ where: { storeId, table: a.table } })) ?? (a.table != null ? await prisma.mpPos.findFirst({ where: { storeId, table: null } }) : null);
  if (!pos) throw new HttpError(409, 'mp_qr_missing');
  const { token } = await accessToken(storeId);
  const order = await mpFetch<MpOrder>(
    token,
    'POST',
    '/v1/orders',
    {
      type: 'qr',
      total_amount: money(a.amount),
      description: a.description.slice(0, 150),
      external_reference: a.chargeId,
      expiration_time: 'PT15M',
      config: { qr: { external_pos_id: pos.externalId, mode: 'static' } },
      transactions: { payments: [{ amount: money(a.amount) }] },
    },
    a.chargeId,
  );
  const charge = await prisma.mpCharge.create({
    data: { id: a.chargeId, storeId, orderId: order.id, posExternalId: pos.externalId, amount: a.amount, status: order.status ?? 'created' },
  });
  return chargeView(charge, pos.table);
}

/** Estado del cobro; si sigue pendiente, lo consulta en Mercado Pago (además del aviso por webhook). */
export async function chargeStatus(storeId: string, chargeId: string) {
  const c = await prisma.mpCharge.findFirst({ where: { id: chargeId, storeId } });
  if (!c) throw new HttpError(404, 'not_found');
  if (FINAL.has(c.status) || !c.orderId || Date.now() - c.updatedAt.getTime() < 1500) return chargeView(c);
  return chargeView(await refreshCharge(storeId, c.orderId));
}

async function refreshCharge(storeId: string, orderId: string) {
  const { token } = await accessToken(storeId);
  const order = await mpFetch<MpOrder>(token, 'GET', `/v1/orders/${encodeURIComponent(orderId)}`);
  const paymentId = order.transactions?.payments?.[0]?.id ?? null;
  return prisma.mpCharge.update({ where: { orderId }, data: { status: order.status, paymentId, updatedAt: new Date() } });
}

export async function cancelCharge(storeId: string, chargeId: string) {
  const c = await prisma.mpCharge.findFirst({ where: { id: chargeId, storeId } });
  if (!c) throw new HttpError(404, 'not_found');
  if (FINAL.has(c.status) || !c.orderId) return chargeView(c);
  const { token } = await accessToken(storeId);
  try {
    await mpFetch(token, 'POST', `/v1/orders/${encodeURIComponent(c.orderId)}/cancel`, undefined, `cancel-${c.id}`);
  } catch (e) {
    // Si ya estaba pagada o vencida, manda lo que diga Mercado Pago.
    if (!(e instanceof MpError)) throw e;
  }
  return chargeView(await refreshCharge(storeId, c.orderId));
}

function chargeView(c: { id: string; orderId: string | null; status: string; amount: unknown; paymentId: string | null; posExternalId: string }, table?: number | null) {
  return { chargeId: c.id, orderId: c.orderId, status: c.status, paid: c.status === 'processed', amount: num(c.amount as number), paymentId: c.paymentId, pos: c.posExternalId, table };
}

// ---------- Webhook ----------

/**
 * Firma de Mercado Pago: header x-signature "ts=...,v1=..." = HMAC-SHA256 de "id:{data.id};request-id:{x-request-id};ts:{ts};"
 * con la clave secreta del webhook (el id alfanumérico va en minúsculas).
 */
export function validSignature(signature: string | undefined, requestId: string | undefined, dataId: string) {
  if (!env.MP_WEBHOOK_SECRET) return true;
  if (!signature) return false;
  const parts = Object.fromEntries(signature.split(',').map((p) => p.trim().split('=') as [string, string]));
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${dataId.toLowerCase()};${requestId ? `request-id:${requestId};` : ''}ts:${parts.ts};`;
  return safeEqual(hmacSha256(env.MP_WEBHOOK_SECRET, manifest), parts.v1);
}

/** Aviso de Mercado Pago: se vuelve a consultar la orden (no se confía en el cuerpo del aviso). */
export async function onOrderNotification(orderId: string) {
  const c = await prisma.mpCharge.findUnique({ where: { orderId } });
  if (!c) return null;
  const updated = await refreshCharge(c.storeId, orderId);
  return { storeId: c.storeId, status: updated.status };
}

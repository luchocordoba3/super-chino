import type { LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import { prisma } from '../src/db';

export type App = Awaited<ReturnType<typeof buildApp>>;
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Res = { status: number; body: any; res: LightMyRequestResponse };

export async function resetDb() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`);
}

export function client(app: App, cookie?: string, headers: Record<string, string> = {}) {
  const call = async (method: Method, url: string, payload?: unknown): Promise<Res> => {
    const res = await app.inject({
      method,
      url: '/api' + url,
      payload: payload as never,
      headers: { ...(cookie ? { cookie } : {}), ...headers },
    });
    let body: unknown = null;
    try {
      body = res.body ? JSON.parse(res.body) : null;
    } catch {
      body = res.body;
    }
    return { status: res.statusCode, body, res };
  };
  return {
    get: (u: string) => call('GET', u),
    post: (u: string, p: unknown = {}) => call('POST', u, p),
    patch: (u: string, p: unknown = {}) => call('PATCH', u, p),
    put: (u: string, p: unknown = {}) => call('PUT', u, p),
    del: (u: string) => call('DELETE', u),
  };
}
export type Client = ReturnType<typeof client>;

export function cookieFrom(res: LightMyRequestResponse) {
  const c = res.cookies.find((x) => x.name === 'sc_session');
  if (!c) throw new Error('sin cookie de sesión');
  return `sc_session=${c.value}`;
}

let n = 0;
export async function registerOwner(app: App, overrides: Record<string, unknown> = {}) {
  n += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { storeName: 'Súper Test', name: 'Li Wei', email: `owner${n}@test.com`, password: 'secreto123', lang: 'zh', ...overrides },
  });
  if (res.statusCode !== 200) throw new Error(res.body);
  const cookie = cookieFrom(res);
  const api = client(app, cookie);
  const me = (await api.get('/auth/me')).body;
  return { cookie, api, me, storeId: me.store.id as string, storeCode: me.store.code as string, ownerId: me.user.id as string };
}
export type Owner = Awaited<ReturnType<typeof registerOwner>>;

export async function createEmployee(
  app: App,
  owner: Owner,
  data: { name?: string; username?: string; pin?: string; perms?: string[]; lang?: string } = {},
) {
  const payload = { name: 'Sofía', username: `emp${++n}`, pin: '1234', perms: ['sell', 'stock'], lang: 'es', ...data };
  const created = await owner.api.post('/users', payload);
  if (created.status !== 200) throw new Error(JSON.stringify(created.body));
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { storeCode: owner.storeCode, username: payload.username, pin: payload.pin },
  });
  const cookie = cookieFrom(login);
  return { id: created.body.id as string, cookie, api: client(app, cookie), username: payload.username };
}

/** Arma un cuerpo multipart/form-data para app.inject. */
export function multipart(fields: Record<string, string>, file?: { name: string; filename: string; type: string; data: Buffer }) {
  const boundary = `----sc${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    parts.push(file.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** PNG de 1x1 para probar subidas. */
export const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

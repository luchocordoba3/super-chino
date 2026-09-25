import i18n from './i18n';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Opts = { method?: string; body?: unknown; form?: FormData; headers?: Record<string, string> };

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const hasBody = opts.body !== undefined || opts.form !== undefined;
  const res = await fetch('/api' + path, {
    method: opts.method ?? (hasBody ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: { ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? res.statusText);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Mensaje de error para mostrar al usuario, en su idioma (nunca códigos técnicos ni textos en inglés). */
export function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    const code = e.code === 'forbidden_prices' ? 'forbidden' : e.code;
    if (i18n.exists(`errors.${code}`)) return i18n.t(`errors.${code}` as 'errors.generic');
    if (e.status === 401) return i18n.t('errors.unauthorized');
    if (e.status === 403) return i18n.t('errors.forbidden');
    if (e.status === 404) return i18n.t('errors.not_found');
    return i18n.t('errors.generic');
  }
  if (e instanceof TypeError) return i18n.t('errors.network');
  return e instanceof Error ? e.message : String(e);
}

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

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Opts = { method?: string; body?: unknown };

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const hasBody = opts.body !== undefined;
  const res = await fetch('/api' + path, {
    method: opts.method ?? (hasBody ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: hasBody ? { 'content-type': 'application/json' } : {},
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? res.statusText);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const MESSAGES: Record<string, string> = {
  bad_credentials: 'El email o la contraseña no son correctos.',
  unauthorized: 'Tu sesión venció. Volvé a entrar.',
  forbidden: 'Solo el dueño puede hacer esto.',
  not_found: 'No lo encontramos. Puede que lo hayan borrado.',
  internal: 'Algo falló en el servidor. Probá de nuevo en un rato.',
};

/** Mensaje para mostrar al usuario (nunca códigos técnicos). */
export function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    if (MESSAGES[e.code]) return MESSAGES[e.code];
    if (e.code === 'validation' || (e.message && !/^[a-z_]+$/.test(e.message) && e.message !== 'Bad Request')) return e.message;
    if (e.status === 429) return 'Demasiados intentos. Esperá un minuto y probá de nuevo.';
    return 'No se pudo completar. Probá de nuevo.';
  }
  if (e instanceof TypeError) return 'Sin conexión. Revisá internet y probá de nuevo.';
  return e instanceof Error ? e.message : String(e);
}

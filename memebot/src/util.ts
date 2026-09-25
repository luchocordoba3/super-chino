export type Fetch = typeof fetch;

export function log(level: 'info' | 'warn' | 'error', msg: string): void {
  const line = `${new Date().toISOString()} [${level}] ${msg}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** GET/POST que devuelve JSON; lanza error si la respuesta no es 2xx o tarda demasiado. */
export async function getJson(
  url: string,
  init: RequestInit = {},
  fetchImpl: Fetch = fetch,
  timeoutMs = 10_000,
): Promise<unknown> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${new URL(url).host}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/** Espera `ms`, o menos si se aborta la señal. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export const fmtUsd = (n: number): string =>
  `US$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

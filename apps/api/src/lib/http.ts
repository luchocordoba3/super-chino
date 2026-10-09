export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const notFound = (what = 'not_found') => new HttpError(404, what);
export const badRequest = (code: string, message?: string) => new HttpError(400, code, message);

/** Con .partial() zod igual completa los valores por defecto: en un PATCH solo cuentan los campos que mandaron. */
export function sentOnly<T extends object>(parsed: T, raw: unknown): Partial<T> {
  const keys = new Set(raw && typeof raw === 'object' ? Object.keys(raw) : []);
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => keys.has(k))) as Partial<T>;
}

import type { SalePlan } from '../db/types';
import { addDays, dayKey, diffDays } from './dates';

// Códigos de activación. El vendedor los firma con su clave privada (ECDSA P-256) y la app los
// verifica sin internet con la clave pública: nadie puede inventarlos aunque mire el código de la app.
// Formato: base64url(datos en JSON) + "." + base64url(firma de 64 bytes).

export interface LicensePayload {
  v: 1;
  /** Código del celular. Vacío en los promos para cualquiera. */
  d: string;
  p: SalePlan;
  /** Desde y hasta cuándo vale (AAAA-MM-DD, inclusive). */
  s: string;
  x: string;
  /** Nombre del cliente (para mostrarlo en la app). */
  n?: string;
}

export const PLAN_DAYS: Record<Exclude<SalePlan, 'promo'>, number> = { mes: 30, anual: 365 };
export const PLAN_LABEL: Record<SalePlan, string> = { mes: 'Mensual', anual: 'Anual', promo: 'Promo' };

const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

export function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

// Código del celular: 8 letras y números fáciles de dictar (sin 0/O, 1/I/L ni U).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newInstallId(): string {
  const r = crypto.getRandomValues(new Uint8Array(8));
  return [...r].map((n) => ALPHABET[n % ALPHABET.length]).join('');
}

/** Lo que tipea o pega la gente: sin guiones, espacios ni minúsculas. */
export const normalizeId = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '');
export const formatId = (id: string) => (id.length === 8 ? `${id.slice(0, 4)}-${id.slice(4)}` : id);

/** Saca el código de lo que pegó la persona: el código solo, o el link con #código. */
export const extractCode = (text: string) => text.trim().split('#').pop()!.replace(/\s/g, '');

export async function generateSellerKey() {
  const pair = (await crypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  return { privateJwk, publicKey };
}

/** La clave pública (para pegar en Render) a partir del archivo de la clave privada. */
export async function publicFromPrivate(jwk: JsonWebKey): Promise<string> {
  const pub = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true }, ALG, true, ['verify']);
  return b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pub)));
}

export async function signCode(privateJwk: JsonWebKey, payload: LicensePayload): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', privateJwk, ALG, false, ['sign']);
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign(SIGN, key, data));
  return `${b64url(data)}.${b64url(sig)}`;
}

/** Verifica la firma con alguna de las claves públicas. Devuelve los datos o null si es trucho o está roto. */
export async function verifyCode(code: string, publicKeys: string[]): Promise<LicensePayload | null> {
  const [data, sig] = code.trim().split('.');
  if (!data || !sig || code.length > 2000) return null;
  try {
    const bytes = fromB64url(data);
    const signature = fromB64url(sig);
    for (const k of publicKeys) {
      const key = await crypto.subtle.importKey('raw', fromB64url(k), ALG, false, ['verify']);
      if (await crypto.subtle.verify(SIGN, key, signature, bytes)) {
        const p = JSON.parse(new TextDecoder().decode(bytes)) as LicensePayload;
        return p?.v === 1 && typeof p.x === 'string' && typeof p.s === 'string' && typeof p.d === 'string' ? p : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Por qué un código firmado no sirve en este celular (o null si sirve). */
export function codeProblem(p: LicensePayload, installId: string | undefined, today: string): string | null {
  if (p.d && p.d !== installId) return 'Este código es para otro celular. Pedile al vendedor uno para tu código de celular.';
  if (p.x < today) return 'Este código ya venció.';
  return null;
}

export type Entitlement =
  | { state: 'free' }
  | { state: 'trial'; daysLeft: number; until: string }
  | { state: 'active'; until: string; daysLeft: number; plan: SalePlan; name?: string }
  | { state: 'expired'; wasTrial: boolean; until: string };

/**
 * Qué puede hacer la persona hoy. Sin claves configuradas la app es libre. Si no, vale el código (si es de
 * este celular y no venció) y si no hay, la prueba gratis desde el primer día.
 */
export function entitlement(o: { licensing: boolean; license: LicensePayload | null; installId?: string; trialStart?: string; trialDays: number; today: string }): Entitlement {
  if (!o.licensing) return { state: 'free' };
  const lic = o.license && !(o.license.d && o.license.d !== o.installId) ? o.license : null;
  if (lic && lic.x >= o.today) return { state: 'active', until: lic.x, daysLeft: diffDays(o.today, lic.x) + 1, plan: lic.p, name: lic.n };
  const trialEnd = addDays(o.trialStart ? dayKey(o.trialStart) : o.today, o.trialDays - 1);
  if (trialEnd >= o.today) return { state: 'trial', daysLeft: diffDays(o.today, trialEnd) + 1, until: trialEnd };
  return lic ? { state: 'expired', wasTrial: false, until: lic.x } : { state: 'expired', wasTrial: true, until: trialEnd };
}

export const canWrite = (e: Entitlement) => e.state !== 'expired';

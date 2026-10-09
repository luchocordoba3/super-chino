import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../env';

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

// PIN con PBKDF2-SHA256: la caja lo puede verificar sin internet con WebCrypto.
const PIN_ITER = 60_000;
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(pin, salt, PIN_ITER, 32, 'sha256');
  return `pbkdf2$${PIN_ITER}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPin(pin: string, stored: string): boolean {
  const [alg, iter, salt, hash] = stored.split('$');
  if (alg !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = pbkdf2Sync(pin, Buffer.from(salt, 'base64'), Number(iter), expected.length, 'sha256');
  return timingSafeEqual(actual, expected);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(len = 6): string {
  const b = randomBytes(len);
  return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
}

// Datos sensibles guardados cifrados (código o patrón de desbloqueo de un equipo en reparación).
const secretKey = () => createHash('sha256').update(`lock:${env.JWT_SECRET}`).digest();
export function encrypt(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${data.toString('base64')}`;
}
export function decrypt(blob: string): string | null {
  try {
    const [v, iv, tag, data] = blob.split('.');
    if (v !== 'v1') return null;
    const d = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

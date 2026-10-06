import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../env';

/** Cifra datos sensibles de la vidriería (token de Mercado Pago, certificado de ARCA) con una clave derivada del secreto. */
const key = () => createHash('sha256').update(env.JWT_SECRET + ':secrets').digest();

export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function open(sealed: string | null | undefined) {
  if (!sealed) return null;
  const [v, iv, tag, data] = sealed.split(':');
  if (v !== 'v1') return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

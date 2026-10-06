import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // sin .env: se usan las variables del entorno
}

const isTest = process.env.NODE_ENV === 'test' || !!process.env.VITEST;

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  isTest,
  PORT: Number(process.env.PORT ?? 3000),
  HOST: process.env.HOST ?? '0.0.0.0',
  // En tests SIEMPRE se usa la base de test, nunca la de desarrollo.
  DATABASE_URL: isTest
    ? (process.env.TEST_DATABASE_URL ?? 'postgresql://vidrieria:vidrieria@localhost:5432/vidrieria_test')
    : (process.env.DATABASE_URL ?? ''),
  JWT_SECRET: jwtSecret(),
  WEB_DIST: path.resolve(root, '../web/dist'),
  /** Carga la demo de Cristales Ariel al arrancar (no duplica). */
  SEED_DEMO: process.env.SEED_DEMO === 'true',
  /** Lectura del dólar en internet (dolarapi.com). En tests, apagada. */
  DOLLAR_FETCH: !isTest && process.env.DOLLAR_FETCH !== 'false',
  AUTH_RATE_LIMIT: Number(process.env.AUTH_RATE_LIMIT) || 10,
  /** Consultas por hora y por IP desde la web pública. */
  LEAD_RATE_LIMIT: Number(process.env.LEAD_RATE_LIMIT) || 10,
  /** Avisos al celular (web push). Si no se configuran las claves, se derivan del secreto de sesión. */
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY ?? '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY ?? '',
  PUSH_SUBJECT: process.env.PUSH_SUBJECT ?? 'mailto:avisos@lumina.app',
  /** Fotos "así quedaría" con IA (Gemini). Sin clave, la función queda lista pero apagada. */
  IMAGE_API_KEY: process.env.IMAGE_API_KEY ?? '',
  IMAGE_MODEL: process.env.IMAGE_MODEL ?? 'gemini-2.5-flash-image',
  /** Dirección pública de la app (links en avisos, Mercado Pago y QR). */
  PUBLIC_URL: (process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? '').replace(/\/$/, ''),
};

/**
 * Secreto de las sesiones. En producción, si no se configuró, se deriva de DATABASE_URL (que ya es secreta):
 * así alcanza con cargar la base al publicar, y las sesiones sobreviven a los reinicios.
 */
function jwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en producción');
    return createHash('sha256').update(process.env.DATABASE_URL + ':jwt').digest('hex');
  }
  return 'dev-secret-cambiar';
}

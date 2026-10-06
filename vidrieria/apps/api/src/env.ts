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
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-cambiar',
  WEB_DIST: path.resolve(root, '../web/dist'),
  /** Carga la demo de Cristales Ariel al arrancar (no duplica). */
  SEED_DEMO: process.env.SEED_DEMO === 'true',
  /** Lectura del dólar en internet (dolarapi.com). En tests, apagada. */
  DOLLAR_FETCH: !isTest && process.env.DOLLAR_FETCH !== 'false',
  AUTH_RATE_LIMIT: Number(process.env.AUTH_RATE_LIMIT) || 10,
  /** Consultas por hora y por IP desde la web pública. */
  LEAD_RATE_LIMIT: Number(process.env.LEAD_RATE_LIMIT) || 10,
};

if (env.NODE_ENV === 'production' && env.JWT_SECRET === 'dev-secret-cambiar') {
  throw new Error('Falta JWT_SECRET en producción');
}

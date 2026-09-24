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
    ? (process.env.TEST_DATABASE_URL ?? 'postgresql://superchino:superchino@localhost:5432/superchino_test')
    : (process.env.DATABASE_URL ?? ''),
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-cambiar',
  ANTHROPIC_API_KEY: isTest ? '' : (process.env.ANTHROPIC_API_KEY ?? ''),
  AI_MODEL: process.env.AI_MODEL || 'claude-opus-5',
  UPLOAD_DIR: path.resolve(root, process.env.UPLOAD_DIR ?? 'uploads'),
  WEB_DIST: path.resolve(root, '../web/dist'),
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY ?? '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY ?? '',
  VAPID_SUBJECT: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
  JOBS_ENABLED: !isTest && process.env.JOBS_ENABLED !== 'false',
};

if (env.NODE_ENV === 'production' && env.JWT_SECRET === 'dev-secret-cambiar') {
  throw new Error('Falta JWT_SECRET en producción');
}

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
  PORT: Number(process.env.PORT ?? 3200),
  HOST: process.env.HOST ?? '0.0.0.0',
  // En tests SIEMPRE se usa la base de test, nunca la de desarrollo.
  DATABASE_URL: isTest
    ? (process.env.TEST_DATABASE_URL ?? 'postgresql://almacen:almacen@localhost:5432/almacen_test')
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
  /** Servidor de demostración: el login muestra los botones "Probar la demo". */
  SEED_DEMO: process.env.SEED_DEMO === 'true',
  /** Intentos de login por minuto y por IP. */
  AUTH_RATE_LIMIT: Number(process.env.AUTH_RATE_LIMIT) || 10,
  /** Dirección pública de la app (para volver de Mercado Pago y para sus avisos). Ej. https://almacen.onrender.com */
  PUBLIC_URL: (process.env.PUBLIC_URL ?? '').replace(/\/$/, ''),
  /** Aplicación de Mercado Pago del sistema (para "Conectar Mercado Pago"). Sin esto, el dueño puede pegar su Access Token. */
  MP_CLIENT_ID: process.env.MP_CLIENT_ID ?? '',
  MP_CLIENT_SECRET: process.env.MP_CLIENT_SECRET ?? '',
  /** Clave secreta de los webhooks de Mercado Pago (para validar la firma). */
  MP_WEBHOOK_SECRET: process.env.MP_WEBHOOK_SECRET ?? '',
  MP_API_BASE: process.env.MP_API_BASE || 'https://api.mercadopago.com',
  MP_AUTH_BASE: process.env.MP_AUTH_BASE || 'https://auth.mercadopago.com',
  /** ARCA (factura electrónica): se pueden cambiar las direcciones para pruebas. */
  ARCA_WSAA_URL: process.env.ARCA_WSAA_URL ?? '',
  ARCA_WSFE_URL: process.env.ARCA_WSFE_URL ?? '',
  /** Clave para guardar cifradas las credenciales de terceros (Mercado Pago, ARCA). Si falta, se usa JWT_SECRET. */
  SECRETS_KEY: process.env.SECRETS_KEY ?? '',
};

if (env.NODE_ENV === 'production' && env.JWT_SECRET === 'dev-secret-cambiar') {
  throw new Error('Falta JWT_SECRET en producción');
}

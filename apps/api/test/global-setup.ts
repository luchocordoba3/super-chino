import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

// Crea la base de test si no existe y le aplica las migraciones pendientes (no borra nada:
// cada test vacía las tablas con resetDb()).
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://superchino:superchino@localhost:5432/superchino_test';
  const u = new URL(url);
  const dbName = u.pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error('TEST_DATABASE_URL tiene que apuntar a una base *_test');
  u.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: u.toString() });
  const exists = await admin.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
  if (exists.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  await admin.$disconnect();
  execSync('npx prisma migrate deploy', { stdio: 'ignore', env: { ...process.env, DATABASE_URL: url } });
}

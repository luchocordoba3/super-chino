/**
 * Prepara la base de las pruebas de punta a punta (*_e2e): la crea si falta, aplica migraciones,
 * la vacía y carga los datos de demostración.
 */
import { execSync } from 'node:child_process';
import { PrismaClient } from '../src/generated/prisma/index.js';

const url = process.env.E2E_DATABASE_URL ?? 'postgresql://almacen:almacen@localhost:5432/almacen_e2e';
const u = new URL(url);
const dbName = u.pathname.slice(1);
if (!dbName.endsWith('_e2e')) throw new Error('E2E_DATABASE_URL tiene que apuntar a una base *_e2e');
u.pathname = '/postgres';
const admin = new PrismaClient({ datasourceUrl: u.toString() });
if ((await admin.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${dbName}`).length === 0) {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
}
await admin.$disconnect();

const env = { ...process.env, DATABASE_URL: url };
execSync('npx prisma migrate deploy', { stdio: 'ignore', env });
const db = new PrismaClient({ datasourceUrl: url });
const rows = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
await db.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`);
await db.$disconnect();
execSync('npx tsx prisma/seed.ts', { stdio: 'inherit', env });

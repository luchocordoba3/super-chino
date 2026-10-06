/**
 * Arranque en producción (lo usa el Dockerfile):
 * 1. La app usa siempre su propio schema de Postgres ("vidrieria" por defecto), aunque DATABASE_URL no lo diga:
 *    así puede compartir la base con otra app (ej. Super Chino) sin mezclar tablas.
 * 2. Si un intento anterior sin schema dejó una migración fallida en public._prisma_migrations, la borra
 *    (solo las de esta app, por nombre), para no trabar las migraciones de la otra app.
 * 3. Migraciones, demo (SEED_DEMO=true, o base sin vidrierías si SEED_DEMO no está; SEED_DEMO=false la apaga) y servidor.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const root = path.resolve(import.meta.dirname, '..');
const original = process.env.DATABASE_URL;
if (!original) throw new Error('Falta DATABASE_URL');

const url = new URL(original);
const schema = url.searchParams.get('schema') || process.env.DB_SCHEMA || 'vidrieria';
url.searchParams.set('schema', schema);
process.env.DATABASE_URL = url.toString();

if (schema !== 'public') {
  const publicUrl = new URL(original);
  publicUrl.searchParams.set('schema', 'public');
  const names = readdirSync(path.join(root, 'prisma/migrations'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const db = new PrismaClient({ datasourceUrl: publicUrl.toString() });
  try {
    const [{ t }] = await db.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('public._prisma_migrations')::text AS t`;
    if (t) {
      const n = await db.$executeRawUnsafe(
        `DELETE FROM public._prisma_migrations WHERE finished_at IS NULL AND migration_name = ANY($1::text[])`,
        names,
      );
      if (n) console.log(`Se limpiaron ${n} migraciones fallidas de esta app en el schema public`);
    }
  } finally {
    await db.$disconnect();
  }
}

const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: root, stdio: 'inherit', env: process.env });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const seedFlag = (process.env.SEED_DEMO ?? '').trim().toLowerCase();
if (seedFlag !== 'false' && seedFlag !== '0' && seedFlag !== 'no') {
  const { prisma } = await import('../src/db');
  const empty = (await prisma.business.count()) === 0;
  if (['true', '1', 'si', 'sí', 'yes'].includes(seedFlag) || empty) {
    const { seedDemo } = await import('../prisma/seed');
    const r = await seedDemo();
    console.log(r.created ? 'Demo de Cristales Ariel cargada' : 'La demo ya existía');
  }
}

await import('../src/index');

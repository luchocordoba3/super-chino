import { execSync } from 'node:child_process';

/** Base propia para las pruebas: migraciones al día y demo de Cristales Ariel recién cargada. */
export default function setup() {
  const env = { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgresql://vidrieria:vidrieria@localhost:5432/vidrieria_e2e' };
  execSync('npx prisma migrate deploy', { cwd: '../api', stdio: 'inherit', env });
  execSync('npx tsx prisma/seed.ts --reset', { cwd: '../api', stdio: 'inherit', env });
}

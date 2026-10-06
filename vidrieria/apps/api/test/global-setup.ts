import { execSync } from 'node:child_process';

/** Aplica las migraciones a la base de test (nunca toca la de desarrollo). Los tests usan datos únicos por corrida. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://vidrieria:vidrieria@localhost:5432/vidrieria_test';
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
}

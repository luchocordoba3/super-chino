import { execSync } from 'node:child_process';

export default function setup() {
  execSync('pnpm --filter @almacen/api e2e:db', { stdio: 'inherit' });
}

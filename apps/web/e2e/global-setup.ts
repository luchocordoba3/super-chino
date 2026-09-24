import { execSync } from 'node:child_process';

export default function setup() {
  execSync('pnpm --filter @super-chino/api e2e:db', { stdio: 'inherit' });
}

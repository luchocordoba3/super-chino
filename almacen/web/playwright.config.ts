import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const CHROME = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgresql://almacen:almacen@localhost:5432/almacen_e2e';

// La API sirve la web compilada (como en producción) con una base propia para estas pruebas.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3300',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    launchOptions: existsSync(CHROME) ? { executablePath: CHROME } : {},
  },
  webServer: [
    // Mercado Pago de mentira (la API real no se usa en las pruebas).
    { command: 'node e2e/fake-mp.mjs', url: 'http://localhost:3399/health', reuseExistingServer: false, timeout: 30_000 },
    {
      command: 'pnpm --filter @almacen/api start',
      url: 'http://localhost:3300/api/health',
      env: {
        PORT: '3300',
        DATABASE_URL: E2E_DB,
        JOBS_ENABLED: 'false',
        JWT_SECRET: 'e2e-secret',
        ANTHROPIC_API_KEY: '',
        SEED_DEMO: 'true',
        AUTH_RATE_LIMIT: '1000',
        MP_API_BASE: 'http://localhost:3399',
        ARCA_WSAA_URL: 'http://localhost:3399/arca/wsaa',
        ARCA_WSFE_URL: 'http://localhost:3399/arca/wsfe',
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

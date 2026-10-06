import { defineConfig, devices } from '@playwright/test';

const PORT = 3200;
const DB = process.env.E2E_DATABASE_URL ?? 'postgresql://vidrieria:vidrieria@localhost:5432/vidrieria_e2e';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: `http://localhost:${PORT}`, ...devices['Pixel 7'], launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {} },
  webServer: {
    command: 'node --import tsx src/index.ts',
    cwd: '../api',
    port: PORT,
    reuseExistingServer: false,
    env: { PORT: String(PORT), DATABASE_URL: DB, DOLLAR_FETCH: 'false', LEAD_RATE_LIMIT: '1000', AUTH_RATE_LIMIT: '1000' },
  },
});

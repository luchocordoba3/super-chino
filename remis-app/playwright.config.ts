import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const CHROME = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

// Prueba la app compilada (con su service worker), como la usa el chofer.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4174',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    viewport: { width: 390, height: 844 },
    launchOptions: existsSync(CHROME) ? { executablePath: CHROME } : {},
  },
  webServer: {
    command: 'pnpm preview --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

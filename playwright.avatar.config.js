// e2e aparte de la esfinge «al instante» (v0.3.1): puerto propio, un solo navegador, un solo worker.
// Uso: npx playwright test -c playwright.avatar.config.js --workers=1
import { defineConfig } from '@playwright/test';

const PUERTO = 8791;

export default defineConfig({
  testDir: 'tests',
  testMatch: 'avatar-latencia.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 600000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PUERTO}`,
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  },
  webServer: {
    command: 'node tools/servir.js',
    port: PUERTO,
    env: { PUERTO: String(PUERTO) },
    reuseExistingServer: true,
  },
});

// Configuración de Playwright para el e2e de ONE.
// La app se sirve estática (sin build) con tools/servir.js en el puerto 8765.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: 'e2e.spec.js', // así node --test (que busca tests/*.test.js) no lo recoge
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8765',
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  },
  webServer: {
    command: 'node tools/servir.js',
    port: 8765,
    reuseExistingServer: true,
  },
});

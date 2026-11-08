import { defineConfig } from '@playwright/test'

/**
 * Pruebas de extremo a extremo contra:
 *  - la app compilada (dist-e2e) servida en http://localhost:5190
 *  - el emulador de Supabase (PGlite + migración real) en http://127.0.0.1:54399
 * Usa el Chrome instalado en el equipo (channel: 'chrome').
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:5190/',
    channel: 'chrome',
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
    viewport: { width: 1366, height: 860 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node tests/emulator/server.mjs 54399',
      url: 'http://127.0.0.1:54399/__admin/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node scripts/serve-e2e.mjs',
      url: 'http://localhost:5190/',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})

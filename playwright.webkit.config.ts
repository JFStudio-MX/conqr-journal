import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/**
 * Prueba de humo con el motor WebKit de Playwright (aproximación a Safari en macOS/iOS).
 * No sustituye probar en un iPhone o Mac reales.
 */
export default defineConfig({
  ...base,
  use: { ...base.use, channel: undefined, browserName: 'webkit' },
  grep: /crear, editar|borrador se recupera|día anterior|revisión trazable|móvil sin desbordamientos|1–2 ·|6 ·|7 ·|8 ·/,
})

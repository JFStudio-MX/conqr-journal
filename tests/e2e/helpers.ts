import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

export const EMU = 'http://127.0.0.1:54399'
export const PIXEL = { viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' }

declare global {
  interface Window {
    __conqr?: {
      mode: string
      userId?: string
      dbName: string
      syncNow: () => Promise<{ phase: string; pending: number; conflicts: number; lastError?: string }>
      counts: () => Promise<{ pending: number; conflicts: number }>
      importWithFailure: (data: unknown) => Promise<void>
      entryCount: () => Promise<number>
    }
  }
}

let n = 0
export function uniqueEmail(tag: string) {
  return `${tag}-${Date.now().toString(36)}-${++n}@test.local`
}

export async function createUser(email: string, password = 'contraseña-segura-1') {
  const r = await fetch(`${EMU}/__admin/users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
  return { email, password, id: ((await r.json()) as { id: string }).id }
}

export async function login(page: Page, email: string, password = 'contraseña-segura-1') {
  await page.goto('/')
  await page.getByLabel('Correo').fill(email)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.locator('#qc-title')).toBeVisible()
  await waitSynced(page)
}

/** Espera a que el servidor haya confirmado todo (sin forzar recargas). */
export async function waitSynced(page: Page) {
  await expect
    .poll(
      async () => {
        const st = await page.evaluate(async () => (window.__conqr ? await window.__conqr.syncNow() : null))
        return st && st.phase === 'idle' && st.pending === 0
      },
      { timeout: 20_000 },
    )
    .toBe(true)
}

/** Simula volver a la app (el motor sincroniza al recuperar el foco). */
export async function returnToApp(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

export async function addEntry(page: Page, text: string) {
  await page.locator('#qc-text').fill(text)
  await page.getByTestId('quick-save').click()
  await expect(page.locator('#qc-status')).toContainText('Guardado')
}

export async function twoDevices(browser: Browser): Promise<{ phone: Page; desk: Page; phoneCtx: BrowserContext; deskCtx: BrowserContext }> {
  const phoneCtx = await browser.newContext({ ...PIXEL, locale: 'es-MX', timezoneId: 'America/Mexico_City' })
  const deskCtx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'es-MX', timezoneId: 'America/Mexico_City' })
  return { phone: await phoneCtx.newPage(), desk: await deskCtx.newPage(), phoneCtx, deskCtx }
}

export async function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

/** PNG de 2×2 válido para probar capturas. */
export const PNG_2x2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8Dwn4GBgYEBAB0VAv/0w4eMAAAAAElFTkSuQmCC', 'base64')

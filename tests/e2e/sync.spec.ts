/**
 * Pruebas de aceptación multidispositivo con DOS sesiones independientes
 * (un "celular" emulado y un "escritorio"), contra el emulador de Supabase
 * que ejecuta la migración real con RLS.
 */
import { expect, test, type Page } from '@playwright/test'
import { EMU, PNG_2x2, addEntry, createUser, login, returnToApp, twoDevices, uniqueEmail, waitSynced } from './helpers'

const pill = (p: Page) => p.getByTestId('sync-pill').filter({ visible: true })

async function editEntry(page: Page, from: RegExp, to: string) {
  await page.getByRole('button', { name: from }).first().click()
  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  await page.locator('#ed-text').fill(to)
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByText('Guardado en este dispositivo.')).toBeVisible()
  await page.keyboard.press('Escape')
}

test('1–2 · crear en celular → aparece en escritorio; editar en escritorio → llega al celular (sin recargar)', async ({ browser }) => {
  const u = await createUser(uniqueEmail('sync'))
  const { phone, desk } = await twoDevices(browser)
  await login(phone, u.email)
  await login(desk, u.email)

  await addEntry(phone, 'Registro desde el celular')
  await expect(phone.locator('#qc-status')).toContainText('sincronizado', { ignoreCase: true, timeout: 15_000 })
  await returnToApp(desk)
  await expect(desk.getByText('Registro desde el celular')).toBeVisible()

  await editEntry(desk, /Ver registro: Registro desde el celular/, 'Editado en el escritorio')
  await waitSynced(desk)
  await returnToApp(phone)
  await expect(phone.getByText('Editado en el escritorio')).toBeVisible()
  await expect(phone.getByText('Registro desde el celular')).toHaveCount(0)
})

test('3 · registrar sin conexión, cerrar, reabrir sin perderlo y sincronizar después', async ({ browser }) => {
  const u = await createUser(uniqueEmail('offline'))
  const { phone, desk, phoneCtx } = await twoDevices(browser)
  await login(phone, u.email)
  await phone.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await phone.reload()
  await expect(phone.locator('#qc-title')).toBeVisible()
  await expect.poll(() => phone.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

  await phoneCtx.setOffline(true)
  await addEntry(phone, 'Avance sin conexión en el metro')
  await phone.getByTestId('arrived').click()
  await expect(phone.getByText(/Llegada registrada/)).toBeVisible()
  await expect(pill(phone)).toContainText('Pendiente')
  await phone.close()

  const again = await phoneCtx.newPage()
  await again.goto('/') // sin conexión: la interfaz sale del service worker y los datos de IndexedDB
  await expect(again.getByText('Avance sin conexión en el metro')).toBeVisible()
  await expect(again.getByText('sin conexión').first()).toBeVisible()
  await expect(pill(again)).toContainText('Pendiente')

  await phoneCtx.setOffline(false) // el evento "online" dispara la sincronización
  await expect(pill(again)).toContainText('Sincronizado', { timeout: 20_000 })

  await login(desk, u.email)
  await expect(desk.getByText('Avance sin conexión en el metro')).toBeVisible()
  // La llegada conserva hora declarada y hora de recepción del servidor por separado, marcada como sin conexión.
  await desk.getByRole('button', { name: 'Corregir' }).click()
  await expect(desk.getByText(/Hora declarada al pulsar/)).toBeVisible()
  await expect(desk.getByText(/Recibido por el servidor:/)).toBeVisible()
  await expect(desk.getByText('Registrado sin conexión.')).toBeVisible()
})

test('4 · la misma entrada editada en dos dispositivos conserva ambas versiones', async ({ browser }) => {
  const u = await createUser(uniqueEmail('conflict'))
  const { phone, desk, phoneCtx } = await twoDevices(browser)
  await login(desk, u.email)
  await addEntry(desk, 'Texto original de la pieza')
  await waitSynced(desk)
  await login(phone, u.email)
  await expect(phone.getByText('Texto original de la pieza')).toBeVisible()

  await phoneCtx.setOffline(true)
  await editEntry(phone, /Ver registro: Texto original/, 'Versión del celular')
  await editEntry(desk, /Ver registro: Texto original/, 'Versión del escritorio')
  await waitSynced(desk)
  await phoneCtx.setOffline(false)

  await expect(pill(phone)).toContainText(/conflicto/i, { timeout: 20_000 })
  await pill(phone).click()
  await expect(phone.getByRole('heading', { name: 'Conflictos por resolver' })).toBeVisible()
  const dialog = phone.getByRole('dialog')
  await expect(dialog.getByText('Versión del celular')).toBeVisible()
  await expect(dialog.getByText('Versión del escritorio')).toBeVisible()
  await dialog.getByRole('button', { name: 'Conservar ambas' }).click()
  await expect(phone.getByText('Se conservaron ambas versiones')).toBeVisible()
  await phone.keyboard.press('Escape')
  await waitSynced(phone)

  await returnToApp(desk)
  await expect(desk.getByText('Versión del celular')).toBeVisible()
  await expect(desk.getByText('Versión del escritorio')).toBeVisible()
  await expect(phone.getByText('Versión del celular')).toBeVisible()
  await expect(phone.getByText('Versión del escritorio')).toBeVisible()
})

test('5 · una eliminación se sincroniza y el registro no reaparece', async ({ browser }) => {
  const u = await createUser(uniqueEmail('delete'))
  const { phone, desk, phoneCtx } = await twoDevices(browser)
  await login(desk, u.email)
  await addEntry(desk, 'Registro que voy a borrar')
  await waitSynced(desk)
  await login(phone, u.email)
  await expect(phone.getByText('Registro que voy a borrar')).toBeVisible()

  await phoneCtx.setOffline(true) // el celular conserva la copia vieja
  await desk.getByRole('button', { name: 'Acciones del registro' }).first().click()
  await desk.getByRole('menuitem', { name: 'Eliminar' }).click()
  await expect(desk.getByText('Registro eliminado.')).toBeVisible()
  await waitSynced(desk)

  await phoneCtx.setOffline(false)
  await expect(phone.getByText('Registro que voy a borrar')).toHaveCount(0, { timeout: 20_000 })
  await waitSynced(phone)
  await phone.reload()
  await desk.reload()
  await expect(phone.locator('#qc-title')).toBeVisible()
  await expect(phone.getByText('Registro que voy a borrar')).toHaveCount(0)
  await expect(desk.getByText('Registro que voy a borrar')).toHaveCount(0)
})

test('6 · subir una captura en un dispositivo y verla en otro', async ({ browser }) => {
  const u = await createUser(uniqueEmail('files'))
  const { phone, desk } = await twoDevices(browser)
  await login(desk, u.email)
  await login(phone, u.email)
  await desk.locator('#qc-text').fill('Registro con captura de referencia')
  await desk.getByRole('button', { name: 'Agregar detalles' }).click()
  await desk.locator('input[type=file][accept="image/*"]').first().setInputFiles({ name: 'captura.png', mimeType: 'image/png', buffer: PNG_2x2 })
  await expect(desk.getByText('1 nueva(s)')).toBeVisible()
  await desk.getByTestId('quick-save').click()
  await expect(desk.locator('#qc-status')).toContainText('Guardado')
  await waitSynced(desk)

  await returnToApp(phone)
  await phone.getByRole('button', { name: /Ver registro: Registro con captura/ }).click()
  const img = phone.getByRole('button', { name: /Ver captura/ }).locator('img')
  await expect(img).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
})

test('7 · una sesión sin autorización no accede a datos ni archivos', async ({ browser }) => {
  const a = await createUser(uniqueEmail('owner'))
  const b = await createUser(uniqueEmail('intruder'))
  const token = async (email: string, password: string) =>
    ((await (await fetch(`${EMU}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()) as { access_token: string }).access_token
  const ta = await token(a.email, a.password)
  const tb = await token(b.email, b.password)
  const hdr = (t?: string) => ({ apikey: 'sb_publishable_emulator', ...(t ? { authorization: `Bearer ${t}` } : {}), 'content-type': 'application/json' })

  // A guarda un registro y un archivo privado
  const push = await fetch(`${EMU}/rest/v1/rpc/push_changes`, {
    method: 'POST',
    headers: hdr(ta),
    body: JSON.stringify({ changes: [{ collection: 'entries', id: 'secreto-1', base_version: 0, mutation_id: crypto.randomUUID(), data: { text: 'Dato privado de A' }, deleted: false }] }),
  })
  expect(push.ok).toBe(true)
  const up = await fetch(`${EMU}/storage/v1/object/attachments/${a.id}/foto.png`, { method: 'POST', headers: { ...hdr(ta), 'content-type': 'image/png', 'x-upsert': 'true' }, body: PNG_2x2 })
  expect(up.ok).toBe(true)

  // B (otra cuenta) no ve nada de A
  const listB = await (await fetch(`${EMU}/rest/v1/records?select=*&server_seq=gt.0`, { headers: hdr(tb) })).json()
  expect(listB).toEqual([])
  const dl = await fetch(`${EMU}/storage/v1/object/attachments/${a.id}/foto.png`, { headers: hdr(tb) })
  expect(dl.ok).toBe(false)
  const write = await fetch(`${EMU}/storage/v1/object/attachments/${a.id}/intruso.png`, { method: 'POST', headers: { ...hdr(tb), 'content-type': 'image/png' }, body: PNG_2x2 })
  expect(write.ok).toBe(false)

  // Sin sesión: tampoco
  const anon = await fetch(`${EMU}/rest/v1/records?select=*&server_seq=gt.0`, { headers: hdr() })
  expect(anon.status).toBe(401)
  const anonFile = await fetch(`${EMU}/storage/v1/object/attachments/${a.id}/foto.png`, { headers: hdr() })
  expect(anonFile.ok).toBe(false)
  // El dueño sí puede
  expect((await fetch(`${EMU}/storage/v1/object/attachments/${a.id}/foto.png`, { headers: hdr(ta) })).ok).toBe(true)

  // En la interfaz, B no ve los registros de A
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await login(page, b.email, b.password)
  await page.goto('/#/diario')
  await expect(page.getByText('Dato privado de A')).toHaveCount(0)
})

test('8 · fechas y llegadas en America/Mexico_City aunque el dispositivo esté en otra zona', async ({ browser }) => {
  const u = await createUser(uniqueEmail('tz'))
  const ctx = await browser.newContext({ timezoneId: 'Asia/Tokyo', locale: 'es-MX', viewport: { width: 1366, height: 860 } })
  const page = await ctx.newPage()
  // Martes 10 nov 08:29:59 en CDMX = martes 10 nov 23:29:59 en Tokio
  await page.clock.setFixedTime(new Date('2026-11-10T14:29:59Z'))
  await login(page, u.email)
  await expect(page.locator('#qc-date')).toHaveValue('2026-11-10')
  await page.getByTestId('arrived').click()
  await expect(page.getByLabel('Llegada de hoy')).toContainText('8:29 a.m.')
  await expect(page.getByLabel('Llegada de hoy')).toContainText('A tiempo')
  await expect(page.getByLabel('Llegada de hoy')).toContainText('Llegaste temprano')

  // 23:30 del 10 nov en CDMX; en Tokio ya es 11 nov 14:30 → la app sigue en el día 10
  await page.clock.setFixedTime(new Date('2026-11-11T05:30:00Z'))
  await page.reload()
  await expect(page.locator('#qc-date')).toHaveValue('2026-11-10')
  await addEntry(page, 'Registro nocturno')
  await expect(page.getByRole('heading', { name: 'Registros de hoy' })).toBeVisible()
  await expect(page.getByText('Registro nocturno')).toBeVisible()

  // Exactamente 9:30:00 ya es retardo
  await page.clock.setFixedTime(new Date('2026-11-11T15:30:00Z')) // mié 11 nov 09:30:00 CDMX
  await page.reload()
  await expect(page.locator('#qc-date')).toHaveValue('2026-11-11')
  await page.getByTestId('arrived').click()
  await expect(page.getByLabel('Llegada de hoy')).toContainText('Retardo')
})

test('9 · cerrar sesión avisa si hay cambios sin subir y borra la copia local del dispositivo', async ({ browser }) => {
  const u = await createUser(uniqueEmail('logout'))
  const ctx = await browser.newContext({ locale: 'es-MX', timezoneId: 'America/Mexico_City' })
  const page = await ctx.newPage()
  await login(page, u.email)
  const dbName = await page.evaluate(() => window.__conqr!.dbName)
  await ctx.setOffline(true)
  await addEntry(page, 'Pendiente al cerrar sesión')
  await page.evaluate(() => (location.hash = '#/ajustes'))
  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Hay cambios sin sincronizar' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar' }).click()
  await ctx.setOffline(false)
  await waitSynced(page)
  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
  expect(names).not.toContain(dbName)
  expect(await page.evaluate(() => localStorage.getItem('conqr-auth'))).toBeNull()
  // y al volver a entrar, el registro sigue en la cuenta
  await login(page, u.email)
  await expect(page.getByText('Pendiente al cerrar sesión')).toBeVisible()
})

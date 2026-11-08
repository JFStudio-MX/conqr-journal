import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { PIXEL, PNG_2x2, addEntry, createUser, login, noHorizontalOverflow, uniqueEmail, waitSynced } from './helpers'

async function fresh(page: Page, tag: string) {
  const u = await createUser(uniqueEmail(tag))
  await login(page, u.email)
  return u
}
const count = (page: Page) => page.evaluate(() => window.__conqr!.entryCount())

test('crear, editar y recuperar después de recargar; Ctrl+Enter; doble clic sin duplicados', async ({ page }) => {
  await fresh(page, 'crud')
  const before = await count(page) // 2 borradores precargados "Por confirmar"
  expect(before).toBe(2)
  await addEntry(page, 'Primer registro real')
  await page.locator('#qc-text').fill('Guardado con atajo')
  await page.locator('#qc-text').press('Control+Enter')
  await expect(page.getByText('Guardado con atajo')).toBeVisible()
  await page.locator('#qc-text').fill('Doble clic')
  await page.getByTestId('quick-save').dblclick()
  await page.getByTestId('quick-save').click()
  await expect(page.getByText('Doble clic')).toHaveCount(1)
  expect(await count(page)).toBe(before + 3)

  await page.getByRole('button', { name: /Ver registro: Primer registro real/ }).click()
  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  await page.locator('#ed-text').fill('Primer registro real (editado)')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByText('Primer registro real (editado)')).toBeVisible()
  expect(await count(page)).toBe(before + 3)
})

test('el borrador se recupera tras recargar', async ({ page }) => {
  await fresh(page, 'draft')
  await page.locator('#qc-text').fill('Texto a medias que no quiero perder')
  await page.getByRole('button', { name: 'Entrega' }).click()
  await page.waitForTimeout(700)
  await page.reload()
  await expect(page.locator('#qc-text')).toHaveValue('Texto a medias que no quiero perder')
  await expect(page.getByRole('button', { name: 'Entrega' })).toHaveAttribute('aria-pressed', 'true')
})

test('guardar un día anterior sin desplazamiento de zona horaria', async ({ browser }) => {
  const ctx = await browser.newContext({ timezoneId: 'America/Los_Angeles', locale: 'es-MX' })
  const page = await ctx.newPage()
  await fresh(page, 'past')
  await page.locator('#qc-date').fill('2026-11-05')
  await expect(page.locator('#qc-title')).toContainText('el jueves 5')
  await addEntry(page, 'Reconstruido: mi primer día')
  await page.goto('/#/diario')
  const group = page.locator('section', { has: page.getByText('Reconstruido: mi primer día') })
  await expect(group.getByRole('heading')).toContainText('Jueves, 5 de noviembre')
})

test('filtros y búsqueda en el diario', async ({ page }) => {
  await fresh(page, 'filter')
  await page.locator('#qc-text').fill('Animación del logo de ECCO')
  await page.getByRole('button', { name: 'Avance' }).click()
  await page.getByTestId('quick-save').click()
  await expect(page.locator('#qc-status')).toContainText('Guardado')
  await page.locator('#qc-text').fill('Aprendí a usar referencias de estilo')
  await page.getByRole('button', { name: 'Aprendizaje' }).click()
  await page.getByTestId('quick-save').click()
  await expect(page.locator('#qc-status')).toContainText('Guardado')
  await page.goto('/#/diario')
  await page.getByLabel('Buscar en el diario').fill('animacion') // sin acento
  await expect(page.getByText('Animación del logo de ECCO')).toBeVisible()
  await expect(page.getByText('Aprendí a usar referencias')).toHaveCount(0)
  await page.getByRole('button', { name: 'Limpiar filtros' }).click()
  await page.getByLabel('Categoría').selectOption('aprendizaje')
  await expect(page.getByText('Aprendí a usar referencias')).toBeVisible()
  await expect(page.getByText('Animación del logo de ECCO')).toHaveCount(0)
  await page.getByLabel('Categoría').selectOption('')
  await page.getByRole('button', { name: 'Por confirmar' }).click()
  await expect(page.getByText('Ingreso a Conqr')).toBeVisible()
  await expect(page.getByText('1 registro', { exact: false }).first()).toBeVisible()
})

test('gráficas con datos conocidos; borradores y demo excluidos de las métricas', async ({ page }) => {
  await fresh(page, 'charts')
  for (const [text, cat] of [
    ['Entregué banners', 'Entrega'],
    ['Avance de video', 'Avance'],
    ['Logro y entrega a la vez', 'Logro'],
  ] as const) {
    await page.locator('#qc-text').fill(text)
    await page.getByRole('button', { name: cat }).click()
    if (text.startsWith('Logro')) await page.getByRole('button', { name: 'Entrega' }).click()
    await page.getByTestId('quick-save').click()
    await expect(page.locator('#qc-status')).toContainText('Guardado')
  }
  // Abrir y salir del demo no debe tocar estos datos
  await page.goto('/#/ajustes')
  await page.getByRole('button', { name: 'Abrir modo demo' }).click()
  await expect(page.getByText('Modo demo:')).toBeVisible()
  await page.getByRole('button', { name: 'Salir del demo' }).first().click()
  await expect(page.locator('#qc-title')).toBeVisible()

  await page.goto('/#/progreso')
  // 3 confirmados; los 2 borradores "Por confirmar" no cuentan
  await expect(page.getByText('En este periodo:')).toContainText('3 registros')
  await expect(page.getByText('En este periodo:')).toContainText('2 registros con categoría Entrega')
  await page.getByRole('button', { name: 'Ver tabla' }).click()
  const row = page.locator('tbody tr').last()
  await expect(row.locator('td').last()).toHaveText('3')
  // "Logro y entrega" cuenta una sola vez, como Entrega (prioridad)
  await expect(page.locator('thead')).toContainText('Entrega')
  const headers = await page.locator('thead th').allTextContents()
  const iEntrega = headers.indexOf('Entrega')
  await expect(row.locator('th, td').nth(iEntrega)).toHaveText('2')
})

test('respaldo completo con captura: exportar, borrar y restaurar', async ({ page }) => {
  await fresh(page, 'backup')
  await page.locator('#qc-text').fill('Registro con evidencia visual')
  await page.getByRole('button', { name: 'Agregar detalles' }).click()
  await page.locator('input[type=file][accept="image/*"]').first().setInputFiles({ name: 'captura.png', mimeType: 'image/png', buffer: PNG_2x2 })
  await expect(page.getByText('1 nueva(s)')).toBeVisible()
  await page.getByTestId('quick-save').click()
  await expect(page.locator('#qc-status')).toContainText('Guardado')
  await waitSynced(page)

  await page.goto('/#/ajustes')
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar respaldo completo' }).click()
  const file = await (await dl).path()
  const json = JSON.parse(readFileSync(file, 'utf8'))
  expect(json.format).toBe('conqr-journal-backup')
  expect(json.data.files).toHaveLength(1)
  expect(json.data.files[0].base64.length).toBeGreaterThan(10)
  await expect(page.getByText(/Último respaldo descargado en este dispositivo:/)).not.toContainText('nunca')

  // borrar el registro y restaurar desde el archivo
  await page.goto('/#/hoy')
  await page.getByRole('button', { name: 'Acciones del registro' }).first().click()
  await page.getByRole('menuitem', { name: 'Eliminar' }).click()
  await expect(page.getByText('Registro con evidencia visual')).toHaveCount(0)
  await waitSynced(page)
  await page.goto('/#/ajustes')
  await page.getByTestId('import-input').setInputFiles(file)
  await expect(page.getByRole('heading', { name: 'Vista previa de la importación' })).toBeVisible()
  await page.getByTestId('import-confirm').click()
  await expect(page.getByText(/Importación completa/)).toBeVisible()
  await page.goto('/#/hoy')
  await page.getByRole('button', { name: /Ver registro: Registro con evidencia visual/ }).click()
  const img = page.getByRole('button', { name: /Ver captura/ }).locator('img')
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
})

test('un respaldo inválido o una importación que falla no alteran los datos', async ({ page }) => {
  await fresh(page, 'invalid')
  await addEntry(page, 'Dato que debe sobrevivir')
  const before = await count(page)
  await page.goto('/#/ajustes')
  await page.getByTestId('import-input').setInputFiles({ name: 'malo.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"conqr-journal-backup","version":1,"data":{"entries":"no es lista"}}') })
  await expect(page.getByTestId('import-errors')).toBeVisible()
  await page.getByRole('button', { name: 'Entendido' }).click()
  await page.getByTestId('import-input').setInputFiles({ name: 'roto.json', mimeType: 'application/json', buffer: Buffer.from('esto no es json') })
  await expect(page.getByTestId('import-errors')).toContainText('JSON válido')
  await page.getByRole('button', { name: 'Entendido' }).click()
  expect(await count(page)).toBe(before)

  // Fallo a mitad de una restauración "reemplazar todo": la transacción se revierte completa
  const empty = { settings: [], brands: [], projects: [], entries: [], attachments: [], goals: [], reflections: [], reviews: [], attendance: [], meetings: [], transcripts: [], actions: [], changes: [], files: [] }
  const err = await page.evaluate(async (data) => {
    try {
      await window.__conqr!.importWithFailure(data)
      return 'sin error'
    } catch (e) {
      return String(e)
    }
  }, empty)
  expect(err).toContain('Fallo simulado')
  expect(await count(page)).toBe(before)
  await page.goto('/#/hoy')
  await expect(page.getByText('Dato que debe sobrevivir')).toBeVisible()
})

test('revisión trazable, exportación Markdown e impresión legible', async ({ page }) => {
  await fresh(page, 'review')
  await page.locator('#qc-text').fill('Entregué la demo de RCO a mi jefa')
  await page.getByRole('button', { name: 'Entrega' }).click()
  await page.getByRole('button', { name: 'Agregar detalles' }).click()
  await page.getByLabel('Mi contribución específica').fill('Diseñé y programé el flujo de foto')
  await page.getByLabel('Lo que me dijeron (cita textual)').fill('Está increíble')
  await page.getByLabel('Mi interpretación').fill('Le gustó la idea')
  await page.getByTestId('quick-save').click()
  await expect(page.locator('#qc-status')).toContainText('Guardado')

  await page.goto('/#/revision')
  await page.getByRole('button', { name: 'Generar borrador' }).click()
  await expect(page.getByText(/Borrador generado con 1 registro/)).toBeVisible()
  await expect(page.locator('textarea').filter({ hasText: 'Diseñé y programé el flujo de foto' })).toBeVisible()
  await expect(page.locator('textarea').filter({ hasText: '«Está increíble»' })).toContainText('Mi interpretación: Le gustó la idea')
  await page.getByRole('button', { name: /Fuentes \(1\)/ }).first().click()
  await expect(page.getByRole('dialog').getByText('Entregué la demo de RCO a mi jefa')).toBeVisible()
  await page.keyboard.press('Escape')

  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar Markdown' }).click()
  const md = readFileSync(await (await dl).path(), 'utf8')
  expect(md).toContain('## Mi contribución concreta')
  expect(md).toContain('Fuentes:')
  expect(md).not.toMatch(/Sueldo|Compensación/) // privado excluido por defecto
  expect(md).not.toContain('Puntualidad')

  await page.getByRole('button', { name: 'Vista de impresión' }).click()
  await expect(page.getByRole('dialog', { name: 'Vista de impresión' })).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.print-root')).toBeVisible()
  await expect(page.locator('.print-root')).toContainText('Mi contribución concreta')
  const hiddenNav = await page.locator('.bottom-nav').first().evaluate((el) => getComputedStyle(el).display)
  expect(hiddenNav).toBe('none')
  await page.emulateMedia({ media: 'screen' })
})

test('móvil sin desbordamientos y estados vacíos honestos', async ({ browser }) => {
  const ctx = await browser.newContext({ ...PIXEL, locale: 'es-MX', timezoneId: 'America/Mexico_City' })
  const page = await ctx.newPage()
  await fresh(page, 'mobile')
  for (const r of ['hoy', 'diario', 'diario?tab=juntas', 'diario?tab=proyectos', 'progreso', 'revision', 'ajustes']) {
    await page.goto(`/#/${r}`)
    await page.waitForTimeout(250)
    expect(await noHorizontalOverflow(page), r).toBeLessThanOrEqual(0)
  }
  await page.goto('/#/progreso')
  await expect(page.getByText('Aún no hay registros confirmados en este periodo.')).toBeVisible()
  await expect(page.getByText('Sin registros en este periodo').first()).toBeVisible()
  // la barra inferior está, y los botones principales tienen tamaño táctil
  await page.goto('/#/hoy')
  const box = await page.getByTestId('quick-save').boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)
})

test('error de almacenamiento: no hay falso “Guardado” y el texto se conserva', async ({ page }) => {
  await fresh(page, 'quota')
  await page.evaluate(() => {
    const orig = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'entries') throw new DOMException('Simulado', 'QuotaExceededError')
      return orig.apply(this, args)
    }
  })
  await page.locator('#qc-text').fill('Esto no cabe')
  await page.getByTestId('quick-save').click()
  await expect(page.locator('#qc-status')).toContainText('No hay espacio suficiente')
  await expect(page.locator('#qc-status')).not.toContainText('Guardado en')
  await expect(page.locator('#qc-text')).toHaveValue('Esto no cabe')
})

import { expect, test } from '@playwright/test'
import { createUser, login, uniqueEmail, waitSynced } from './helpers'

const SUMMARY = `Objetivo
Revisar la versión 2 del video para RCO

Decisiones
- Se mantiene la paleta coral

Próximos pasos
- Ajustar el cierre del video (Responsable: Ana) para el 20/11
- Mandar storyboard actualizado

Preguntas pendientes
- ¿Quién aprueba el copy final?
`

const VTT = `WEBVTT

00:00:02.000 --> 00:00:05.000
<v Cliente>Cambio: quitar el logo del segundo 12.</v>
`

test('juntas: captura rápida, propuestas por revisar sin duplicar, pendientes en Hoy y en el proyecto, cierre y minuta', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'es-MX', timezoneId: 'America/Mexico_City', viewport: { width: 1366, height: 900 } })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:5190' })
  const page = await ctx.newPage()
  const u = await createUser(uniqueEmail('meet'))
  await login(page, u.email)

  // Captura rápida: solo título y fecha son obligatorios
  await page.getByTestId('new-meeting').click()
  const top = () => page.getByRole('dialog').last()
  await top().getByLabel('Título').fill('Revisión de video con cliente')
  await top().getByLabel('Proyecto').selectOption({ label: 'RCO' })
  await page.getByRole('button', { name: 'Crear junta' }).click()
  const sheet = page.getByRole('dialog').first()
  await expect(sheet.getByRole('heading', { name: 'Mis notas' })).toBeVisible()
  await sheet.getByRole('textbox', { name: 'Mis notas' }).fill('Mi nota: el cliente se veía contento')

  // Pegar resumen → propuestas "por revisar"
  await sheet.getByRole('button', { name: 'Pegar texto' }).click()
  await top().getByLabel('Texto', { exact: true }).fill(SUMMARY)
  await top().getByRole('button', { name: 'Guardar texto' }).click()
  await expect(page.getByText(/5 propuestas nuevas por revisar/)).toBeVisible()
  // Importar el mismo texto otra vez no duplica nada
  await sheet.getByRole('button', { name: 'Pegar texto' }).click()
  await top().getByLabel('Texto', { exact: true }).fill(SUMMARY)
  await top().getByRole('button', { name: 'Guardar texto' }).click()
  await expect(page.getByText('Ese texto ya estaba en esta junta; no se duplicó.')).toBeVisible()
  await expect(page.getByText(/0 propuestas nuevas por revisar · 5 ya existían/)).toBeVisible()
  await expect(sheet.locator('li', { hasText: 'Ajustar el cierre del video' })).toHaveCount(1)

  // Nada se asigna por defecto; el responsable detectado es Ana, no Joshua
  const action = sheet.locator('li', { hasText: 'Ajustar el cierre del video' })
  await expect(action).toContainText('Ana')
  await expect(action).toContainText('Por revisar')
  await expect(sheet.locator('li', { hasText: 'Mandar storyboard' })).toContainText('Responsable por definir')

  // Confirmar la decisión y la segunda acción; marcar la acción como mía con fecha
  await sheet.locator('li', { hasText: 'Se mantiene la paleta coral' }).getByRole('button', { name: 'Confirmar' }).click()
  const story = sheet.locator('li', { hasText: 'Mandar storyboard' })
  await story.getByRole('button', { name: 'Corregir' }).click()
  await top().getByText('Es una tarea mía').click()
  await top().getByLabel(/^Fecha/).fill('2026-11-09')
  await top().getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(sheet.locator('li', { hasText: 'Mandar storyboard' })).toContainText('Mía')

  // Importar VTT: el cambio llega por revisar con su marca de tiempo
  await sheet.locator('input[type=file][accept*=".vtt"]').setInputFiles({ name: 'junta.vtt', mimeType: 'text/vtt', buffer: Buffer.from(VTT) })
  await expect(page.getByText(/1 propuesta nueva por revisar/)).toBeVisible()
  const change = sheet.locator('article', { hasText: 'quitar el logo del segundo 12' })
  await expect(change).toContainText('Por revisar')
  await expect(change).toContainText('[00:00:02]')
  await expect(change).toContainText('Sin fecha acordada')

  // Cambio manual que sustituye al anterior: ambos se conservan
  await change.getByRole('button', { name: /Editar cambio/ }).click()
  await top().getByRole('button', { name: 'Confirmar y guardar' }).click()
  await sheet.getByRole('button', { name: 'Agregar cambio' }).click()
  await top().getByLabel('Qué se pidió').fill('Mantener el logo pero más pequeño')
  await top().getByLabel('Fecha que pidió el cliente').fill('2026-11-18')
  await top().getByLabel('Sustituye a un cambio anterior').selectOption({ index: 1 })
  await top().getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(sheet.locator('article').filter({ hasText: 'quitar el logo' }).filter({ hasNotText: 'Mantener' })).toContainText('Sustituido por un cambio posterior')
  const newer = sheet.locator('article', { hasText: 'Mantener el logo pero más pequeño' })
  await expect(newer).toContainText('Sin fecha acordada')
  await expect(newer).toContainText('El cliente pidió el 18 nov')

  // Cierre con revisión breve y minuta para copiar (no se envía)
  await sheet.getByRole('button', { name: 'Revisar y cerrar junta' }).click()
  await expect(top().getByLabel('¿Qué se aprobó?')).toHaveValue(/Se mantiene la paleta coral/)
  await expect(top().getByLabel('¿Quién hace qué?')).toHaveValue(/Mandar storyboard/)
  await top().getByRole('button', { name: 'Cerrar junta' }).click()
  await expect(sheet.getByText(/^Cerrada/)).toBeVisible()
  await sheet.getByRole('button', { name: 'Generar minuta' }).click()
  await expect(sheet.getByRole('textbox', { name: 'Minuta', exact: true })).toHaveValue(/Minuta — Revisión de video con cliente/)
  await expect(sheet.getByRole('textbox', { name: 'Minuta', exact: true })).not.toHaveValue(/Ajustar el cierre/) // sigue por revisar: no entra
  await sheet.getByRole('button', { name: 'Copiar minuta' }).click()
  await expect(page.getByText('Minuta copiada. No se envió a nadie.')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Decisiones confirmadas')

  // Eliminar el texto original conservando notas, lo revisado y lo que yo elija
  await sheet.getByRole('button', { name: 'Eliminar texto original' }).click()
  const del = page.getByRole('dialog', { name: 'Eliminar texto original' })
  await del.locator('label', { hasText: '¿Quién aprueba el copy final?' }).click()
  await del.getByRole('button', { name: 'Eliminar texto original' }).click()
  await expect(page.getByText(/Texto original eliminado/)).toBeVisible()
  await expect(sheet.getByText('Sin texto original.', { exact: false })).toBeVisible()
  await expect(sheet.getByRole('textbox', { name: 'Mis notas' })).toHaveValue('Mi nota: el cliente se veía contento')
  await expect(sheet.locator('li', { hasText: 'Se mantiene la paleta coral' })).toHaveCount(1)
  await expect(sheet.locator('li', { hasText: '¿Quién aprueba el copy final?' })).toHaveCount(1)
  await expect(sheet.locator('li', { hasText: 'Ajustar el cierre del video' })).toHaveCount(0) // propuesta no elegida: descartada
  await page.keyboard.press('Escape')
  await waitSynced(page)

  // El pendiente confirmado y mío aparece en Hoy y en el proyecto
  await page.goto('/#/hoy')
  await expect(page.getByRole('heading', { name: 'Mis pendientes' })).toBeVisible()
  await expect(page.locator('section', { hasText: 'Mis pendientes' })).toContainText('Mandar storyboard')
  await page.goto('/#/diario?tab=proyectos')
  await page.getByRole('button', { name: /RCO/ }).first().click()
  await expect(page.getByRole('dialog').locator('section', { hasText: 'Pendientes confirmados' })).toContainText('Mandar storyboard')
  await expect(page.getByRole('dialog').getByText('Mantener el logo pero más pequeño')).toBeVisible()
})

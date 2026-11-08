// Genera los íconos PNG de la PWA a partir de public/icons/icon.svg usando Chrome (Playwright).
// Uso: node scripts/gen-icons.mjs
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const svg = readFileSync('public/icons/icon.svg', 'utf8')
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage()
const render = async (size, file, { pad = 0, bg = 'transparent' } = {}) => {
  await page.setViewportSize({ width: size, height: size })
  const inner = size - pad * 2
  await page.setContent(
    `<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">` +
      `<div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  )
  await page.screenshot({ path: `public/icons/${file}`, omitBackground: bg === 'transparent' })
}
await render(192, 'icon-192.png')
await render(512, 'icon-512.png')
await render(180, 'apple-touch-icon.png', { bg: '#202124' })
// "maskable": zona segura con margen y fondo completo
await render(512, 'icon-maskable-512.png', { pad: 56, bg: '#202124' })
await browser.close()
console.log('Íconos generados en public/icons/')

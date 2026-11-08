/** Utilidades de texto: búsqueda sin acentos, habilidades, enlaces seguros. */

export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export function cleanSkill(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 60)
}

export function skillKey(s: string): string {
  return fold(cleanSkill(s))
}

export function excerpt(text: string, max = 140): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[.,;:]$/, '') + '…'
}

/**
 * Normaliza un enlace de evidencia. Solo acepta http(s); todo lo demás
 * (javascript:, data:, file:…) se rechaza para evitar inyecciones.
 */
export function safeUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  const withProto = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  try {
    const u = new URL(withProto)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null
    return u.toString()
  } catch {
    return null
  }
}

export function displayUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname === '/' ? '' : u.pathname
    return excerpt(u.hostname.replace(/^www\./, '') + path, 48)
  } catch {
    return url
  }
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('es-MX')} ${n === 1 ? one : many}`
}

export function parseMoney(s: string): number | undefined {
  const t = s.replace(/[^\d.]/g, '')
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export function formatMoney(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return ''
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 })
}

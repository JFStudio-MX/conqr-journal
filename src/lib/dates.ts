/**
 * Fechas sin sorpresas de zona horaria.
 *
 * - Las fechas del diario se guardan como texto 'YYYY-MM-DD' (fecha civil, sin hora).
 * - "Hoy" y la hora de llegada se calculan SIEMPRE en America/Mexico_City,
 *   sin importar la zona horaria configurada en el dispositivo.
 * - La aritmética de fechas usa UTC puro, así no hay saltos por horario de verano.
 */
export const APP_TZ = 'America/Mexico_City'
export const APP_LOCALE = 'es-MX'

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function partsFormatter(tz: string) {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    fmtCache.set(tz, f)
  }
  return f
}

export function zonedParts(instant: Date = new Date(), tz = APP_TZ) {
  const parts = partsFormatter(tz).formatToParts(instant)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  let hour = get('hour')
  if (hour === 24) hour = 0
  return { year: get('year'), month: get('month'), day: get('day'), hour, minute: get('minute'), second: get('second') }
}

/** Fecha civil de hoy en Ciudad de México. */
export function todayISO(now: Date = new Date(), tz = APP_TZ): string {
  const p = zonedParts(now, tz)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Hora actual en Ciudad de México, 'HH:MM:SS' (24 h). */
export function nowTimeHMS(now: Date = new Date(), tz = APP_TZ): string {
  const p = zonedParts(now, tz)
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
}

export function isISODate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function toUTC(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
function fromUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addDays(s: string, n: number): string {
  const d = toUTC(s)
  d.setUTCDate(d.getUTCDate() + n)
  return fromUTC(d)
}

/** Suma meses respetando el fin de mes (31 ene + 1 mes = 28/29 feb). */
export function addMonths(s: string, n: number): string {
  const [y, m, d] = s.split('-').map(Number)
  const total = m - 1 + n
  const ny = y + Math.floor(total / 12)
  const nm = ((total % 12) + 12) % 12
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  return `${ny}-${pad(nm + 1)}-${pad(Math.min(d, last))}`
}

/** a − b en días. */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(a).getTime() - toUTC(b).getTime()) / 86_400_000)
}

/** Lunes = 1 … domingo = 7. */
export function isoWeekday(s: string): number {
  const w = toUTC(s).getUTCDay()
  return w === 0 ? 7 : w
}

/** Inicio de semana (lunes). */
export function startOfWeek(s: string): string {
  return addDays(s, 1 - isoWeekday(s))
}

export function startOfMonth(s: string): string {
  return s.slice(0, 8) + '01'
}

export function endOfMonth(s: string): string {
  const [y, m] = s.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${pad(m)}-${pad(last)}`
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  if (from > to) return out
  let d = from
  while (d <= to) {
    out.push(d)
    d = addDays(d, 1)
  }
  return out
}

export function eachWeek(from: string, to: string): string[] {
  const out: string[] = []
  let w = startOfWeek(from)
  const end = startOfWeek(to)
  while (w <= end) {
    out.push(w)
    w = addDays(w, 7)
  }
  return out
}

export function minDate(a: string, b: string) {
  return a < b ? a : b
}
export function maxDate(a: string, b: string) {
  return a > b ? a : b
}

type DateStyle = 'full' | 'long' | 'medium' | 'short' | 'dayMonth' | 'weekdayShort' | 'weekday' | 'monthYear' | 'month' | 'weekdayDay'

const OPTS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  full: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  short: { weekday: 'short', day: 'numeric', month: 'short' },
  dayMonth: { day: 'numeric', month: 'short' },
  weekdayShort: { weekday: 'short' },
  weekday: { weekday: 'long' },
  monthYear: { month: 'long', year: 'numeric' },
  month: { month: 'short' },
  weekdayDay: { weekday: 'long', day: 'numeric', month: 'long' },
}
const dateFmtCache = new Map<DateStyle, Intl.DateTimeFormat>()

/** Formatea una fecha civil 'YYYY-MM-DD' sin desplazamientos (se interpreta en UTC). */
export function formatDate(s: string, style: DateStyle = 'medium'): string {
  if (!isISODate(s)) return s
  let f = dateFmtCache.get(style)
  if (!f) {
    f = new Intl.DateTimeFormat(APP_LOCALE, { ...OPTS[style], timeZone: 'UTC' })
    dateFmtCache.set(style, f)
  }
  return f.format(toUTC(s)).replace(/\.$/, '')
}

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** 'Hoy', 'Ayer' o la fecha con día de la semana. */
export function relativeDay(s: string, today: string): string {
  const d = diffDays(today, s)
  if (d === 0) return 'Hoy'
  if (d === 1) return 'Ayer'
  if (d === -1) return 'Mañana'
  return capitalize(formatDate(s, s.slice(0, 4) === today.slice(0, 4) ? 'weekdayDay' : 'full'))
}

/** 'HH:MM' o 'HH:MM:SS' → 'HH:MM:SS'. Devuelve null si no es válida. */
export function normalizeTime(t: unknown): string | null {
  if (typeof t !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t.trim())
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  const se = Number(m[3] ?? 0)
  if (h > 23 || mi > 59 || se > 59) return null
  return `${pad(h)}:${pad(mi)}:${pad(se)}`
}

/** Hora legible: '8:47 a.m.' (los segundos se omiten). */
export function formatTime(hms: string): string {
  const n = normalizeTime(hms)
  if (!n) return hms
  const [h, m] = n.split(':').map(Number)
  const suffix = h < 12 ? 'a.m.' : 'p.m.'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${pad(m)} ${suffix}`
}

/** Instante ISO → fecha y hora en Ciudad de México, legible. */
export function formatInstant(iso: string | undefined, tz = APP_TZ): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = zonedParts(d, tz)
  const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`
  return `${formatDate(date, 'dayMonth')}, ${formatTime(`${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`)}`
}

/** Instante ISO → 'HH:MM:SS' en Ciudad de México. */
export function instantToTime(iso: string, tz = APP_TZ): string {
  const p = zonedParts(new Date(iso), tz)
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
}

export function formatMinutes(min: number): string {
  if (!Number.isFinite(min)) return ''
  const sign = min < 0 ? '−' : ''
  const a = Math.abs(Math.round(min))
  const h = Math.floor(a / 60)
  const m = a % 60
  if (h && m) return `${sign}${h} h ${m} min`
  if (h) return `${sign}${h} h`
  return `${sign}${m} min`
}

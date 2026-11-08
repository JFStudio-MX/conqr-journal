/**
 * Métricas honestas.
 * - Un registro no equivale a una entrega ni a un proyecto terminado.
 * - Los borradores "Por confirmar" se excluyen siempre.
 * - Cada registro cuenta UNA sola vez en cada total.
 * - Las semanas sin registros no significan semanas sin trabajo.
 */
import type { Brand, CategoryId, Entry, Project, TimeSaving } from '../db/types'
import { PRIMARY_PRIORITY } from './constants'
import { addDays, eachWeek, startOfWeek } from './dates'
import { cleanSkill, skillKey } from './text'

export type CatKey = CategoryId | 'sin'

export function countable(entries: Entry[]): Entry[] {
  return entries.filter((e) => !e.pending)
}

export function primaryCategory(e: Entry): CatKey {
  for (const c of PRIMARY_PRIORITY) if (e.categories.includes(c)) return c
  return 'sin'
}

const blankCats = (): Record<CatKey, number> => ({
  entrega: 0,
  avance: 0,
  aprendizaje: 0,
  logro: 0,
  feedback: 0,
  bloqueo: 0,
  sin: 0,
})

export interface WeekBucket {
  weekStart: string
  weekEnd: string
  total: number
  days: number
  byCat: Record<CatKey, number>
  entryIds: string[]
}

export function inRange(e: { date: string }, from: string, to: string) {
  return e.date >= from && e.date <= to
}

export function weeklyActivity(entries: Entry[], from: string, to: string): WeekBucket[] {
  const weeks = eachWeek(from, to)
  const map = new Map<string, WeekBucket & { daySet: Set<string> }>()
  for (const w of weeks) {
    map.set(w, { weekStart: w, weekEnd: addDays(w, 6), total: 0, days: 0, byCat: blankCats(), entryIds: [], daySet: new Set() })
  }
  for (const e of countable(entries)) {
    if (!inRange(e, from, to)) continue
    const b = map.get(startOfWeek(e.date))
    if (!b) continue
    b.total += 1
    b.byCat[primaryCategory(e)] += 1
    b.entryIds.push(e.id)
    b.daySet.add(e.date)
  }
  return weeks.map((w) => {
    const { daySet, ...rest } = map.get(w)!
    return { ...rest, days: daySet.size }
  })
}

export interface DistributionRow {
  key: string
  label: string
  count: number
  entryIds: string[]
  kind: 'item' | 'none' | 'unconfirmed'
}

export function distribution(
  entries: Entry[],
  projects: Project[],
  brands: Brand[],
  by: 'project' | 'brand',
  from: string,
  to: string,
): DistributionRow[] {
  const pById = new Map(projects.map((p) => [p.id, p]))
  const bById = new Map(brands.map((b) => [b.id, b]))
  const rows = new Map<string, DistributionRow>()
  const add = (key: string, label: string, kind: DistributionRow['kind'], id: string) => {
    const r = rows.get(key) ?? { key, label, count: 0, entryIds: [], kind }
    r.count += 1
    r.entryIds.push(id)
    rows.set(key, r)
  }
  for (const e of countable(entries)) {
    if (!inRange(e, from, to)) continue
    if (by === 'project') {
      const p = e.projectId ? pById.get(e.projectId) : undefined
      if (p) add(p.id, p.name, 'item', e.id)
      else add('__none', 'Sin proyecto', 'none', e.id)
    } else {
      const p = e.projectId ? pById.get(e.projectId) : undefined
      const brandId = e.brandId ?? (p && !p.brandUnconfirmed ? p.brandId : undefined)
      const b = brandId ? bById.get(brandId) : undefined
      if (b) add(b.id, b.name, 'item', e.id)
      else if (p?.brandUnconfirmed) add('__unconfirmed', 'Marca por confirmar', 'unconfirmed', e.id)
      else add('__none', 'Sin marca', 'none', e.id)
    }
  }
  return [...rows.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'item' ? -1 : b.kind === 'item' ? 1 : 0
    return b.count - a.count || a.label.localeCompare(b.label, 'es')
  })
}

export interface SkillRow {
  key: string
  label: string
  total: number
  first: string
  last: string
  /** weekStart → ids de registros */
  weeks: Record<string, string[]>
  entryIds: string[]
}

export function skillsOverTime(entries: Entry[], from: string, to: string): SkillRow[] {
  const rows = new Map<string, SkillRow>()
  const sorted = countable(entries)
    .filter((e) => inRange(e, from, to))
    .sort((a, b) => a.date.localeCompare(b.date))
  for (const e of sorted) {
    const seen = new Set<string>()
    for (const raw of e.skills) {
      const label = cleanSkill(raw)
      const key = skillKey(label)
      if (!key || seen.has(key)) continue
      seen.add(key)
      const r = rows.get(key) ?? { key, label, total: 0, first: e.date, last: e.date, weeks: {}, entryIds: [] }
      r.total += 1
      r.last = e.date
      const w = startOfWeek(e.date)
      ;(r.weeks[w] ??= []).push(e.id)
      r.entryIds.push(e.id)
      rows.set(key, r)
    }
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'es'))
}

export function allSkills(entries: Entry[]): string[] {
  const m = new Map<string, string>()
  for (const e of entries) for (const s of e.skills) {
    const k = skillKey(s)
    if (k && !m.has(k)) m.set(k, cleanSkill(s))
  }
  return [...m.values()].sort((a, b) => a.localeCompare(b, 'es'))
}

export interface PeriodSummary {
  total: number
  days: number
  projects: number
  brands: number
  evidence: number
  withDelivery: number
  entryIds: string[]
}

export function periodSummary(entries: Entry[], projects: Project[], from: string, to: string): PeriodSummary {
  const pById = new Map(projects.map((p) => [p.id, p]))
  const list = countable(entries).filter((e) => inRange(e, from, to))
  const days = new Set(list.map((e) => e.date))
  const proj = new Set(list.map((e) => e.projectId).filter(Boolean))
  const brands = new Set(
    list
      .map((e) => e.brandId ?? (e.projectId && !pById.get(e.projectId)?.brandUnconfirmed ? pById.get(e.projectId)?.brandId : undefined))
      .filter(Boolean),
  )
  return {
    total: list.length,
    days: days.size,
    projects: proj.size,
    brands: brands.size,
    evidence: list.filter((e) => e.evidence).length,
    withDelivery: list.filter((e) => e.categories.includes('entrega')).length,
    entryIds: list.map((e) => e.id),
  }
}

export type LowDataLevel = 'none' | 'few' | 'sparse' | null

/** Identifica periodos con pocos datos para mostrar avisos honestos. */
export function lowData(weeks: WeekBucket[]): LowDataLevel {
  const total = weeks.reduce((s, w) => s + w.total, 0)
  if (total === 0) return 'none'
  if (total < 5) return 'few'
  const withData = weeks.filter((w) => w.total > 0).length
  if (weeks.length >= 3 && withData / weeks.length < 0.5) return 'sparse'
  return null
}

export type TimeSavingResult =
  | { ok: true; diffMin: number; pct: number; certainty: 'medido' | 'estimado' }
  | { ok: false; missing: string[] }

/** Calcula el ahorro solo con datos suficientes. Nunca convierte a dinero. */
export function timeSavingResult(ts?: TimeSaving): TimeSavingResult {
  const missing: string[] = []
  if (!ts) return { ok: false, missing: ['tiempo de referencia', 'tiempo con el nuevo proceso', 'alcance comparable', 'medido o estimado'] }
  if (!(typeof ts.baselineMin === 'number' && ts.baselineMin > 0)) missing.push('tiempo de referencia')
  if (!(typeof ts.newMin === 'number' && ts.newMin >= 0)) missing.push('tiempo con el nuevo proceso')
  if (!ts.scope?.trim()) missing.push('alcance comparable')
  if (!ts.certainty) missing.push('medido o estimado')
  if (missing.length) return { ok: false, missing }
  const diffMin = ts.baselineMin! - ts.newMin!
  const pct = Math.round((diffMin / ts.baselineMin!) * 100)
  return { ok: true, diffMin, pct, certainty: ts.certainty! }
}

export function hasTimeSavingData(ts?: TimeSaving): boolean {
  return !!ts && (ts.baselineMin !== undefined || ts.newMin !== undefined || !!ts.scope || !!ts.baselineSource)
}

/** Cuenta ids únicos aunque aparezcan en varias listas. */
export function uniqueCount(...lists: string[][]): number {
  const s = new Set<string>()
  for (const l of lists) for (const id of l) s.add(id)
  return s.size
}

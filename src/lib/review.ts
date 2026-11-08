/**
 * Borrador de revisión profesional a partir de plantillas y datos reales.
 * Reglas: cada afirmación lleva sus registros de origen; no se inventa impacto
 * comercial, ahorros ni aprobación del cliente; "practicar" no es "dominar".
 */
import type {
  ActionItem,
  ChangeRequest,
  Meeting,
  Attendance,
  AttendanceSettings,
  Brand,
  Entry,
  Goal,
  Project,
  ReviewDoc,
  ReviewItem,
  ReviewSection,
  ReviewSectionKey,
} from '../db/types'
import { REVIEW_SECTIONS, STATUS_LABEL } from './constants'
import { formatDate, formatMinutes, maxDate, minDate } from './dates'
import { attendanceStats } from './attendance'
import { countable, inRange, skillsOverTime, timeSavingResult } from './metrics'
import { excerpt, fold, plural } from './text'

export interface ReviewInput {
  allEntries: Entry[]
  projects: Project[]
  brands: Brand[]
  goals: Goal[]
  attendance: Attendance[]
  attendanceSettings?: AttendanceSettings
  nextStep?: string
  periodStart: string
  periodEnd: string
  today: string
  includeAttendance: boolean
  includeMeetings?: boolean
  meetings?: Meeting[]
  actions?: ActionItem[]
  changes?: ChangeRequest[]
  makeId: () => string
}

const SOLVED_RE = /\b(resolvi|solucione|arregle|corregi|destrabe|desbloquee)/
const RESP_RE = /(responsab|a mi cargo|lidere|coordine|me asignaron|quede a cargo)/

function range(a: string, b: string) {
  return a === b ? formatDate(a, 'medium') : `${formatDate(a, 'dayMonth')} y ${formatDate(b, 'medium')}`
}

export function generateSections(input: ReviewInput): ReviewSection[] {
  const { projects, brands, periodStart: from, periodEnd: to, makeId } = input
  const pById = new Map(projects.map((p) => [p.id, p]))
  const bById = new Map(brands.map((b) => [b.id, b]))
  const all = countable(input.allEntries).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
  const list = all.filter((e) => inRange(e, from, to))
  const item = (text: string, sources: string[]): ReviewItem => ({
    id: makeId(),
    text,
    generatedText: text,
    sources: [...new Set(sources)],
    origin: 'plantilla',
  })
  const brandOf = (e: Entry) => {
    const p = e.projectId ? pById.get(e.projectId) : undefined
    const id = e.brandId ?? (p && !p.brandUnconfirmed ? p.brandId : undefined)
    return id ? bById.get(id) : undefined
  }
  const out: Record<ReviewSectionKey, ReviewItem[]> = {
    proyectos: [],
    contribucion: [],
    problemas: [],
    feedback: [],
    responsabilidades: [],
    habilidades: [],
    resultados: [],
    objetivos: [],
    asistencia: [],
    juntas: [],
  }

  // 1. Proyectos y entregables
  const byProject = new Map<string, Entry[]>()
  for (const e of list) if (e.projectId && pById.has(e.projectId)) {
    const arr = byProject.get(e.projectId) ?? []
    arr.push(e)
    byProject.set(e.projectId, arr)
  }
  const projOrder = [...byProject.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [pid, es] of projOrder) {
    const p = pById.get(pid)!
    const b = p.brandId && !p.brandUnconfirmed ? bById.get(p.brandId) : undefined
    const outcomes = [...new Set(es.map((e) => e.outcome?.trim()).filter(Boolean) as string[])]
    const withStatus = es.filter((e) => e.status)
    const last = withStatus[withStatus.length - 1]
    const evid = es.filter((e) => e.evidence).length
    let t = `${p.name}${b ? ` (${b.name})` : ''}: ${plural(es.length, 'registro', 'registros')} entre ${range(es[0].date, es[es.length - 1].date)}.`
    if (outcomes.length) t += ` Entregables registrados: ${outcomes.slice(0, 4).join('; ')}${outcomes.length > 4 ? '…' : ''}.`
    if (last?.status) t += ` Último estado que registré: ${STATUS_LABEL[last.status].toLowerCase()} (${formatDate(last.date, 'dayMonth')}).`
    if (evid) t += ` ${plural(evid, 'registro marcado', 'registros marcados')} como evidencia.`
    out.proyectos.push(item(t, es.map((e) => e.id)))
  }
  for (const e of list) if (!e.projectId && e.categories.includes('entrega') && e.outcome?.trim()) {
    const b = brandOf(e)
    out.proyectos.push(item(`Entregable: ${e.outcome.trim()}${b ? ` (${b.name})` : ''}, ${formatDate(e.date, 'medium')}.`, [e.id]))
  }

  // 2. Contribución concreta
  const contrib = list
    .filter((e) => e.contribution?.trim())
    .sort((a, b) => Number(!!b.evidence) - Number(!!a.evidence) || b.date.localeCompare(a.date))
    .slice(0, 12)
  for (const e of contrib) {
    const p = e.projectId ? pById.get(e.projectId) : undefined
    let t = e.contribution!.trim().replace(/\.$/, '')
    if (p) t += ` — ${p.name}`
    if (e.collaborators?.trim()) t += ` (en colaboración con ${e.collaborators.trim()})`
    out.contribucion.push(item(t + '.', [e.id]))
  }

  // 3. Problemas resueltos
  for (const e of list) {
    const isBlock = e.categories.includes('bloqueo')
    const resolved = e.outcome?.trim() || (e.status && e.status !== 'en_proceso')
    if (isBlock && resolved) {
      const res = e.outcome?.trim() ? e.outcome.trim() : `estado ${STATUS_LABEL[e.status!].toLowerCase()}`
      out.problemas.push(item(`${excerpt(e.text, 110)} → Resultado: ${res}.`, [e.id]))
    } else if (!isBlock && SOLVED_RE.test(fold(e.text))) {
      out.problemas.push(item(excerpt(e.text, 160), [e.id]))
    }
  }

  // 4. Feedback (cita textual separada de mi interpretación)
  for (const e of list) {
    const f = e.feedback
    const hasF = !!(f && (f.quote?.trim() || f.interpretation?.trim() || f.person?.trim()))
    if (!hasF && !e.categories.includes('feedback')) continue
    const who = f?.person?.trim() || 'persona no registrada'
    const when = f?.date ? formatDate(f.date, 'medium') : formatDate(e.date, 'medium')
    let t: string
    if (f?.quote?.trim()) t = `«${f.quote.trim()}» — ${who}, ${when}.`
    else t = `${excerpt(e.text, 120)} (sin cita textual registrada; ${who}, ${when}).`
    if (f?.interpretation?.trim()) t += ` Mi interpretación: ${f.interpretation.trim()}`
    out.feedback.push(item(t, [e.id]))
  }

  // 5. Responsabilidades nuevas: primera vez que aparece un proyecto o marca
  const firstProject = new Map<string, Entry>()
  const firstBrand = new Map<string, Entry>()
  for (const e of all) {
    if (e.projectId && !firstProject.has(e.projectId)) firstProject.set(e.projectId, e)
    const b = brandOf(e)
    if (b && !firstBrand.has(b.id)) firstBrand.set(b.id, e)
  }
  for (const [bid, e] of firstBrand) if (inRange(e, from, to)) {
    out.responsabilidades.push(item(`Empecé a registrar trabajo para ${bById.get(bid)!.name} (primer registro: ${formatDate(e.date, 'medium')}).`, [e.id]))
  }
  for (const [pid, e] of firstProject) if (inRange(e, from, to)) {
    const p = pById.get(pid)
    if (p) out.responsabilidades.push(item(`Proyecto nuevo en mi registro: ${p.name} (desde ${formatDate(e.date, 'medium')}).`, [e.id]))
  }
  for (const e of list) if (RESP_RE.test(fold(e.text))) out.responsabilidades.push(item(excerpt(e.text, 160), [e.id]))

  // 6. Habilidades (practicadas, con ejemplos reales)
  for (const s of skillsOverTime(list, from, to).slice(0, 10)) {
    const ex = list.filter((e) => s.entryIds.includes(e.id))
    const sample = ex.find((e) => e.evidence) ?? ex[ex.length - 1]
    out.habilidades.push(
      item(`${s.label}: practicada en ${plural(s.total, 'registro', 'registros')} entre ${range(s.first, s.last)}. Ejemplo: “${excerpt(sample.text, 110)}”`, s.entryIds),
    )
  }

  // 7. Resultados medidos (solo con datos suficientes; conserva "estimado")
  for (const e of list) {
    const r = timeSavingResult(e.timeSaving)
    if (!r.ok) continue
    const ts = e.timeSaving!
    const verb = r.diffMin >= 0 ? `${formatMinutes(r.diffMin)} menos` : `${formatMinutes(-r.diffMin)} más`
    out.resultados.push(
      item(
        `${ts.scope!.trim()}: de ${formatMinutes(ts.baselineMin!)} a ${formatMinutes(ts.newMin!)} (${verb}, ${Math.abs(r.pct)} %) — valor ${r.certainty}. Referencia: ${ts.baselineSource?.trim() || 'sin fuente registrada'}.`,
        [e.id],
      ),
    )
  }

  // 8. Objetivos siguientes
  for (const g of input.goals.filter((g) => g.status === 'activo')) {
    let t = g.title.trim()
    if (g.criterion?.trim()) t += ` — criterio de cumplimiento: ${g.criterion.trim()}`
    if (g.dueDate) t += ` — fecha objetivo: ${formatDate(g.dueDate, 'medium')}`
    const ids = g.evidenceIds.filter((id) => all.some((e) => e.id === id))
    out.objetivos.push(item(t + '.', ids))
  }
  if (input.nextStep?.trim()) out.objetivos.push(item(`Siguiente paso fijado: ${input.nextStep.trim()}`, []))

  // 9. Puntualidad (solo si se pide)
  if (input.includeAttendance && input.attendanceSettings) {
    const cfg = input.attendanceSettings
    const pStart = maxDate(cfg.periodStart, from)
    const pEnd = minDate(cfg.periodEnd, to)
    if (pStart <= pEnd) {
      const st = attendanceStats(input.attendance, { ...cfg, periodStart: pStart, periodEnd: pEnd }, input.today)
      if (st.base > 0 || st.sinRegistro > 0) {
        const pct = st.pct === null ? 'sin base suficiente' : `${Math.round(st.pct * 100)} %`
        out.asistencia.push(
          item(
            `Llegadas a tiempo (antes de las ${cfg.cutoff}): ${st.antes} de ${plural(st.base, 'día presencial', 'días presenciales')} con hora (${pct}); retardos: ${st.despues}. Días presenciales aplicables sin registro: ${st.sinRegistro}. Registro personal; no sustituye el control oficial de asistencia.`,
            [],
          ),
        )
      }
    }
  }

  // 10. Juntas (solo si se pide; nunca incluye transcripciones; asistir no cuenta como logro)
  if (input.includeMeetings) {
    const allIds = new Set(all.map((e) => e.id))
    for (const m of (input.meetings ?? []).filter((m) => inRange(m, from, to)).sort((a, b) => a.date.localeCompare(b.date))) {
      const dec = m.decisions.filter((d) => d.review === 'revisado' && !d.superseded).length
      const ch = (input.changes ?? []).filter((c) => c.meetingId === m.id && c.review === 'revisado').length
      const ac = (input.actions ?? []).filter((a) => a.meetingId === m.id && (a.status === 'confirmada' || a.status === 'hecha')).length
      if (!dec && !ch && !ac) continue
      const p = m.projectId ? pById.get(m.projectId) : undefined
      const parts = [dec && plural(dec, 'decisión confirmada', 'decisiones confirmadas'), ch && plural(ch, 'cambio registrado', 'cambios registrados'), ac && plural(ac, 'acción confirmada', 'acciones confirmadas')].filter(Boolean)
      out.juntas.push(item(`Junta «${m.title}» (${formatDate(m.date, 'medium')}${p ? `, ${p.name}` : ''}): ${parts.join(', ')}.`, m.entryIds.filter((id) => allIds.has(id))))
    }
  }

  return REVIEW_SECTIONS.filter((s) => (s.key !== 'asistencia' || input.includeAttendance) && (s.key !== 'juntas' || input.includeMeetings)).map((s) => ({
    key: s.key,
    items: out[s.key],
  }))
}

/** Total de registros de origen ÚNICOS en todo el documento. */
export function uniqueSources(doc: Pick<ReviewDoc, 'sections'>): string[] {
  const s = new Set<string>()
  for (const sec of doc.sections) for (const it of sec.items) for (const id of it.sources) s.add(id)
  return [...s]
}

/**
 * Actualiza un borrador desde los registros sin perder lo que edité:
 * conserva puntos manuales y editados; reemplaza los generados sin tocar.
 */
export function refreshSections(current: ReviewSection[], fresh: ReviewSection[]): ReviewSection[] {
  return fresh.map((f) => {
    const cur = current.find((c) => c.key === f.key)
    if (!cur) return f
    const kept = cur.items.filter((i) => i.origin === 'manual' || i.text !== i.generatedText)
    const keptGen = new Set(kept.map((i) => i.generatedText).filter(Boolean))
    return { key: f.key, items: [...f.items.filter((i) => !keptGen.has(i.generatedText)), ...kept] }
  })
}

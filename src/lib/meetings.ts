/**
 * Juntas: lectura de transcripciones y extracción LOCAL por reglas (sin IA, sin servicios externos).
 * Principios:
 *  - Solo se detecta lo que aparece bajo encabezados o prefijos explícitos.
 *  - Todo lo detectado empieza "por revisar"; nunca se toma el silencio como aprobación
 *    ni una sugerencia como decisión (las sugerencias van a "Ideas").
 *  - Nunca se asigna un responsable por defecto (tampoco a Joshua).
 *  - Cada propuesta lleva una clave estable: importar dos veces no duplica.
 */
import type { ActionItem, ChangeRequest, Meeting, MeetingClosing } from '../db/types'
import { CHANGE_STATUS_LABEL } from './constants'
import { addDays, formatDate, isISODate } from './dates'
import { fold } from './text'

/** Hash rápido y estable (cyrb53) para claves de deduplicación. */
export function hashText(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export function contentHash(text: string): string {
  return hashText(text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim())
}

export function detectFormat(fileName: string, text: string): 'vtt' | 'srt' | 'txt' {
  const n = fileName.toLowerCase()
  if (n.endsWith('.vtt') || /^﻿?WEBVTT/.test(text)) return 'vtt'
  if (n.endsWith('.srt') || /^\s*\d+\s*\r?\n\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(text)) return 'srt'
  return 'txt'
}

const TIMING = /^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,]\d{1,3}\s*-->/

/** VTT/SRT → líneas "[hh:mm:ss] Persona: texto". */
export function parseSubtitles(raw: string): string {
  const blocks = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)
  const out: string[] = []
  let last = ''
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    const ti = lines.findIndex((l) => TIMING.test(l))
    if (ti === -1) continue
    const m = TIMING.exec(lines[ti])!
    const ts = `${(m[1] ?? '00').padStart(2, '0')}:${m[2]}:${m[3]}`
    const text = lines
      .slice(ti + 1)
      .join(' ')
      .replace(/<v(?:\.[^ >]+)?\s+([^>]+)>/g, '$1: ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text || text === last) continue
    last = text
    out.push(`[${ts}] ${text}`)
  }
  return out.join('\n')
}

export type ProposalKind = 'objective' | 'decision' | 'idea' | 'question' | 'material' | 'action' | 'change'
export interface Proposal {
  kind: ProposalKind
  text: string
  source: string
  key: string
  owner?: string
  dueDate?: string
  timestamp?: string
}

const HEADINGS: [ProposalKind, RegExp][] = [
  ['decision', /^(decisiones( confirmadas| tomadas)?|acuerdos|se acordo|decisions|agreements|agreed)$/],
  ['action', /^(acciones|tareas|pendientes|proximos pasos|siguientes pasos|compromisos|action items|next steps|to ?dos?|follow ?ups?)$/],
  ['question', /^(preguntas( pendientes| abiertas)?|dudas|open questions|questions)$/],
  ['material', /^(materiales( del cliente| pendientes)?|insumos( del cliente)?|el cliente (debe )?enviar|assets( pendientes)?|client deliverables)$/],
  ['idea', /^(ideas( exploratorias)?|propuestas|sugerencias|exploracion|brainstorm(ing)?)$/],
  ['change', /^(cambios( solicitados)?|ajustes|correcciones|revisiones|changes( requested)?|revisions)$/],
  ['objective', /^(objetivo|objetivos|proposito|objective|purpose)$/],
]
const INLINE: [ProposalKind, RegExp][] = [
  ['decision', /^(decisi[oó]n|acuerdo|se acord[oó] que|decided|agreed)\s*[:–-]\s*/i],
  ['action', /^(acci[oó]n|tarea|todo|to do|pendiente|action item|action)\s*[:–-]\s*/i],
  ['question', /^(pregunta|duda|question)\s*[:–-]\s*/i],
  ['material', /^(material|insumo|el cliente env[ií]a)\s*[:–-]\s*/i],
  ['idea', /^(idea|propuesta|sugerencia)\s*[:–-]\s*/i],
  ['change', /^(cambio|ajuste|correcci[oó]n|change)\s*[:–-]\s*/i],
]

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7,
  ago: 8, agosto: 8, sep: 9, sept: 9, septiembre: 9, oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12,
}

/** Fecha explícita en el texto (nunca días relativos como "el viernes"). */
export function findDate(text: string, refDate: string): string | undefined {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text)
  if (iso && isISODate(iso[1])) return iso[1]
  const refYear = Number(refDate.slice(0, 4))
  const fix = (y: number, m: number, d: number) => {
    const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (!isISODate(s)) return undefined
    // Si queda muy atrás respecto a la junta, probablemente es del año siguiente.
    return s < addDays(refDate, -60) ? `${y + 1}${s.slice(4)}` : s
  }
  const dm = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text)
  if (dm) {
    const d = Number(dm[1])
    const mo = Number(dm[2])
    if (!dm[3]) return fix(refYear, mo, d)
    const y = dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])
    const s = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    return isISODate(s) ? s : undefined
  }
  const named = /\b(\d{1,2})\s+(?:de\s+)?([a-záéíóú]{3,10})\.?(?:\s+(?:de\s+)?(\d{4}))?\b/i.exec(text)
  if (named) {
    const mo = MONTHS[fold(named[2])]
    if (mo) return named[3] ? `${named[3]}-${String(mo).padStart(2, '0')}-${named[1].padStart(2, '0')}` : fix(refYear, mo, Number(named[1]))
  }
  return undefined
}

/** Responsable mencionado explícitamente ("@Ana", "Responsable: Ana", "(Ana)"). */
export function findOwner(text: string): string | undefined {
  const at = /@([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:\s[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)?)/.exec(text)
  if (at) return at[1]
  const resp = /\b(?:responsable|resp\.|owner|encargad[oa]|a cargo de)\s*[:\-]?\s*([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:\s[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)?)/i.exec(text)
  if (resp) return resp[1]
  const paren = /\(([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:\s[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+){0,2})\)\s*\.?$/.exec(text)
  if (paren && !MONTHS[fold(paren[1])]) return paren[1]
  return undefined
}

export function proposalKey(meetingId: string, kind: ProposalKind, text: string): string {
  return hashText(`${meetingId}|${kind}|${fold(text).replace(/[^\p{L}\p{N} ]+/gu, '')}`)
}

function cleanHeading(line: string): string {
  return fold(line.replace(/^#+\s*/, '').replace(/^\*\*|\*\*$/g, '').replace(/^__|__$/g, '').replace(/:\s*$/, '').replace(/\*\*:?$/, '').trim())
}

/** Propone elementos a partir de un resumen con secciones claras. Todo queda "por revisar". */
export function extractProposals(text: string, meetingId: string, refDate: string): Proposal[] {
  const out: Proposal[] = []
  const seen = new Set<string>()
  let section: ProposalKind | null = null
  const push = (kind: ProposalKind, raw: string, source: string, ts?: string) => {
    let t = raw.trim()
    let timestamp: string | undefined = ts
    const tsm = /^\[(\d{2}:\d{2}:\d{2})\]\s*/.exec(t)
    if (tsm) {
      timestamp = tsm[1]
      t = t.slice(tsm[0].length)
    }
    t = t.replace(/^\*\*|\*\*$/g, '').trim()
    if (t.length < 3) return
    const key = proposalKey(meetingId, kind, t)
    if (seen.has(key)) return
    seen.add(key)
    const p: Proposal = { kind, text: t.slice(0, 1000), source: source.slice(0, 300), key, timestamp }
    if (kind === 'action' || kind === 'change') {
      p.owner = findOwner(t)
      p.dueDate = findDate(t, refDate)
    }
    out.push(p)
  }
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const bullet = /^(?:[-*•–]|\d+[.)])\s+(.*)$/.exec(line)
    const body = bullet ? bullet[1] : line
    if (!bullet && line.length <= 48) {
      const h = cleanHeading(line)
      const found = HEADINGS.find(([, re]) => re.test(h))
      if (found) {
        section = found[0]
        continue
      }
    }
    const tsMatch = /^\[(\d{2}:\d{2}:\d{2})\]/.exec(body)
    const withoutTs = body.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*(?:[^:]{1,40}:\s*)?/, '')
    const inline = INLINE.find(([, re]) => re.test(withoutTs))
    if (inline) {
      push(inline[0], withoutTs.replace(inline[1], ''), line, tsMatch?.[1])
      continue
    }
    if (section && (bullet || section === 'objective')) push(section, body, line)
    else if (!bullet && section && /^#/.test(line)) section = null
  }
  return out
}

// ----------------------------------------------------------- minuta y cierre

export interface MinutesInput {
  meeting: Meeting
  projectName?: string
  actions: ActionItem[]
  changes: ChangeRequest[]
}

const bullet = (s: string) => `- ${s}`

export function changeLine(c: ChangeRequest): string {
  const where = [c.piece, c.version ? `v${c.version.replace(/^v/i, '')}` : '', c.location].filter(Boolean).join(' · ')
  let s = `${where ? `${where}: ` : ''}${c.request.trim()}`
  if (c.keep?.trim()) s += `. Conservar: ${c.keep.trim()}`
  s += `. Solicitó: ${c.requestedBy?.trim() || 'no registrado'}`
  s += `. Responsable: ${c.assignee?.trim() || 'por definir'}`
  s += `. Fecha acordada por el equipo: ${c.agreedDate ? formatDate(c.agreedDate, 'medium') : 'sin fecha acordada'}`
  if (c.clientDate) s += ` (el cliente pidió ${formatDate(c.clientDate, 'medium')})`
  s += `. Estado: ${CHANGE_STATUS_LABEL[c.status].toLowerCase()}.`
  return s
}

export function actionLine(a: ActionItem): string {
  return `${a.text.trim()} — Responsable: ${a.owner?.trim() || 'por definir'} — Fecha: ${a.dueDate ? formatDate(a.dueDate, 'medium') : 'sin fecha'}`
}

export function pendingReviewCount({ meeting, actions, changes }: MinutesInput): number {
  const items = [...meeting.decisions, ...meeting.ideas, ...meeting.questions, ...meeting.materials]
  return items.filter((i) => i.review === 'por_revisar').length + actions.filter((a) => a.status === 'por_revisar').length + changes.filter((c) => c.review === 'por_revisar').length
}

/** Minuta editable: solo incluye lo revisado. No se envía a nadie. */
export function buildMinutes(input: MinutesInput): string {
  const { meeting: m, projectName, actions, changes } = input
  const rev = <T extends { review: string }>(xs: T[]) => xs.filter((x) => x.review === 'revisado')
  const L: string[] = []
  L.push(`Minuta — ${m.title}`)
  L.push(`Fecha: ${formatDate(m.date, 'long')}${projectName ? ` · Proyecto: ${projectName}` : ''}`)
  if (m.participants?.trim()) L.push(`Participantes: ${m.participants.trim()}`)
  if (m.sourceLink) L.push(`Documento original: ${m.sourceLink}`)
  const sec = (title: string, lines: string[]) => {
    if (!lines.length) return
    L.push('', title, ...lines)
  }
  if (m.objective?.trim()) sec('Objetivo', [m.objective.trim()])
  const dec = rev(m.decisions)
  sec('Decisiones confirmadas', dec.map((d) => bullet(d.superseded ? `(Sustituida) ${d.text}${d.supersededNote ? ` → ${d.supersededNote}` : ''}` : d.text)))
  sec('Cambios solicitados', rev(changes).map((c) => bullet(changeLine(c))))
  sec('Acciones', actions.filter((a) => a.status === 'confirmada' || a.status === 'hecha').map((a) => bullet(`${actionLine(a)}${a.status === 'hecha' ? ' (hecha)' : ''}`)))
  sec('Ideas exploratorias (no aprobadas)', rev(m.ideas).map((i) => bullet(i.text)))
  sec('Preguntas pendientes', rev(m.questions).map((q) => bullet(q.text)))
  sec('Materiales que debe enviar el cliente', rev(m.materials).map((q) => bullet(q.text)))
  const pending = pendingReviewCount(input)
  if (pending) L.push('', `Nota: ${pending} propuesta(s) sin revisar no se incluyen en esta minuta.`)
  return L.join('\n')
}

/** Borrador de la revisión de cierre a partir de lo revisado. */
export function closingDraft(input: MinutesInput): MeetingClosing {
  const { meeting: m, actions, changes } = input
  const dec = m.decisions.filter((d) => d.review === 'revisado' && !d.superseded).map((d) => d.text)
  const approvedChanges = changes.filter((c) => c.review === 'revisado' && c.status === 'aprobado').map((c) => c.request)
  const confirmedActions = actions.filter((a) => a.status === 'confirmada')
  const dated = [
    ...confirmedActions.filter((a) => a.dueDate).map((a) => `${a.text} → ${formatDate(a.dueDate!, 'medium')}`),
    ...changes.filter((c) => c.review === 'revisado' && c.agreedDate).map((c) => `${c.request} → ${formatDate(c.agreedDate!, 'medium')} (acordada)`),
  ]
  const undated = [...confirmedActions.filter((a) => !a.dueDate).map((a) => a.text), ...changes.filter((c) => c.review === 'revisado' && !c.agreedDate).map((c) => c.request)]
  const pendingQ = m.questions.filter((q) => q.review === 'revisado').map((q) => q.text)
  const pendingM = m.materials.filter((q) => q.review === 'revisado').map((q) => `Material del cliente: ${q.text}`)
  return {
    approved: [...dec, ...approvedChanges].join('\n'),
    changes: changes
      .filter((c) => c.review === 'revisado')
      .map((c) => c.request)
      .join('\n'),
    who: confirmedActions.map((a) => `${a.owner?.trim() || 'Responsable por definir'}: ${a.text}`).join('\n'),
    when: [...dated, ...undated.map((t) => `${t} → sin fecha acordada`)].join('\n'),
    pending: [...pendingQ, ...pendingM].join('\n'),
  }
}

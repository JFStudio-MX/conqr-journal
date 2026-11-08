/**
 * Formato de respaldo completo y versionado (independiente de la sincronización).
 * - Incluye todos los datos y los ADJUNTOS en base64 (no solo sus nombres).
 * - Lleva una huella SHA-256 para detectar archivos dañados o modificados.
 * - La validación es estricta: cualquier registro inválido rechaza el archivo completo.
 */
import type {
  ActionItem,
  ChangeRequest,
  Meeting,
  MeetingItem,
  Transcript,
  Attachment,
  AttendanceSettings,
  Attendance,
  Brand,
  BonusStage,
  CategoryId,
  CollectionName,
  Entry,
  EntryStatus,
  Goal,
  NextStepSettings,
  PrivateSettings,
  ProfileSettings,
  Project,
  Reflection,
  ReviewDoc,
  ReviewSectionKey,
  AnySettings,
} from '../db/types'
import { ATTENDANCE_KINDS, CATEGORY_IDS, CHANGE_STATUSES, LIMITS, REVIEW_SECTIONS, STATUSES, TRANSCRIPT_MAX_CHARS } from './constants'
import { isISODate, normalizeTime } from './dates'
import { safeUrl } from './text'

export const BACKUP_FORMAT = 'conqr-journal-backup'
export const BACKUP_VERSION = 1

export interface BackupFileEntry {
  id: string
  mime: string
  base64: string
}

export interface BackupData {
  settings: AnySettings[]
  brands: Brand[]
  projects: Project[]
  entries: Entry[]
  attachments: Attachment[]
  goals: Goal[]
  reflections: Reflection[]
  reviews: ReviewDoc[]
  attendance: Attendance[]
  meetings: Meeting[]
  transcripts: Transcript[]
  actions: ActionItem[]
  changes: ChangeRequest[]
  files: BackupFileEntry[]
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  appVersion: string
  exportedAt: string
  workspace: 'cuenta' | 'local' | 'demo'
  counts: Record<string, number>
  integrity: { sha256: string }
  data: BackupData
}

export const DATA_KEYS: (keyof BackupData)[] = [
  'settings',
  'brands',
  'projects',
  'entries',
  'attachments',
  'goals',
  'reflections',
  'reviews',
  'attendance',
  'meetings',
  'transcripts',
  'actions',
  'changes',
  'files',
]

// ---------- base64 ----------
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(bin)
}
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function buildBackup(data: BackupData, workspace: BackupFile['workspace'], appVersion: string, exportedAt: string): Promise<BackupFile> {
  const counts: Record<string, number> = {}
  for (const k of DATA_KEYS) counts[k] = data[k].length
  const sha256 = await sha256Hex(JSON.stringify(data))
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, appVersion, exportedAt, workspace, counts, integrity: { sha256 }, data }
}

// ---------- validación ----------
class V {
  errors: string[] = []
  constructor(public where: string) {}
  fail(msg: string) {
    if (this.errors.length < 25) this.errors.push(`${this.where}: ${msg}`)
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const optStr = (v: unknown, max = 5000): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined)
const optNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9 ? v : undefined)
const optDate = (v: unknown): string | undefined => (isISODate(v) ? v : undefined)
const strArr = (v: unknown, maxItems = 50, maxLen = 200): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= maxLen).slice(0, maxItems) : []
const ts = (v: unknown, fallback: string) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fallback)
const ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/

function reqId(v: V, raw: Record<string, unknown>): string | null {
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) {
    v.fail('id inválido')
    return null
  }
  return raw.id
}

function sanitizeEntry(raw: unknown, v: V, now: string): Entry | null {
  if (!isObj(raw)) return v.fail('no es un objeto'), null
  const id = reqId(v, raw)
  if (!id) return null
  if (!isISODate(raw.date)) return v.fail(`fecha inválida en ${id}`), null
  if (typeof raw.text !== 'string' || raw.text.length > LIMITS.textMax) return v.fail(`texto inválido en ${id}`), null
  const cats = Array.isArray(raw.categories) ? raw.categories.filter((c): c is CategoryId => CATEGORY_IDS.includes(c as CategoryId)) : []
  const status = STATUSES.some((s) => s.id === raw.status) ? (raw.status as EntryStatus) : undefined
  const f = isObj(raw.feedback) ? raw.feedback : undefined
  const t = isObj(raw.timeSaving) ? raw.timeSaving : undefined
  return {
    id,
    date: raw.date,
    text: raw.text,
    categories: [...new Set(cats)],
    projectId: optStr(raw.projectId, 120),
    brandId: optStr(raw.brandId, 120),
    pending: raw.pending === true ? true : undefined,
    pendingNote: optStr(raw.pendingNote, 1000),
    evidence: raw.evidence === true ? true : undefined,
    outcome: optStr(raw.outcome, 2000),
    contribution: optStr(raw.contribution, 4000),
    collaborators: optStr(raw.collaborators, 500),
    status,
    skills: strArr(raw.skills, 30, 60),
    timeSpentMin: optNum(raw.timeSpentMin),
    feedback: f
      ? { quote: optStr(f.quote, 4000), person: optStr(f.person, 200), date: optDate(f.date), interpretation: optStr(f.interpretation, 4000) }
      : undefined,
    links: strArr(raw.links, 20, 2000)
      .map((l) => safeUrl(l))
      .filter((l): l is string => !!l),
    attachmentIds: strArr(raw.attachmentIds, LIMITS.attachmentsPerEntry, 120),
    nextStep: optStr(raw.nextStep, 1000),
    timeSaving: t
      ? {
          baselineMin: optNum(t.baselineMin),
          baselineSource: optStr(t.baselineSource, 1000),
          newMin: optNum(t.newMin),
          scope: optStr(t.scope, 1000),
          certainty: t.certainty === 'medido' || t.certainty === 'estimado' ? t.certainty : undefined,
        }
      : undefined,
    createdAt: ts(raw.createdAt, now),
    updatedAt: ts(raw.updatedAt, now),
  }
}

function sanitizeBrand(raw: unknown, v: V, now: string): Brand | null {
  if (!isObj(raw)) return v.fail('no es un objeto'), null
  const id = reqId(v, raw)
  if (!id) return null
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 120) return v.fail(`nombre inválido en ${id}`), null
  return { id, name: raw.name, archived: raw.archived === true ? true : undefined, lastUsedAt: optStr(raw.lastUsedAt, 40), createdAt: ts(raw.createdAt, now), updatedAt: ts(raw.updatedAt, now) }
}

function sanitizeProject(raw: unknown, v: V, now: string): Project | null {
  if (!isObj(raw)) return v.fail('no es un objeto'), null
  const id = reqId(v, raw)
  if (!id) return null
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 120) return v.fail(`nombre inválido en ${id}`), null
  const status = raw.status === 'pausado' || raw.status === 'cerrado' ? raw.status : 'activo'
  return {
    id,
    name: raw.name,
    brandId: optStr(raw.brandId, 120),
    brandUnconfirmed: raw.brandUnconfirmed === true ? true : undefined,
    description: optStr(raw.description, 2000),
    status,
    lastUsedAt: optStr(raw.lastUsedAt, 40),
    createdAt: ts(raw.createdAt, now),
    updatedAt: ts(raw.updatedAt, now),
  }
}

const MIME_OK = ['image/webp', 'image/jpeg', 'image/png', 'image/gif']

function sanitizeAttachment(raw: unknown, v: V, now: string): Attachment | null {
  if (!isObj(raw)) return v.fail('no es un objeto'), null
  const id = reqId(v, raw)
  if (!id) return null
  if (typeof raw.entryId !== 'string') return v.fail(`entryId inválido en ${id}`), null
  if (typeof raw.mime !== 'string' || !MIME_OK.includes(raw.mime)) return v.fail(`tipo de archivo no permitido en ${id}`), null
  return {
    id,
    entryId: raw.entryId,
    name: optStr(raw.name, 200) ?? 'captura',
    mime: raw.mime,
    size: optNum(raw.size) ?? 0,
    width: optNum(raw.width),
    height: optNum(raw.height),
    path: optStr(raw.path, 300),
    createdAt: ts(raw.createdAt, now),
    updatedAt: ts(raw.updatedAt, now),
  }
}

function sanitizeGoal(raw: unknown, v: V, now: string): Goal | null {
  if (!isObj(raw)) return v.fail('no es un objeto'), null
  const id = reqId(v, raw)
  if (!id) return null
  if (typeof raw.title !== 'string' || !raw.title.trim()) return v.fail(`título inválido en ${id}`), null
  const status = raw.status === 'cumplido' || raw.status === 'archivado' ? raw.status : 'activo'
  return {
    id,
    title: raw.title.slice(0, 300),
    criterion: optStr(raw.criterion, 2000),
    dueDate: optDate(raw.dueDate),
    status,
    evidenceIds: strArr(raw.evidenceIds, 200, 120),
    completedAt: optStr(raw.completedAt, 40),
    createdAt: ts(raw.createdAt, now),
    updatedAt: ts(raw.updatedAt, now),
  }
}

function sanitizeReflection(raw: unknown, v: V, now: string): Reflection | null {
  if (!isObj(raw)) return v.fail('no es un objeto'), null
  if (!isISODate(raw.id)) return v.fail('semana inválida'), null
  return {
    id: raw.id,
    wentWell: optStr(raw.wentWell, 6000) ?? '',
    learned: optStr(raw.learned, 6000) ?? '',
    improve: optStr(raw.improve, 6000) ?? '',
    createdAt: ts(raw.createdAt, now),
    updatedAt: ts(raw.updatedAt, now),
  }
}

const SECTION_KEYS = REVIEW_SECTIONS.map((s) => s.key)

function sanitizeReview(raw: unknown, v: V, now: string): ReviewDoc | null {
  if (!isObj(raw)) return v.fail('no es un objeto'), null
  const id = reqId(v, raw)
  if (!id) return null
  if (!isISODate(raw.periodStart) || !isISODate(raw.periodEnd)) return v.fail(`periodo inválido en ${id}`), null
  const sections = Array.isArray(raw.sections) ? raw.sections : []
  return {
    id,
    title: optStr(raw.title, 300) ?? 'Revisión',
    periodStart: raw.periodStart,
    periodEnd: raw.periodEnd,
    sections: sections
      .filter((s): s is Record<string, unknown> => isObj(s) && SECTION_KEYS.includes(s.key as ReviewSectionKey))
      .map((s) => ({
        key: s.key as ReviewSectionKey,
        items: (Array.isArray(s.items) ? s.items : [])
          .filter(isObj)
          .filter((i) => typeof i.id === 'string' && typeof i.text === 'string')
          .map((i) => ({
            id: String(i.id),
            text: String(i.text).slice(0, 6000),
            generatedText: optStr(i.generatedText, 6000),
            sources: strArr(i.sources, 500, 120),
            origin: i.origin === 'manual' ? ('manual' as const) : ('plantilla' as const),
          })),
      })),
    includeSalary: raw.includeSalary === true,
    includeAttendance: raw.includeAttendance === true,
    includeSources: raw.includeSources !== false,
    includeMeetings: raw.includeMeetings === true ? true : undefined,
    createdAt: ts(raw.createdAt, now),
    updatedAt: ts(raw.updatedAt, now),
  }
}

function sanitizeAttendance(raw: unknown, v: V, now: string): Attendance | null {
  if (!isObj(raw)) return v.fail('no es un objeto'), null
  if (!isISODate(raw.id)) return v.fail('fecha de asistencia inválida'), null
  if (!ATTENDANCE_KINDS.some((k) => k.id === raw.kind)) return v.fail(`tipo inválido en ${raw.id}`), null
  const cf = isObj(raw.correctedFrom) ? raw.correctedFrom : undefined
  return {
    id: raw.id,
    kind: raw.kind as Attendance['kind'],
    time: normalizeTime(raw.time) ?? undefined,
    declaredAt: optStr(raw.declaredAt, 40),
    source: raw.source === 'boton' ? 'boton' : 'manual',
    offline: raw.offline === true ? true : undefined,
    correctedFrom:
      cf && ATTENDANCE_KINDS.some((k) => k.id === cf.kind)
        ? { kind: cf.kind as Attendance['kind'], time: normalizeTime(cf.time) ?? undefined, source: cf.source === 'boton' ? 'boton' : 'manual' }
        : undefined,
    note: optStr(raw.note, 1000),
    createdAt: ts(raw.createdAt, now),
    updatedAt: ts(raw.updatedAt, now),
  }
}

function sanitizeStage(raw: unknown): BonusStage | null {
  if (!isObj(raw)) return null
  const m = raw.months
  if (m !== 3 && m !== 6 && m !== 12) return null
  return {
    months: m,
    confirmedAmount: optNum(raw.confirmedAmount),
    rules: optStr(raw.rules, 4000),
    expectedPayDate: optDate(raw.expectedPayDate),
    paymentReceived: raw.paymentReceived === true ? true : undefined,
    paidDate: optDate(raw.paidDate),
    paidAmount: optNum(raw.paidAmount),
    notes: optStr(raw.notes, 2000),
  }
}

function sanitizeSettings(raw: unknown, v: V, now: string): AnySettings | null {
  if (!isObj(raw)) return v.fail('no es un objeto'), null
  const createdAt = ts(raw.createdAt, now)
  const updatedAt = ts(raw.updatedAt, now)
  switch (raw.id) {
    case 'profile': {
      if (!isISODate(raw.startDate)) return v.fail('fecha de inicio inválida'), null
      const p: ProfileSettings = {
        id: 'profile',
        name: optStr(raw.name, 120) ?? 'Joshua',
        nickname: optStr(raw.nickname, 60),
        fullName: optStr(raw.fullName, 200) ?? '',
        company: optStr(raw.company, 120) ?? '',
        team: optStr(raw.team, 120) ?? '',
        area: optStr(raw.area, 120) ?? '',
        startDate: raw.startDate,
        locale: 'es-MX',
        timezone: 'America/Mexico_City',
        weekStartsOn: 1,
        createdAt,
        updatedAt,
      }
      return p
    }
    case 'attendance': {
      const cutoff = normalizeTime(raw.cutoff)
      if (!cutoff || !isISODate(raw.periodStart) || !isISODate(raw.periodEnd)) return v.fail('configuración de asistencia inválida'), null
      const days = Array.isArray(raw.onsiteDays) ? raw.onsiteDays.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7) : []
      const stages = (Array.isArray(raw.stages) ? raw.stages : []).map(sanitizeStage).filter((s): s is BonusStage => !!s)
      const a: AttendanceSettings = {
        id: 'attendance',
        cutoff: cutoff.slice(0, 5),
        earlyArrival: normalizeTime(raw.earlyArrival)?.slice(0, 5),
        earlyLeaveMinutes: optNum(raw.earlyLeaveMinutes),
        exitTimes: isObj(raw.exitTimes) ? Object.fromEntries(Object.entries(raw.exitTimes).filter(([k, v]) => /^[1-7]$/.test(k) && normalizeTime(v)).map(([k, v]) => [k, normalizeTime(v)!.slice(0, 5)])) : undefined,
        onsiteDays: [...new Set(days)].sort(),
        periodStart: raw.periodStart,
        periodEnd: raw.periodEnd,
        rulesConfirmed: raw.rulesConfirmed === true,
        rules: optStr(raw.rules, 8000) ?? '',
        bonusNote: optStr(raw.bonusNote, 1000) ?? '',
        stages,
        createdAt,
        updatedAt,
      }
      return a
    }
    case 'nextStep': {
      const n: NextStepSettings = { id: 'nextStep', text: optStr(raw.text, 1000) ?? '', setAt: optStr(raw.setAt, 40), createdAt, updatedAt }
      return n
    }
    case 'private': {
      const p: PrivateSettings = {
        id: 'private',
        currentSalary: optStr(raw.currentSalary, 100),
        targetSalary: optStr(raw.targetSalary, 100),
        nextReviewDate: optDate(raw.nextReviewDate),
        notes: optStr(raw.notes, 4000),
        createdAt,
        updatedAt,
      }
      return p
    }
    default:
      v.fail(`ajuste desconocido "${String(raw.id).slice(0, 30)}"`)
      return null
  }
}

const review = (v: unknown) => (v === 'revisado' ? ('revisado' as const) : ('por_revisar' as const))

function sanitizeItems(v: unknown): MeetingItem[] {
  if (!Array.isArray(v)) return []
  return v
    .filter(isObj)
    .filter((i) => typeof i.id === 'string' && typeof i.text === 'string')
    .slice(0, 300)
    .map((i) => ({
      id: String(i.id).slice(0, 120),
      text: String(i.text).slice(0, 4000),
      review: review(i.review),
      source: optStr(i.source, 2000),
      key: optStr(i.key, 120),
      superseded: i.superseded === true ? true : undefined,
      supersededNote: optStr(i.supersededNote, 1000),
    }))
}

function sanitizeMeeting(raw: unknown, v: V, now: string): Meeting | null {
  if (!isObj(raw)) return v.fail('no es un objeto'), null
  const id = reqId(v, raw)
  if (!id) return null
  if (typeof raw.title !== 'string' || !raw.title.trim()) return v.fail(`título inválido en ${id}`), null
  if (!isISODate(raw.date)) return v.fail(`fecha inválida en ${id}`), null
  const c = isObj(raw.closing) ? raw.closing : undefined
  return {
    id,
    title: raw.title.slice(0, 300),
    date: raw.date,
    projectId: optStr(raw.projectId, 120),
    participants: optStr(raw.participants, 1000),
    sourceLink: typeof raw.sourceLink === 'string' ? (safeUrl(raw.sourceLink) ?? undefined) : undefined,
    notes: optStr(raw.notes, 40000),
    objective: optStr(raw.objective, 4000),
    objectiveReview: raw.objectiveReview === 'por_revisar' ? 'por_revisar' : undefined,
    decisions: sanitizeItems(raw.decisions),
    ideas: sanitizeItems(raw.ideas),
    questions: sanitizeItems(raw.questions),
    materials: sanitizeItems(raw.materials),
    closedAt: optStr(raw.closedAt, 40),
    closing: c
      ? { approved: optStr(c.approved, 4000), changes: optStr(c.changes, 4000), who: optStr(c.who, 4000), when: optStr(c.when, 4000), pending: optStr(c.pending, 4000) }
      : undefined,
    minutes: optStr(raw.minutes, 40000),
    entryIds: strArr(raw.entryIds, 200, 120),
    createdAt: ts(raw.createdAt, now),
    updatedAt: ts(raw.updatedAt, now),
  }
}

function sanitizeTranscript(raw: unknown, v: V, now: string): Transcript | null {
  if (!isObj(raw)) return v.fail('no es un objeto'), null
  const id = reqId(v, raw)
  if (!id) return null
  if (typeof raw.meetingId !== 'string' || typeof raw.text !== 'string' || raw.text.length > TRANSCRIPT_MAX_CHARS) return v.fail(`texto original inválido en ${id}`), null
  const format = raw.format === 'txt' || raw.format === 'vtt' || raw.format === 'srt' ? raw.format : 'pegado'
  return { id, meetingId: raw.meetingId, text: raw.text, format, fileName: optStr(raw.fileName, 200), hash: optStr(raw.hash, 128) ?? '', createdAt: ts(raw.createdAt, now), updatedAt: ts(raw.updatedAt, now) }
}

function sanitizeAction(raw: unknown, v: V, now: string): ActionItem | null {
  if (!isObj(raw)) return v.fail('no es un objeto'), null
  const id = reqId(v, raw)
  if (!id) return null
  if (typeof raw.text !== 'string' || !raw.text.trim()) return v.fail(`acción sin texto en ${id}`), null
  const st = raw.status === 'confirmada' || raw.status === 'hecha' || raw.status === 'descartada' ? raw.status : 'por_revisar'
  return {
    id,
    meetingId: optStr(raw.meetingId, 120),
    projectId: optStr(raw.projectId, 120),
    text: raw.text.slice(0, 2000),
    owner: optStr(raw.owner, 200),
    mine: raw.mine === true ? true : undefined,
    dueDate: optDate(raw.dueDate),
    status: st,
    source: optStr(raw.source, 2000),
    key: optStr(raw.key, 120),
    doneAt: optStr(raw.doneAt, 40),
    createdAt: ts(raw.createdAt, now),
    updatedAt: ts(raw.updatedAt, now),
  }
}

function sanitizeChange(raw: unknown, v: V, now: string): ChangeRequest | null {
  if (!isObj(raw)) return v.fail('no es un objeto'), null
  const id = reqId(v, raw)
  if (!id) return null
  if (typeof raw.request !== 'string' || !raw.request.trim()) return v.fail(`cambio sin descripción en ${id}`), null
  const s = isObj(raw.source) ? raw.source : undefined
  return {
    id,
    projectId: optStr(raw.projectId, 120),
    meetingId: optStr(raw.meetingId, 120),
    piece: optStr(raw.piece, 300),
    version: optStr(raw.version, 100),
    location: optStr(raw.location, 300),
    request: raw.request.slice(0, 4000),
    keep: optStr(raw.keep, 4000),
    requestedBy: optStr(raw.requestedBy, 200),
    assignee: optStr(raw.assignee, 200),
    clientDate: optDate(raw.clientDate),
    agreedDate: optDate(raw.agreedDate),
    source: s ? { fragment: optStr(s.fragment, 2000), link: typeof s.link === 'string' ? (safeUrl(s.link) ?? undefined) : undefined, timestamp: optStr(s.timestamp, 40) } : undefined,
    status: CHANGE_STATUSES.some((c) => c.id === raw.status) ? (raw.status as ChangeRequest['status']) : 'por_aclarar',
    review: review(raw.review),
    supersedesId: optStr(raw.supersedesId, 120),
    attachmentIds: strArr(raw.attachmentIds, LIMITS.attachmentsPerEntry, 120),
    key: optStr(raw.key, 120),
    createdAt: ts(raw.createdAt, now),
    updatedAt: ts(raw.updatedAt, now),
  }
}

const SANITIZERS: Record<CollectionName, (raw: unknown, v: V, now: string) => unknown> = {
  meetings: sanitizeMeeting,
  transcripts: sanitizeTranscript,
  actions: sanitizeAction,
  changes: sanitizeChange,
  settings: sanitizeSettings,
  brands: sanitizeBrand,
  projects: sanitizeProject,
  entries: sanitizeEntry,
  attachments: sanitizeAttachment,
  goals: sanitizeGoal,
  reflections: sanitizeReflection,
  reviews: sanitizeReview,
  attendance: sanitizeAttendance,
}

export interface BackupSummary {
  exportedAt: string
  appVersion: string
  workspace: string
  counts: Record<keyof BackupData, number>
  entriesRange: [string, string] | null
  attachmentBytes: number
  hasPrivate: boolean
}

export type ValidationResult =
  | { ok: true; data: BackupData; summary: BackupSummary; warnings: string[] }
  | { ok: false; errors: string[] }

export const MAX_BACKUP_BYTES = 200 * 1024 * 1024

/** Valida un respaldo ya leído como texto. No toca ninguna base de datos. */
export async function validateBackupText(text: string, now: string): Promise<ValidationResult> {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, errors: ['El archivo es demasiado grande para ser un respaldo.'] }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['El archivo no es un JSON válido.'] }
  }
  return validateBackup(json, now)
}

export async function validateBackup(json: unknown, now: string): Promise<ValidationResult> {
  if (!isObj(json)) return { ok: false, errors: ['El archivo no tiene el formato de respaldo.'] }
  if (json.format !== BACKUP_FORMAT) return { ok: false, errors: ['Este archivo no es un respaldo de CONQR Journal.'] }
  if (typeof json.version !== 'number' || json.version < 1) return { ok: false, errors: ['La versión del respaldo no es válida.'] }
  if (json.version > BACKUP_VERSION) return { ok: false, errors: [`El respaldo es de una versión más nueva (${json.version}). Actualiza la app antes de importarlo.`] }
  if (!isObj(json.data)) return { ok: false, errors: ['El respaldo no contiene datos.'] }
  const raw = json.data
  const errors: string[] = []
  const warnings: string[] = []
  for (const k of DATA_KEYS) if (!Array.isArray(raw[k])) errors.push(`Falta la lista "${k}".`)
  if (errors.length) return { ok: false, errors }

  const integrity = isObj(json.integrity) ? json.integrity.sha256 : undefined
  if (typeof integrity !== 'string') return { ok: false, errors: ['El respaldo no tiene huella de integridad.'] }
  const actual = await sha256Hex(JSON.stringify(raw))
  if (actual !== integrity) return { ok: false, errors: ['La huella de integridad no coincide: el archivo está dañado o fue modificado.'] }

  const out = {} as BackupData
  for (const k of DATA_KEYS) {
    if (k === 'files') continue
    const v = new V(k)
    const list = (raw[k] as unknown[]).map((r) => SANITIZERS[k as CollectionName](r, v, now)).filter(Boolean)
    const ids = new Set<string>()
    for (const r of list as { id: string }[]) {
      if (ids.has(r.id)) v.fail(`id duplicado ${r.id}`)
      ids.add(r.id)
    }
    errors.push(...v.errors)
    ;(out as unknown as Record<string, unknown[]>)[k] = list
  }

  // Archivos adjuntos (binarios en base64)
  const fv = new V('files')
  const files: BackupFileEntry[] = []
  let attachmentBytes = 0
  for (const f of raw.files as unknown[]) {
    if (!isObj(f) || typeof f.id !== 'string' || !ID_RE.test(f.id) || typeof f.base64 !== 'string' || typeof f.mime !== 'string' || !MIME_OK.includes(f.mime)) {
      fv.fail('archivo adjunto inválido')
      continue
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64)) {
      fv.fail(`contenido base64 inválido en ${f.id}`)
      continue
    }
    const bytes = Math.floor((f.base64.length * 3) / 4)
    if (bytes > LIMITS.maxStoredBytes * 1.2) {
      fv.fail(`adjunto demasiado grande en ${f.id}`)
      continue
    }
    attachmentBytes += bytes
    files.push({ id: f.id, mime: f.mime, base64: f.base64 })
  }
  errors.push(...fv.errors)
  out.files = files

  const fileIds = new Set(files.map((f) => f.id))
  const missing = out.attachments.filter((a) => !fileIds.has(a.id))
  if (missing.length) warnings.push(`${missing.length} adjunto(s) no incluyen su archivo y se omitirán.`)
  out.attachments = out.attachments.filter((a) => fileIds.has(a.id))

  if (errors.length) return { ok: false, errors }

  const dates = out.entries.map((e) => e.date).sort()
  const priv = out.settings.find((s) => s.id === 'private') as PrivateSettings | undefined
  const counts = {} as Record<keyof BackupData, number>
  for (const k of DATA_KEYS) counts[k] = out[k].length
  return {
    ok: true,
    data: out,
    warnings,
    summary: {
      exportedAt: typeof json.exportedAt === 'string' ? json.exportedAt : '',
      appVersion: typeof json.appVersion === 'string' ? json.appVersion : '',
      workspace: typeof json.workspace === 'string' ? json.workspace : '',
      counts,
      entriesRange: dates.length ? [dates[0], dates[dates.length - 1]] : null,
      attachmentBytes,
      hasPrivate: !!(priv && (priv.currentSalary || priv.targetSalary || priv.nextReviewDate || priv.notes)),
    },
  }
}

/** Compara dos registros ignorando metadatos de sincronización. */
export function sameContent(a: unknown, b: unknown): boolean {
  return stableStringify(stripMeta(a)) === stableStringify(stripMeta(b))
}

export function stripMeta<T>(r: T): T {
  if (!isObj(r)) return r
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(r)) if (!k.startsWith('_') && v !== undefined) out[k] = v
  return out as T
}

export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  if (isObj(v)) {
    return (
      '{' +
      Object.keys(v)
        .filter((k) => v[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k]))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(v) ?? 'null'
}

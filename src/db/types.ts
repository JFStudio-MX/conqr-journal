/** Modelo de datos de CONQR Journal. Todas las fechas civiles son 'YYYY-MM-DD'. */

export type CategoryId = 'entrega' | 'avance' | 'aprendizaje' | 'logro' | 'feedback' | 'bloqueo'
export type EntryStatus = 'en_proceso' | 'entregado' | 'aprobado' | 'publicado'
export type Certainty = 'medido' | 'estimado'

/** Metadatos de sincronización presentes en cada registro local. */
export interface SyncMeta {
  /** Versión del servidor sobre la que se basa esta copia (0 = nunca subido). */
  _v: number
  /** 1 = tiene cambios locales pendientes de sincronizar. */
  _dirty: 0 | 1
  /** Identificador de la mutación local pendiente (idempotencia). */
  _mid?: string
  /** 1 = eliminado (lápida) pendiente de propagar. */
  _deleted?: 0 | 1
  /** 1 = hay un conflicto sin resolver; no se sube hasta resolverlo. */
  _conflict?: 0 | 1
  /** Momento en que el servidor recibió el registro por primera vez. */
  _srvCreated?: string
  /** Último momento en que el servidor aceptó un cambio. */
  _srvUpdated?: string
}

export interface Feedback {
  /** Lo que dijeron, textual. */
  quote?: string
  person?: string
  date?: string
  /** Mi interpretación (no es una cita). */
  interpretation?: string
}

export interface TimeSaving {
  baselineMin?: number
  baselineSource?: string
  newMin?: number
  scope?: string
  certainty?: Certainty
}

export interface Entry {
  id: string
  date: string
  text: string
  categories: CategoryId[]
  projectId?: string
  brandId?: string
  /** Borrador precargado "Por confirmar": se excluye de métricas. */
  pending?: boolean
  pendingNote?: string
  /** Marcado como evidencia para revisión (destacado). */
  evidence?: boolean
  outcome?: string
  contribution?: string
  collaborators?: string
  status?: EntryStatus
  skills: string[]
  timeSpentMin?: number
  feedback?: Feedback
  links: string[]
  attachmentIds: string[]
  nextStep?: string
  timeSaving?: TimeSaving
  createdAt: string
  updatedAt: string
}

export interface Brand {
  id: string
  name: string
  archived?: boolean
  lastUsedAt?: string
  createdAt: string
  updatedAt: string
}

export type ProjectStatus = 'activo' | 'pausado' | 'cerrado'
export interface Project {
  id: string
  name: string
  brandId?: string
  /** La asociación con una marca está pendiente de confirmar. */
  brandUnconfirmed?: boolean
  description?: string
  status: ProjectStatus
  lastUsedAt?: string
  createdAt: string
  updatedAt: string
}

export interface Attachment {
  id: string
  entryId: string
  name: string
  mime: string
  size: number
  width?: number
  height?: number
  /** Ruta privada en el almacenamiento: <user_id>/<id>.<ext> (vacía en modo local/demo). */
  path?: string
  createdAt: string
  updatedAt: string
}

/** Binario de un adjunto, guardado solo en este dispositivo (caché). */
export interface BlobRow {
  id: string
  blob: Blob
  /** 1 = ya existe en el almacenamiento privado del servidor. */
  uploaded: 0 | 1
  cachedAt: string
}

export type GoalStatus = 'activo' | 'cumplido' | 'archivado'
export interface Goal {
  id: string
  title: string
  criterion?: string
  dueDate?: string
  status: GoalStatus
  evidenceIds: string[]
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface Reflection {
  /** id = lunes de la semana (YYYY-MM-DD). */
  id: string
  wentWell: string
  learned: string
  improve: string
  createdAt: string
  updatedAt: string
}

export type ReviewSectionKey =
  | 'proyectos'
  | 'contribucion'
  | 'problemas'
  | 'feedback'
  | 'responsabilidades'
  | 'habilidades'
  | 'resultados'
  | 'objetivos'
  | 'asistencia'
  | 'juntas'

export interface ReviewItem {
  id: string
  text: string
  /** Texto generado originalmente por la plantilla (para saber si lo edité). */
  generatedText?: string
  sources: string[]
  origin: 'plantilla' | 'manual'
}
export interface ReviewSection {
  key: ReviewSectionKey
  items: ReviewItem[]
}
export interface ReviewDoc {
  id: string
  title: string
  periodStart: string
  periodEnd: string
  sections: ReviewSection[]
  includeSalary: boolean
  includeAttendance: boolean
  includeSources: boolean
  includeMeetings?: boolean
  createdAt: string
  updatedAt: string
}

export type AttendanceKind = 'presencial' | 'home_office' | 'permiso' | 'vacaciones' | 'no_laborable'
export interface Attendance {
  /** id = fecha (YYYY-MM-DD): un solo registro por día. */
  id: string
  kind: AttendanceKind
  /** Hora declarada de llegada en Ciudad de México 'HH:MM:SS' (solo presencial). */
  time?: string
  /** Instante en que se pulsó "Ya llegué" según el reloj del dispositivo. */
  declaredAt?: string
  source: 'boton' | 'manual'
  /** Se registró sin conexión. */
  offline?: boolean
  /** Corrección manual: lo que había antes. */
  correctedFrom?: { kind: AttendanceKind; time?: string; source: 'boton' | 'manual' }
  note?: string
  createdAt: string
  updatedAt: string
}

// ---- Juntas y seguimiento de cambios ----

/** Todo lo extraído automáticamente empieza "por revisar"; lo que escribes tú, "revisado". */
export type ReviewState = 'por_revisar' | 'revisado'

export interface MeetingItem {
  id: string
  text: string
  review: ReviewState
  /** Fragmento de origen (línea de notas o marca de tiempo). */
  source?: string
  /** Huella estable para no duplicar al importar dos veces el mismo texto. */
  key?: string
  /** Para decisiones: sustituida por un acuerdo posterior (se conserva en el historial). */
  superseded?: boolean
  supersededNote?: string
}

export interface MeetingClosing {
  approved?: string
  changes?: string
  who?: string
  when?: string
  pending?: string
}

export interface Meeting {
  id: string
  title: string
  date: string
  projectId?: string
  participants?: string
  /** Enlace al documento original en la plataforma de la empresa. */
  sourceLink?: string
  /** Mis notas y correcciones (separadas del texto original). */
  notes?: string
  objective?: string
  /** Si el objetivo vino de una extracción automática, empieza "por revisar". */
  objectiveReview?: ReviewState
  decisions: MeetingItem[]
  ideas: MeetingItem[]
  questions: MeetingItem[]
  materials: MeetingItem[]
  closedAt?: string
  closing?: MeetingClosing
  minutes?: string
  /** Registros del diario vinculados. */
  entryIds: string[]
  createdAt: string
  updatedAt: string
}

/** Texto original (resumen pegado o transcripción importada), separado de mis notas. */
export interface Transcript {
  id: string
  meetingId: string
  text: string
  format: 'pegado' | 'txt' | 'vtt' | 'srt'
  fileName?: string
  hash: string
  createdAt: string
  updatedAt: string
}

export type ActionStatus = 'por_revisar' | 'confirmada' | 'hecha' | 'descartada'
export interface ActionItem {
  id: string
  meetingId?: string
  projectId?: string
  text: string
  /** Responsable tal como se mencionó. Nunca se asigna a Joshua por defecto. */
  owner?: string
  /** Lo marcas tú explícitamente: aparece en "Hoy". */
  mine?: boolean
  dueDate?: string
  status: ActionStatus
  source?: string
  key?: string
  doneAt?: string
  createdAt: string
  updatedAt: string
}

export type ChangeStatus = 'por_aclarar' | 'confirmado' | 'en_proceso' | 'listo_revision' | 'aprobado'
export interface ChangeRequest {
  id: string
  projectId?: string
  meetingId?: string
  piece?: string
  version?: string
  /** Página, escena o segundo del video. */
  location?: string
  /** Qué se pidió. */
  request: string
  /** Qué debe conservarse. */
  keep?: string
  requestedBy?: string
  assignee?: string
  /** Fecha que pidió el cliente. */
  clientDate?: string
  /** Fecha aceptada por el equipo (vacía = "Sin fecha acordada"). */
  agreedDate?: string
  source?: { fragment?: string; link?: string; timestamp?: string }
  status: ChangeStatus
  review: ReviewState
  /** Este cambio sustituye a otro anterior (ambos se conservan). */
  supersedesId?: string
  attachmentIds: string[]
  key?: string
  createdAt: string
  updatedAt: string
}

// ---- Ajustes (colección "settings", un registro por id) ----

export interface ProfileSettings {
  id: 'profile'
  name: string
  /** Cómo te saluda la app ("Josh"). */
  nickname?: string
  fullName: string
  company: string
  team: string
  area: string
  startDate: string
  locale: string
  timezone: string
  weekStartsOn: 1
  createdAt: string
  updatedAt: string
}

export interface BonusStage {
  months: 3 | 6 | 12
  /** Importe confirmado por la empresa; vacío = "Por confirmar". */
  confirmedAmount?: number
  rules?: string
  expectedPayDate?: string
  paymentReceived?: boolean
  paidDate?: string
  paidAmount?: number
  notes?: string
}

export interface AttendanceSettings {
  id: 'attendance'
  /** Hora límite 'HH:MM': "antes de" es estrictamente menor. */
  cutoff: string
  /** Si llegas a esta hora o antes (HH:MM), puedes salir antes. */
  earlyArrival?: string
  /** Minutos que puedes salir antes si llegaste temprano. */
  earlyLeaveMinutes?: number
  /** Hora de salida por día de la semana ('1'=lunes … '7'=domingo), HH:MM. */
  exitTimes?: Record<string, string>
  /** Días presenciales: 1 = lunes … 7 = domingo. */
  onsiteDays: number[]
  periodStart: string
  periodEnd: string
  rulesConfirmed: boolean
  rules: string
  bonusNote: string
  stages: BonusStage[]
  createdAt: string
  updatedAt: string
}

export interface NextStepSettings {
  id: 'nextStep'
  text: string
  setAt?: string
  createdAt: string
  updatedAt: string
}

export interface PrivateSettings {
  id: 'private'
  currentSalary?: string
  targetSalary?: string
  nextReviewDate?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export type AnySettings = ProfileSettings | AttendanceSettings | NextStepSettings | PrivateSettings

export interface CollectionMap {
  entries: Entry
  brands: Brand
  projects: Project
  goals: Goal
  reflections: Reflection
  reviews: ReviewDoc
  attendance: Attendance
  settings: AnySettings
  attachments: Attachment
  meetings: Meeting
  transcripts: Transcript
  actions: ActionItem
  changes: ChangeRequest
}
export type CollectionName = keyof CollectionMap
export const COLLECTIONS: CollectionName[] = [
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
]

export type Stored<T> = T & SyncMeta

/** Conflicto entre la copia de este dispositivo y la del servidor. */
export interface ConflictRow {
  key: string
  collection: CollectionName
  id: string
  local: Record<string, unknown> | null
  localDeleted: boolean
  remote: Record<string, unknown> | null
  remoteDeleted: boolean
  remoteVersion: number
  remoteUpdatedAt?: string
  remoteCreatedAt?: string
  detectedAt: string
}

/** Valores locales del dispositivo (no se sincronizan). */
export interface LocalRow {
  key: string
  value: unknown
}

export interface DraftFileRow {
  id: string
  blob: Blob
  name: string
  mime: string
  width?: number
  height?: number
}

export interface QuickDraft {
  entryId: string
  date: string
  text: string
  categories: CategoryId[]
  projectId?: string
  brandId?: string
  details?: Partial<Entry>
  files?: DraftFileRow[]
  savedAt: string
}

import Dexie, { type Table } from 'dexie'
import type {
  ActionItem,
  ChangeRequest,
  Meeting,
  Transcript,
  Attendance,
  Attachment,
  AnySettings,
  BlobRow,
  Brand,
  CollectionMap,
  CollectionName,
  ConflictRow,
  Entry,
  Goal,
  LocalRow,
  Project,
  Reflection,
  ReviewDoc,
  Stored,
} from './types'

export type WorkspaceMode = 'account' | 'local' | 'demo'

/**
 * Caché local del diario (IndexedDB). En modo cuenta es una réplica de los datos
 * del servidor más una cola persistente de cambios pendientes (_dirty = 1).
 */
export class JournalDB extends Dexie {
  entries!: Table<Stored<Entry>, string>
  brands!: Table<Stored<Brand>, string>
  projects!: Table<Stored<Project>, string>
  goals!: Table<Stored<Goal>, string>
  reflections!: Table<Stored<Reflection>, string>
  reviews!: Table<Stored<ReviewDoc>, string>
  attendance!: Table<Stored<Attendance>, string>
  settings!: Table<Stored<AnySettings>, string>
  attachments!: Table<Stored<Attachment>, string>
  meetings!: Table<Stored<Meeting>, string>
  transcripts!: Table<Stored<Transcript>, string>
  actions!: Table<Stored<ActionItem>, string>
  changes!: Table<Stored<ChangeRequest>, string>
  blobs!: Table<BlobRow, string>
  conflicts!: Table<ConflictRow, string>
  local!: Table<LocalRow, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      entries: 'id, date, projectId, _dirty',
      brands: 'id, _dirty',
      projects: 'id, _dirty',
      goals: 'id, _dirty',
      reflections: 'id, _dirty',
      reviews: 'id, _dirty',
      attendance: 'id, _dirty',
      settings: 'id, _dirty',
      attachments: 'id, entryId, _dirty',
      meetings: 'id, date, projectId, _dirty',
      transcripts: 'id, meetingId, hash, _dirty',
      actions: 'id, meetingId, projectId, key, _dirty',
      changes: 'id, meetingId, projectId, key, _dirty',
      blobs: 'id, uploaded',
      conflicts: 'key',
      local: 'key',
    })
  }

  coll<C extends CollectionName>(c: C): Table<Stored<CollectionMap[C]>, string> {
    return this.table(c) as unknown as Table<Stored<CollectionMap[C]>, string>
  }
}

export function dbNameFor(mode: WorkspaceMode, userId?: string): string {
  if (mode === 'demo') return 'conqr-journal-demo'
  if (mode === 'local') return 'conqr-journal-local'
  return `conqr-journal-u-${userId}`
}

/** Traduce errores de IndexedDB a mensajes claros, sin falsos éxitos. */
export function storageErrorMessage(err: unknown): string {
  const e = err as { name?: string; inner?: { name?: string }; message?: string }
  const name = e?.inner?.name || e?.name || ''
  if (/Quota/i.test(name) || /quota/i.test(e?.message ?? '')) {
    return 'No hay espacio suficiente en el almacenamiento del navegador. Descarga un respaldo y libera espacio.'
  }
  if (name === 'ConstraintError') return 'Este registro ya estaba guardado.'
  if (name === 'DatabaseClosedError' || name === 'InvalidStateError') return 'La base de datos local está cerrada. Recarga la app.'
  if (name === 'MissingAPIError' || name === 'OpenFailedError') return 'Este navegador no permite guardar datos (¿modo privado o almacenamiento bloqueado?).'
  return `No se pudo guardar en este dispositivo${name ? ` (${name})` : ''}.`
}

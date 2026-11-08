import type { AttendanceKind, CategoryId, EntryStatus, ReviewSectionKey } from '../db/types'

export interface CategoryDef {
  id: CategoryId
  label: string
  /** Variable CSS del color (validado para daltonismo en claro y oscuro). */
  color: string
  hint: string
}

/** Orden canónico (chips, leyendas y apilado). */
export const CATEGORIES: CategoryDef[] = [
  { id: 'entrega', label: 'Entrega', color: 'var(--cat-entrega)', hint: 'Algo que entregaste' },
  { id: 'avance', label: 'Avance', color: 'var(--cat-avance)', hint: 'Progreso en algo en curso' },
  { id: 'aprendizaje', label: 'Aprendizaje', color: 'var(--cat-aprendizaje)', hint: 'Algo que aprendiste' },
  { id: 'logro', label: 'Logro', color: 'var(--cat-logro)', hint: 'Un resultado del que estás orgulloso' },
  { id: 'feedback', label: 'Feedback', color: 'var(--cat-feedback)', hint: 'Comentarios que recibiste' },
  { id: 'bloqueo', label: 'Bloqueo', color: 'var(--cat-bloqueo)', hint: 'Algo que te frenó' },
]
export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, CategoryDef>
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id)

/**
 * En los totales cada registro cuenta UNA vez. Si tiene varias categorías,
 * se asigna a la de mayor prioridad de esta lista.
 */
export const PRIMARY_PRIORITY: CategoryId[] = ['entrega', 'logro', 'feedback', 'aprendizaje', 'avance', 'bloqueo']

export const STATUSES: { id: EntryStatus; label: string }[] = [
  { id: 'en_proceso', label: 'En proceso' },
  { id: 'entregado', label: 'Entregado' },
  { id: 'aprobado', label: 'Aprobado' },
  { id: 'publicado', label: 'Publicado' },
]
export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label])) as Record<EntryStatus, string>

export const ATTENDANCE_KINDS: { id: AttendanceKind; label: string }[] = [
  { id: 'presencial', label: 'Presencial' },
  { id: 'home_office', label: 'Home office' },
  { id: 'permiso', label: 'Permiso' },
  { id: 'vacaciones', label: 'Vacaciones' },
  { id: 'no_laborable', label: 'Día no laborable' },
]
export const ATTENDANCE_LABEL = Object.fromEntries(ATTENDANCE_KINDS.map((s) => [s.id, s.label])) as Record<AttendanceKind, string>

export const REVIEW_SECTIONS: { key: ReviewSectionKey; title: string; empty: string }[] = [
  { key: 'proyectos', title: 'Proyectos y entregables destacados', empty: 'Sin registros con proyecto en este periodo.' },
  { key: 'contribucion', title: 'Mi contribución concreta', empty: 'Agrega “Mi contribución” en tus registros para que aparezca aquí.' },
  { key: 'problemas', title: 'Problemas resueltos', empty: 'Sin bloqueos con resultado registrado en este periodo.' },
  { key: 'feedback', title: 'Feedback recibido', empty: 'Sin feedback registrado en este periodo.' },
  { key: 'responsabilidades', title: 'Responsabilidades nuevas', empty: 'Sin proyectos o marcas nuevas en este periodo.' },
  { key: 'habilidades', title: 'Habilidades desarrolladas y ejemplos', empty: 'Agrega “Habilidad practicada” en tus registros.' },
  { key: 'resultados', title: 'Resultados medidos', empty: 'Sin mediciones registradas. Usa “Ahorro de tiempo” en los detalles.' },
  { key: 'objetivos', title: 'Objetivos siguientes', empty: 'Sin objetivos activos. Agrégalos en Progreso.' },
  { key: 'asistencia', title: 'Puntualidad (registro personal)', empty: 'Sin registros de llegada en este periodo.' },
  { key: 'juntas', title: 'Juntas y acuerdos revisados', empty: 'Sin juntas con acuerdos revisados en este periodo.' },
]

export const CHANGE_STATUSES: { id: import('../db/types').ChangeStatus; label: string }[] = [
  { id: 'por_aclarar', label: 'Por aclarar' },
  { id: 'confirmado', label: 'Confirmado' },
  { id: 'en_proceso', label: 'En proceso' },
  { id: 'listo_revision', label: 'Listo para revisión' },
  { id: 'aprobado', label: 'Aprobado' },
]
export const CHANGE_STATUS_LABEL = Object.fromEntries(CHANGE_STATUSES.map((s) => [s.id, s.label])) as Record<import('../db/types').ChangeStatus, string>

export const ACTION_STATUS_LABEL: Record<import('../db/types').ActionStatus, string> = {
  por_revisar: 'Por revisar',
  confirmada: 'Confirmada',
  hecha: 'Hecha',
  descartada: 'Descartada',
}

export const TRANSCRIPT_MAX_CHARS = 150_000
export const REVIEW_TITLE = Object.fromEntries(REVIEW_SECTIONS.map((s) => [s.key, s.title])) as Record<ReviewSectionKey, string>

export const DEFAULT_BRANDS = ['Adium', 'KleenBebé', 'ROCKA Solutions', 'ECCO', 'Red Vía Corta', 'Pétalo']

export const LIMITS = {
  attachmentsPerEntry: 4,
  /** Tamaño máximo del archivo original que se acepta para comprimir. */
  maxInputBytes: 25 * 1024 * 1024,
  /** Tamaño máximo de cada captura ya comprimida. */
  maxStoredBytes: 1.5 * 1024 * 1024,
  maxImageSide: 1600,
  maxActiveGoals: 3,
  textMax: 20000,
}

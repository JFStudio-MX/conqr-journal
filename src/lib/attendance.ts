/**
 * Puntualidad: registro personal, no un control oficial.
 * Retardo a partir de las 9:30: 9:29:59 es a tiempo; 9:30:00 ya es retardo.
 * Si llegas a las 8:30 o antes, puedes salir 30 min antes de la salida de ese día.
 */
import type { Attendance, AttendanceSettings, BonusStage } from '../db/types'
import { addDays, addMonths, eachDay, isoWeekday, minDate, normalizeTime } from './dates'

export type DayStatus =
  | 'antes'
  | 'despues'
  | 'presencial_sin_hora'
  | 'home_office'
  | 'permiso'
  | 'vacaciones'
  | 'no_laborable'
  | 'sin_registro'
  | 'hoy_pendiente'
  | 'no_aplica'
  | 'futuro'
  | 'fuera_periodo'

export const BONUS_NOTE_DEFAULT = 'Bono grande recordado: $5,000; condiciones por confirmar'

export function isBeforeCutoff(time: string | undefined, cutoff: string): boolean {
  const t = normalizeTime(time)
  const c = normalizeTime(cutoff)
  return !!t && !!c && t < c
}

export function classifyRecord(rec: Attendance, cutoff: string): DayStatus {
  switch (rec.kind) {
    case 'presencial':
      if (!normalizeTime(rec.time)) return 'presencial_sin_hora'
      return isBeforeCutoff(rec.time, cutoff) ? 'antes' : 'despues'
    case 'home_office':
      return 'home_office'
    case 'permiso':
      return 'permiso'
    case 'vacaciones':
      return 'vacaciones'
    case 'no_laborable':
      return 'no_laborable'
  }
}

export function isOnsiteDay(date: string, cfg: Pick<AttendanceSettings, 'onsiteDays'>) {
  return cfg.onsiteDays.includes(isoWeekday(date))
}

export function dayStatus(date: string, rec: Attendance | undefined, cfg: AttendanceSettings, today: string): DayStatus {
  if (rec) return classifyRecord(rec, cfg.cutoff)
  if (date > today) return 'futuro'
  if (date < cfg.periodStart || date > cfg.periodEnd) return 'fuera_periodo'
  if (!isOnsiteDay(date, cfg)) return 'no_aplica'
  if (date === today) return 'hoy_pendiente'
  return 'sin_registro'
}

export interface AttendanceStats {
  antes: number
  despues: number
  presencialSinHora: number
  homeOffice: number
  permiso: number
  vacaciones: number
  noLaborable: number
  /** Días presenciales aplicables (antes de hoy) sin ningún registro. */
  sinRegistro: number
  /** Días presenciales con hora registrada: la base del porcentaje. */
  base: number
  /** Proporción 0–1, o null si aún no hay base. */
  pct: number | null
  todayPending: boolean
  periodEndShown: string
}

export function attendanceStats(records: Attendance[], cfg: AttendanceSettings, today: string): AttendanceStats {
  const byDate = new Map(records.map((r) => [r.id, r]))
  const end = minDate(cfg.periodEnd, today)
  const s: AttendanceStats = {
    antes: 0,
    despues: 0,
    presencialSinHora: 0,
    homeOffice: 0,
    permiso: 0,
    vacaciones: 0,
    noLaborable: 0,
    sinRegistro: 0,
    base: 0,
    pct: null,
    todayPending: false,
    periodEndShown: end,
  }
  for (const d of eachDay(cfg.periodStart, end)) {
    const st = dayStatus(d, byDate.get(d), cfg, today)
    if (st === 'antes') s.antes++
    else if (st === 'despues') s.despues++
    else if (st === 'presencial_sin_hora') s.presencialSinHora++
    else if (st === 'home_office') s.homeOffice++
    else if (st === 'permiso') s.permiso++
    else if (st === 'vacaciones') s.vacaciones++
    else if (st === 'no_laborable') s.noLaborable++
    else if (st === 'sin_registro') s.sinRegistro++
    else if (st === 'hoy_pendiente') s.todayPending = true
  }
  s.base = s.antes + s.despues
  s.pct = s.base > 0 ? s.antes / s.base : null
  return s
}

/** Aniversarios de referencia (NO son fechas de pago confirmadas). */
export function stageReferenceDate(startDate: string, months: number): string {
  return addMonths(startDate, months)
}

export function defaultStages(): BonusStage[] {
  return [{ months: 3 }, { months: 6 }, { months: 12 }]
}

export function defaultAttendanceSettings(startDate: string, now: string): AttendanceSettings {
  return {
    id: 'attendance',
    cutoff: '09:30',
    earlyArrival: '08:30',
    earlyLeaveMinutes: 30,
    exitTimes: {},
    onsiteDays: [1, 2, 3, 4, 5],
    periodStart: startDate,
    periodEnd: addDays(addMonths(startDate, 12), -1),
    rulesConfirmed: false,
    rules: '',
    bonusNote: BONUS_NOTE_DEFAULT,
    stages: defaultStages(),
    createdAt: now,
    updatedAt: now,
  }
}

export const STATUS_TEXT: Record<DayStatus, string> = {
  antes: 'A tiempo',
  despues: 'Retardo',
  presencial_sin_hora: 'Presencial sin hora',
  home_office: 'Home office',
  permiso: 'Permiso',
  vacaciones: 'Vacaciones',
  no_laborable: 'No laborable',
  sin_registro: 'Sin registro',
  hoy_pendiente: 'Hoy, pendiente',
  no_aplica: 'No presencial',
  futuro: '',
  fuera_periodo: 'Fuera del periodo',
}

export function cutoffLabel(cutoff: string): string {
  const n = normalizeTime(cutoff)
  if (!n) return cutoff
  const [h, m] = n.split(':').map(Number)
  return `${h}:${String(m).padStart(2, '0')}`
}

export function statusText(st: DayStatus, cutoff: string): string {
  if (st === 'antes') return 'A tiempo'
  if (st === 'despues') return `Retardo (${cutoffLabel(cutoff)} o después)`
  return STATUS_TEXT[st]
}

/** Salida anticipada: si llegaste a la hora temprana o antes (minuto incluido). */
export function earlyLeave(rec: Attendance | undefined, cfg: AttendanceSettings): { eligible: boolean; leaveAt?: string; exit?: string; minutes: number } {
  const minutes = cfg.earlyLeaveMinutes ?? 30
  const early = normalizeTime(cfg.earlyArrival ?? '08:30')
  const t = normalizeTime(rec?.time)
  if (!rec || rec.kind !== 'presencial' || !t || !early || t.slice(0, 5) > early.slice(0, 5)) return { eligible: false, minutes }
  const exit = normalizeTime(cfg.exitTimes?.[String(isoWeekday(rec.id))])
  if (!exit) return { eligible: true, minutes }
  const [h, m] = exit.split(':').map(Number)
  const total = h * 60 + m - minutes
  const pad = (n: number) => String(n).padStart(2, '0')
  const leaveAt = `${pad(Math.floor(total / 60))}:${pad(total % 60)}:00`
  return { eligible: true, leaveAt, exit, minutes }
}

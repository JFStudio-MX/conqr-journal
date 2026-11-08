import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type {
  ActionItem,
  ChangeRequest,
  Meeting,
  Attachment,
  AttendanceSettings,
  Attendance,
  Brand,
  ConflictRow,
  Entry,
  Goal,
  NextStepSettings,
  PrivateSettings,
  ProfileSettings,
  Project,
  Reflection,
  ReviewDoc,
  Stored,
} from '../db/types'
import { todayISO } from '../lib/dates'
import { defaultAttendanceSettings } from '../lib/attendance'
import { useWorkspace } from './session'

export interface AppData {
  entries: Stored<Entry>[]
  brands: Stored<Brand>[]
  projects: Stored<Project>[]
  goals: Stored<Goal>[]
  reflections: Stored<Reflection>[]
  reviews: Stored<ReviewDoc>[]
  attendance: Stored<Attendance>[]
  attachments: Stored<Attachment>[]
  meetings: Stored<Meeting>[]
  actions: Stored<ActionItem>[]
  changes: Stored<ChangeRequest>[]
  conflicts: ConflictRow[]
  profile: ProfileSettings
  attendanceSettings: AttendanceSettings
  nextStep?: NextStepSettings
  privateData?: PrivateSettings
  today: string
}

const Ctx = createContext<AppData | null>(null)

export function useData(): AppData {
  const v = useContext(Ctx)
  if (!v) throw new Error('DataProvider ausente')
  return v
}

const FALLBACK_PROFILE: ProfileSettings = {
  id: 'profile',
  name: 'Joshua',
  fullName: 'Joshua Flores',
  company: 'Conqr',
  team: 'ROJO',
  area: 'Arte Digital',
  startDate: '2026-11-05',
  locale: 'es-MX',
  timezone: 'America/Mexico_City',
  weekStartsOn: 1,
  createdAt: '',
  updatedAt: '',
}

/** "Hoy" en Ciudad de México; se actualiza solo si la app queda abierta pasada la medianoche. */
export function useToday(): string {
  const [t, setT] = useState(() => todayISO())
  useEffect(() => {
    const tick = () => setT(todayISO())
    const i = window.setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(i)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return t
}

export function DataProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { db } = useWorkspace()
  const today = useToday()
  const alive = <T extends { _deleted?: 0 | 1 }>(rows: T[]) => rows.filter((r) => !r._deleted)
  const entries = useLiveQuery(async () => alive(await db.entries.toArray()), [db])
  const brands = useLiveQuery(async () => alive(await db.brands.toArray()), [db])
  const projects = useLiveQuery(async () => alive(await db.projects.toArray()), [db])
  const goals = useLiveQuery(async () => alive(await db.goals.toArray()), [db])
  const reflections = useLiveQuery(async () => alive(await db.reflections.toArray()), [db])
  const reviews = useLiveQuery(async () => alive(await db.reviews.toArray()), [db])
  const attendance = useLiveQuery(async () => alive(await db.attendance.toArray()), [db])
  const attachments = useLiveQuery(async () => alive(await db.attachments.toArray()), [db])
  const settings = useLiveQuery(async () => alive(await db.settings.toArray()), [db])
  const meetings = useLiveQuery(async () => alive(await db.meetings.toArray()), [db])
  const actions = useLiveQuery(async () => alive(await db.actions.toArray()), [db])
  const changes = useLiveQuery(async () => alive(await db.changes.toArray()), [db])
  const conflicts = useLiveQuery(() => db.conflicts.toArray(), [db])

  const value = useMemo<AppData | null>(() => {
    if (!entries || !brands || !projects || !goals || !reflections || !reviews || !attendance || !attachments || !settings || !conflicts || !meetings || !actions || !changes) return null
    const profile = (settings.find((s) => s.id === 'profile') as ProfileSettings | undefined) ?? FALLBACK_PROFILE
    const attendanceSettings =
      (settings.find((s) => s.id === 'attendance') as AttendanceSettings | undefined) ?? defaultAttendanceSettings(profile.startDate, '')
    return {
      entries: entries.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
      brands: brands.sort((a, b) => a.name.localeCompare(b.name, 'es')),
      projects: projects.sort((a, b) => a.name.localeCompare(b.name, 'es')),
      goals,
      reflections,
      reviews: reviews.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      attendance,
      attachments,
      meetings: meetings.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
      actions,
      changes: changes.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      conflicts,
      profile,
      attendanceSettings,
      nextStep: settings.find((s) => s.id === 'nextStep') as NextStepSettings | undefined,
      privateData: settings.find((s) => s.id === 'private') as PrivateSettings | undefined,
      today,
    }
  }, [entries, brands, projects, goals, reflections, reviews, attendance, attachments, settings, conflicts, meetings, actions, changes, today])

  if (!value) return <>{fallback}</>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

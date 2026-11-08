import Dexie from 'dexie'
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { JournalDB, dbNameFor, type WorkspaceMode } from '../db/database'
import { Repo } from '../db/repo'
import { seedDemo, seedInitial } from '../db/seed'
import { todayISO } from '../lib/dates'
import { AUTH_STORAGE_KEY, backendConfigured, supabase } from '../sync/client'
import { SyncEngine, type SyncState } from '../sync/engine'

export interface Workspace {
  mode: WorkspaceMode
  db: JournalDB
  repo: Repo
  engine?: SyncEngine
  user?: { id: string; email?: string }
}

type Status =
  | { status: 'loading' }
  | { status: 'login'; reason?: string; lastEmail?: string }
  | { status: 'ready'; ws: Workspace }
  | { status: 'error'; message: string }

interface SessionApi {
  state: Status
  login: (email: string, password: string) => Promise<void>
  /** Devuelve cuántos cambios quedan sin sincronizar; si force, cierra igual. */
  logout: (force?: boolean) => Promise<{ pending: number; conflicts: number } | null>
  enterDemo: () => void
  exitDemo: () => void
  resetDemo: () => Promise<void>
  discardDeviceData: () => Promise<void>
}

const LAST_USER = 'conqr:lastUser'
const DEMO_FLAG = 'conqr:demo'
const Ctx = createContext<SessionApi | null>(null)

export function useSession() {
  const v = useContext(Ctx)
  if (!v) throw new Error('SessionProvider ausente')
  return v
}

export function useWorkspace(): Workspace {
  const s = useSession().state
  if (s.status !== 'ready') throw new Error('Workspace no listo')
  return s.ws
}

const idle: SyncState = { phase: 'idle', pending: 0, conflicts: 0 }
const noop = () => () => {}
export function useSyncState(): SyncState | null {
  const ws = useWorkspace()
  const e = ws.engine
  const st = useSyncExternalStore(e ? e.subscribe : noop, e ? e.getState : () => idle)
  return e ? st : null
}

function readLastUser(): { id: string; email?: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_USER) || 'null')
    return v && typeof v.id === 'string' ? v : null
  } catch {
    return null
  }
}

async function probeStorage() {
  if (!('indexedDB' in window)) throw new Error('Este navegador no tiene IndexedDB.')
  const probe = new Dexie('conqr-probe')
  probe.version(1).stores({ t: 'k' })
  await probe.open()
  probe.close()
}

function translateAuthError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.'
  if (/email not confirmed/i.test(msg)) return 'Tu correo aún no está confirmado.'
  if (/fetch|network/i.test(msg)) return 'No hay conexión con el servidor. Revisa tu internet.'
  if (/rate limit/i.test(msg)) return 'Demasiados intentos. Espera un momento.'
  return msg
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Status>({ status: 'loading' })
  const wsRef = useRef<Workspace | null>(null)

  const openWorkspace = useCallback((mode: WorkspaceMode, user?: { id: string; email?: string }): Workspace => {
    const db = new JournalDB(dbNameFor(mode, user?.id))
    const repo = new Repo(db, mode, user?.id)
    const ws: Workspace = { mode, db, repo, user }
    if (mode === 'account') {
      const engine = new SyncEngine(db, supabase(), () => {
        void supabase()
          .auth.getSession()
          .then(({ data, error }) => {
            if (!error && !data.session) {
              engine.stop()
              setState({ status: 'login', reason: 'Tu sesión terminó. Entra de nuevo para sincronizar; tus cambios de este dispositivo se conservan.', lastEmail: user?.email })
            }
          })
      })
      ws.engine = engine
      repo.setOnChange(() => {
        void engine.refreshCounts()
        engine.schedule(300)
      })
      // Siembra los datos iniciales solo cuando ya sabemos qué hay en el servidor.
      const unsub = engine.subscribe(() => {
        const st = engine.getState()
        if (st.phase === 'idle' && st.lastSyncedAt) {
          unsub()
          void (async () => {
            if (await seedInitial(repo)) engine.schedule(0)
          })()
        }
      })
    }
    wsRef.current = ws
    return ws
  }, [])

  const startReady = useCallback(async (ws: Workspace) => {
    await ws.db.open()
    if (ws.mode === 'demo') await seedDemo(ws.repo, todayISO())
    if (ws.mode === 'local') await seedInitial(ws.repo)
    setState({ status: 'ready', ws })
    ws.engine?.start()
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await probeStorage()
      } catch (e) {
        setState({ status: 'error', message: `No se puede guardar información en este navegador (${(e as Error).message}). Si estás en modo privado, abre una ventana normal.` })
        return
      }
      if (sessionStorage.getItem(DEMO_FLAG) === '1') return startReady(openWorkspace('demo'))
      if (!backendConfigured) return startReady(openWorkspace('local'))
      const last = readLastUser()
      if (!last) {
        setState({ status: 'login' })
        return
      }
      // Arranque rápido y sin conexión: abrimos la caché de la última cuenta y validamos la sesión en paralelo.
      const ws = openWorkspace('account', last)
      await startReady(ws)
      const { data, error } = await supabase().auth.getSession()
      if (cancelled) return
      if (!error && !data.session) {
        ws.engine?.stop()
        setState({ status: 'login', reason: 'Tu sesión terminó. Entra de nuevo para sincronizar.', lastEmail: last.email })
      } else if (data.session && data.session.user.id !== last.id) {
        ws.engine?.stop()
        setState({ status: 'login', lastEmail: data.session.user.email })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [openWorkspace, startReady])

  const login = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await supabase().auth.signInWithPassword({ email: email.trim(), password })
      if (error || !data.user) throw new Error(translateAuthError(error?.message ?? 'No se pudo iniciar sesión.'))
      const user = { id: data.user.id, email: data.user.email ?? email }
      localStorage.setItem(LAST_USER, JSON.stringify(user))
      wsRef.current?.engine?.stop()
      const ws = openWorkspace('account', user)
      await startReady(ws)
    },
    [openWorkspace, startReady],
  )

  const logout = useCallback(async (force = false) => {
    const ws = wsRef.current
    if (ws?.engine && !force) {
      if (navigator.onLine) await ws.engine.syncNow().catch(() => {})
      const { pending, conflicts } = await ws.engine.refreshCounts()
      if (pending || conflicts) return { pending, conflicts }
    }
    ws?.engine?.stop()
    try {
      await supabase().auth.signOut({ scope: 'local' })
    } catch {
      /* sin conexión: se borra la sesión local de todos modos */
    }
    localStorage.removeItem(AUTH_STORAGE_KEY)
    localStorage.removeItem(LAST_USER)
    if (ws) {
      const name = ws.db.name
      ws.db.close()
      await Dexie.delete(name)
    }
    wsRef.current = null
    setState({ status: 'login' })
    return null
  }, [])

  const discardDeviceData = useCallback(async () => {
    const last = readLastUser()
    wsRef.current?.engine?.stop()
    wsRef.current?.db.close()
    if (last) await Dexie.delete(dbNameFor('account', last.id))
    localStorage.removeItem(LAST_USER)
    localStorage.removeItem(AUTH_STORAGE_KEY)
    wsRef.current = null
    setState({ status: 'login' })
  }, [])

  const enterDemo = useCallback(() => {
    sessionStorage.setItem(DEMO_FLAG, '1')
    location.hash = '#/hoy'
    location.reload()
  }, [])
  const exitDemo = useCallback(() => {
    sessionStorage.removeItem(DEMO_FLAG)
    location.hash = '#/hoy'
    location.reload()
  }, [])
  const resetDemo = useCallback(async () => {
    wsRef.current?.db.close()
    await Dexie.delete(dbNameFor('demo'))
    location.reload()
  }, [])

  return (
    <Ctx.Provider value={{ state, login, logout, enterDemo, exitDemo, resetDemo, discardDeviceData }}>{children}</Ctx.Provider>
  )
}

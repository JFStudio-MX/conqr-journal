import { useEffect, type ReactNode } from 'react'
import { BookOpen, ChartColumn, FileText, FlaskConical, NotebookPen, Plus, Settings2 } from 'lucide-react'
import { navigate, type RouteName } from '../app/router'
import { useSession, useWorkspace } from '../app/session'
import { useData } from '../app/data'
import { useTheme } from '../app/theme'
import { cn } from '../lib/cn'
import { SyncPill } from './SyncCenter'
import { Button } from './ui/ui'

const NAV: { id: RouteName; label: string; short: string; Icon: typeof NotebookPen }[] = [
  { id: 'hoy', label: 'Hoy', short: 'Hoy', Icon: NotebookPen },
  { id: 'diario', label: 'Diario', short: 'Diario', Icon: BookOpen },
  { id: 'progreso', label: 'Progreso', short: 'Progreso', Icon: ChartColumn },
  { id: 'revision', label: 'Mi revisión', short: 'Revisión', Icon: FileText },
]

/** Oculta la barra inferior cuando el teclado del teléfono está abierto. */
function useKeyboardOpen() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const on = () => {
      const open = window.innerHeight - vv.height > 150
      document.documentElement.classList.toggle('kb-open', open)
    }
    vv.addEventListener('resize', on)
    return () => vv.removeEventListener('resize', on)
  }, [])
}

function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 select-none">
      <span className="text-[13px] font-bold tracking-[0.18em] text-ink">CONQR</span>
      <span className={cn('display text-accent-ink italic', compact ? 'text-lg' : 'text-xl')}>Journal</span>
    </span>
  )
}

export function Shell({ route, children }: { route: RouteName; children: ReactNode }) {
  const ws = useWorkspace()
  const { profile } = useData()
  const { exitDemo } = useSession()
  useKeyboardOpen()
  useTheme() // mantiene el tema "Sistema" sincronizado con el sistema operativo

  return (
    <div className="min-h-dvh lg:pl-[248px]">
      <a href="#main" className="sr-only z-[70] rounded-lg bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Saltar al contenido
      </a>

      {/* Escritorio: navegación lateral */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-bg px-4 py-6 lg:flex">
        <a href="#/hoy" className="px-2" aria-label="CONQR Journal, ir a Hoy">
          <Wordmark />
        </a>
        <p className="mt-1 px-2 text-xs text-ink-3">
          {profile.name} · {profile.area}, {profile.team}
        </p>
        <nav aria-label="Secciones" className="mt-8 grid gap-1">
          {NAV.map(({ id, label, Icon }) => (
            <a
              key={id}
              href={`#/${id}`}
              aria-current={route === id ? 'page' : undefined}
              className={cn(
                'relative flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors',
                route === id ? 'bg-surface font-semibold text-ink shadow-soft' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
              )}
            >
              {route === id && <span aria-hidden className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-accent" />}
              <Icon className="size-[18px]" aria-hidden />
              {label}
            </a>
          ))}
        </nav>
        <div className="mt-auto grid gap-3">
          <SyncPill className="w-full justify-start" />
          <a
            href="#/ajustes"
            aria-current={route === 'ajustes' ? 'page' : undefined}
            className={cn('flex h-11 items-center gap-3 rounded-xl px-3 text-[15px]', route === 'ajustes' ? 'bg-surface font-semibold text-ink' : 'text-ink-2 hover:bg-surface-2')}
          >
            <Settings2 className="size-[18px]" aria-hidden /> Ajustes
          </a>
        </div>
      </aside>

      {/* Móvil: barra superior */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/92 pt-[env(safe-area-inset-top)] backdrop-blur-md lg:hidden">
        <div className="flex h-14 items-center gap-2 px-4">
          <a href="#/hoy" aria-label="CONQR Journal, ir a Hoy" className="shrink-0">
            <Wordmark compact />
          </a>
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <SyncPill className="max-w-[46vw]" compact />
            <a href="#/ajustes" aria-label="Ajustes" className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', route === 'ajustes' ? 'bg-surface-2 text-ink' : 'text-ink-2')}>
              <Settings2 className="size-5" />
            </a>
          </div>
        </div>
      </header>

      {ws.mode === 'demo' && (
        <div className="no-print flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-[color-mix(in_oklab,var(--cat-feedback)_40%,transparent)] bg-[color-mix(in_oklab,var(--cat-feedback)_12%,var(--bg))] px-4 py-2 text-center text-sm">
          <FlaskConical className="size-4 text-[var(--cat-feedback)]" aria-hidden />
          <span>
            <strong>Modo demo:</strong> datos ficticios en una base separada. No tocan tu diario.
          </span>
          <Button size="sm" variant="ghost" onClick={exitDemo}>
            Salir del demo
          </Button>
        </div>
      )}
      {ws.mode === 'local' && (
        <div className="no-print border-b border-line bg-surface-2 px-4 py-2 text-center text-sm text-ink-2">
          Sin cuenta: este diario se guarda <strong>solo en este dispositivo</strong> y no se sincroniza.
        </div>
      )}

      <main id="main" tabIndex={-1} className="px-4 pt-5 pb-[calc(104px+env(safe-area-inset-bottom))] outline-none sm:px-6 lg:px-10 lg:pt-9 lg:pb-16">
        {children}
      </main>

      {/* Acceso rápido a registrar desde otras secciones (alcance de pulgar) */}
      {route !== 'hoy' && route !== 'ajustes' && (
        <a
          href="#/hoy"
          className="bottom-nav no-print fixed right-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-2xl bg-[var(--btn-primary)] text-[var(--btn-primary-fg)] shadow-lift lg:hidden"
          aria-label="Registrar algo"
        >
          <Plus className="size-6" />
        </a>
      )}

      {/* Móvil: navegación inferior */}
      <nav aria-label="Secciones" className="bottom-nav no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <ul className="mx-auto grid h-16 max-w-xl grid-cols-4">
          {NAV.map(({ id, short, Icon }) => (
            <li key={id} className="flex">
              <a
                href={`#/${id}`}
                onClick={(e) => {
                  if (route === id) {
                    e.preventDefault()
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  } else navigate(id)
                }}
                aria-current={route === id ? 'page' : undefined}
                className={cn('relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', route === id ? 'text-ink' : 'text-ink-3')}
              >
                {route === id && <span aria-hidden className="absolute top-0 h-[3px] w-8 rounded-b-full bg-accent" />}
                <Icon className="size-[22px]" strokeWidth={route === id ? 2.3 : 1.9} aria-hidden />
                {short}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

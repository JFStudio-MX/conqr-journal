import { Component, type ReactNode } from 'react'
import { SessionProvider, useSession } from './app/session'
import { DataProvider } from './app/data'
import { EntryUiProvider } from './app/entry-ui'
import { MeetingUiProvider } from './app/meeting-ui'
import { useRoute } from './app/router'
import { ToastProvider } from './components/ui/toast'
import { Shell } from './components/Shell'
import { Button } from './components/ui/ui'
import { TodayScreen } from './screens/Today'
import { JournalScreen } from './screens/Journal'
import { ProgressScreen } from './screens/Progress'
import { ReviewScreen } from './screens/Review'
import { SettingsScreen } from './screens/Settings'
import { LoginScreen } from './screens/Login'
import { TestHooks } from './app/test-hooks'

function Splash({ message }: { message?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="text-[13px] font-bold tracking-[0.18em] text-ink">CONQR</span>
      <span className="display -mt-2 text-3xl text-accent-ink italic">Journal</span>
      {message ? <p className="mt-4 max-w-md text-sm text-ink-2">{message}</p> : <span className="mt-4 size-1.5 animate-pulse rounded-full bg-accent" aria-label="Cargando" />}
    </div>
  )
}

/** Si una pantalla falla, se muestra un aviso en vez de una página en blanco. Tus datos no se tocan. */
class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  static getDerivedStateFromProps(p: { resetKey: string }, s: { key: string }) {
    return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="display text-2xl">Algo no salió bien en esta sección</p>
        <p className="mt-2 text-sm text-ink-2">Tus datos están a salvo. Prueba recargar la app.</p>
        <p className="mt-2 text-xs break-words text-ink-3">{this.state.error.message}</p>
        <Button className="mt-5" variant="primary" onClick={() => location.reload()}>
          Recargar
        </Button>
      </div>
    )
  }
}

function Routed() {
  const route = useRoute()
  return (
    <Shell route={route.name}>
      <Boundary resetKey={route.name}>
        {route.name === 'hoy' && <TodayScreen />}
        {route.name === 'diario' && <JournalScreen />}
        {route.name === 'progreso' && <ProgressScreen />}
        {route.name === 'revision' && <ReviewScreen />}
        {route.name === 'ajustes' && <SettingsScreen />}
      </Boundary>
    </Shell>
  )
}

function Gate() {
  const { state } = useSession()
  if (state.status === 'loading') return <Splash />
  if (state.status === 'error') return <Splash message={state.message} />
  if (state.status === 'login') return <LoginScreen reason={state.reason} lastEmail={state.lastEmail} />
  return (
    <DataProvider fallback={<Splash />}>
      <EntryUiProvider>
        <MeetingUiProvider>
          <Routed />
          <TestHooks />
        </MeetingUiProvider>
      </EntryUiProvider>
    </DataProvider>
  )
}

export function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </ToastProvider>
  )
}

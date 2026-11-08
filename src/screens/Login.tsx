import { useState } from 'react'
import { FlaskConical, Lock } from 'lucide-react'
import { useSession } from '../app/session'
import { Button, TextField } from '../components/ui/ui'
import { useConfirm } from '../components/ui/overlay'

export function LoginScreen({ reason, lastEmail }: { reason?: string; lastEmail?: string }) {
  const { login, enterDemo, discardDeviceData } = useSession()
  const [email, setEmail] = useState(lastEmail ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const { ask, node } = useConfirm()

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1100px] flex-col justify-center gap-10 px-5 py-10 lg:flex-row lg:items-center lg:gap-20">
      <section className="max-w-xl">
        <span className="text-[13px] font-bold tracking-[0.18em] text-ink">CONQR</span>
        <h1 className="display mt-1 text-[3.2rem] leading-[0.95] text-ink sm:text-[4.4rem]">
          Tu <span className="text-accent-ink italic">journal</span> de trabajo.
        </h1>
        <p className="mt-5 max-w-md text-lg leading-relaxed text-ink-2">Registra tu día en un minuto, desde el celular o la computadora, y construye la evidencia de tu crecimiento.</p>
      </section>

      <section className="card w-full max-w-md p-6 sm:p-7" aria-labelledby="login-title">
        <h2 id="login-title" className="display text-2xl">
          Entrar
        </h2>
        {reason && <p className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{reason}</p>}
        <form
          className="mt-5 grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError(undefined)
            try {
              await login(email, password)
            } catch (err) {
              setError((err as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          <TextField label="Correo" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField label="Contraseña" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" loading={busy}>
            Entrar
          </Button>
        </form>
        <p className="mt-4 flex gap-2 text-xs leading-relaxed text-ink-3">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Cuenta personal. Tus registros y capturas solo son accesibles con tu sesión (autorización del lado del servidor). La cuenta se crea una sola vez desde el panel de Supabase.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <Button variant="ghost" size="sm" onClick={enterDemo}>
            <FlaskConical className="size-4" /> Ver demo con datos ficticios
          </Button>
          {lastEmail && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const ok = await ask({
                  title: '¿Borrar los datos de este dispositivo?',
                  body: 'Se borrará la copia local de tu diario en este navegador, incluidos cambios que no se hayan sincronizado. Tu cuenta y lo ya sincronizado no se tocan.',
                  confirm: 'Borrar de este dispositivo',
                  tone: 'danger',
                })
                if (ok) await discardDeviceData()
              }}
            >
              Borrar datos de este dispositivo
            </Button>
          )}
        </div>
      </section>
      {node}
    </main>
  )
}

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Download, FlaskConical, LogOut, Monitor, Moon, RefreshCw, Smartphone, Sun, Upload } from 'lucide-react'
import type { PrivateSettings, ProfileSettings } from '../db/types'
import { storageErrorMessage } from '../db/database'
import { base64ToBytes, validateBackupText, type BackupData, type ValidationResult } from '../lib/backup'
import { formatBytes } from '../lib/images'
import { formatDate, formatInstant } from '../lib/dates'
import { plural } from '../lib/text'
import { cn, nowISO } from '../lib/cn'
import type { ImportCounts } from '../db/repo'
import { useData } from '../app/data'
import { useSession, useSyncState, useWorkspace } from '../app/session'
import { APP_VERSION, useExportBackup, useLastBackup } from '../app/backup-io'
import { useInstallPrompt, useTheme, type ThemePref } from '../app/theme'
import { syncLabel } from '../components/SyncCenter'
import { Badge, Button, TextField } from '../components/ui/ui'
import { Modal, useConfirm } from '../components/ui/overlay'
import { useToast } from '../components/ui/toast'

function Block({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="border-t border-line py-7 first:border-t-0 first:pt-0">
      <h2 id={id} className="display mb-4 text-2xl">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function SettingsScreen() {
  const ws = useWorkspace()
  return (
    <div className="mx-auto max-w-[760px]">
      <h1 className="display mb-8 text-[2.3rem] leading-none sm:text-5xl">Ajustes</h1>
      <AccountBlock />
      <Block title="Respaldo" id="s-backup">
        <BackupBlock />
      </Block>
      <Block title="Perfil" id="s-profile">
        <ProfileBlock />
      </Block>
      <Block title="Apariencia" id="s-theme">
        <ThemeBlock />
      </Block>
      <Block title="Datos y privacidad" id="s-privacy">
        <PrivacyBlock />
      </Block>
      <Block title="Instalar en este dispositivo" id="s-install">
        <InstallBlock />
      </Block>
      <Block title="Modo demo" id="s-demo">
        <DemoBlock />
      </Block>
      <p className="mt-4 text-xs text-ink-3">
        CONQR Journal {APP_VERSION} · {ws.mode === 'account' ? 'Cuenta sincronizada' : ws.mode === 'local' ? 'Solo este dispositivo' : 'Demo'} · Sin analítica ni rastreo.
      </p>
    </div>
  )
}

function AccountBlock() {
  const ws = useWorkspace()
  const s = useSyncState()
  const { logout } = useSession()
  const exportBackup = useExportBackup()
  const toast = useToast()
  const [pending, setPending] = useState<{ pending: number; conflicts: number } | null>(null)
  const [busy, setBusy] = useState(false)
  if (ws.mode !== 'account') {
    return (
      <Block title="Cuenta" id="s-account">
        <p className="text-sm text-ink-2">
          {ws.mode === 'demo'
            ? 'Estás en el modo demo. Sal del demo para volver a tu diario.'
            : 'Este despliegue no tiene una cuenta configurada: el diario vive solo en este navegador. Para tener los mismos datos en celular, PC y Mac, configura Supabase siguiendo el README y vuelve a desplegar.'}
        </p>
      </Block>
    )
  }
  const { text, tone } = syncLabel(ws.mode, s)
  return (
    <Block title="Cuenta" id="s-account">
      <dl className="grid gap-2 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-ink-3">Sesión</dt>
          <dd className="font-medium">{ws.user?.email}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-ink-3">Sincronización</dt>
          <dd>
            <Badge tone={tone === 'ok' ? 'ok' : tone === 'danger' ? 'danger' : tone === 'warn' ? 'warn' : 'neutral'}>{text}</Badge>
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="text-ink-3">Última sincronización confirmada</dt>
          <dd>{s?.lastSyncedAt ? formatInstant(s.lastSyncedAt) : '—'}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={async () => {
            const st = await ws.engine?.syncNow()
            toast(st?.phase === 'idle' ? { tone: 'ok', message: 'Sincronizado.' } : { tone: 'error', message: st?.lastError ?? 'No se pudo sincronizar.' })
          }}
        >
          <RefreshCw className="size-4" /> Sincronizar ahora
        </Button>
        <Button
          variant="danger"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            const r = await logout(false)
            setBusy(false)
            if (r) setPending(r)
          }}
        >
          <LogOut className="size-4" /> Cerrar sesión
        </Button>
      </div>
      <p className="mt-3 text-xs text-ink-3">Al cerrar sesión se borra de este dispositivo la copia local del diario (incluidas capturas). Tu cuenta no se toca.</p>
      <Modal
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title="Hay cambios sin sincronizar"
        description={pending ? `${plural(pending.pending, 'cambio pendiente', 'cambios pendientes')}${pending.conflicts ? ` y ${plural(pending.conflicts, 'conflicto', 'conflictos')}` : ''} solo existen en este dispositivo. Si cierras sesión ahora, se perderán.` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                try {
                  await exportBackup()
                  toast({ tone: 'ok', message: 'Respaldo descargado.' })
                } catch (e) {
                  toast({ tone: 'error', message: (e as Error).message })
                }
              }}
            >
              <Download className="size-4" /> Descargar respaldo
            </Button>
            <Button variant="danger" onClick={() => void logout(true)}>
              Cerrar sesión y borrar de este dispositivo
            </Button>
          </>
        }
      />
    </Block>
  )
}

function BackupBlock() {
  const ws = useWorkspace()
  const { privateData } = useData()
  const last = useLastBackup()
  const exportBackup = useExportBackup()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[] | null>(null)
  const [preview, setPreview] = useState<{ res: Extract<ValidationResult, { ok: true }>; plans: Record<'merge' | 'replace', ImportCounts>; fileName: string } | null>(null)
  const [strategy, setStrategy] = useState<'merge' | 'replace'>('merge')
  const [ack, setAck] = useState(false)
  const [importing, setImporting] = useState(false)

  const onFile = async (file: File) => {
    setBusy(true)
    try {
      const res = await validateBackupText(await file.text(), nowISO())
      if (!res.ok) {
        setErrors(res.errors)
        return
      }
      if (ws.engine && navigator.onLine) await ws.engine.syncNow().catch(() => {})
      const plans = { merge: await ws.repo.planImport(res.data, 'merge'), replace: await ws.repo.planImport(res.data, 'replace') }
      setStrategy('merge')
      setAck(false)
      setPreview({ res, plans, fileName: file.name })
    } catch (e) {
      setErrors([`No se pudo leer el archivo: ${(e as Error).message}`])
    } finally {
      setBusy(false)
    }
  }

  const runImport = async () => {
    if (!preview) return
    setImporting(true)
    try {
      const data: BackupData = { ...preview.res.data }
      // El sueldo respeta tu preferencia: si no lo sincronizas, se guarda solo en este dispositivo.
      const priv = data.settings.find((s) => s.id === 'private') as PrivateSettings | undefined
      if (priv && !privateData) {
        data.settings = data.settings.filter((s) => s.id !== 'private')
        await ws.repo.setLocal('private', priv)
      }
      const files = new Map<string, Blob>()
      for (const f of data.files) files.set(f.id, new Blob([base64ToBytes(f.base64) as BlobPart], { type: f.mime }))
      const c = await ws.repo.importBackup(data, strategy, files)
      toast({ tone: 'ok', message: `Importación completa: ${c.added} nuevos, ${c.updated} actualizados, ${c.unchanged} sin cambios${c.keptLocal ? `, ${c.keptLocal} conservados (los tuyos eran más recientes)` : ''}${c.removed ? `, ${c.removed} reemplazados` : ''}.` })
      setPreview(null)
    } catch (e) {
      toast({ tone: 'error', message: `La importación falló y no se aplicó ningún cambio. ${storageErrorMessage(e)}`, duration: 9000 })
    } finally {
      setImporting(false)
    }
  }

  const p = preview?.res.summary
  const plan = preview?.plans[strategy]
  return (
    <div>
      <p className="text-sm leading-relaxed text-ink-2">
        Un respaldo es un archivo con <strong>todo</strong> tu diario —incluidas capturas, juntas y asistencia— que guardas tú.{' '}
        {ws.mode === 'account' ? 'La sincronización no es un respaldo: si borras algo, se borra en todos tus dispositivos.' : 'Si se borran los datos del navegador, el respaldo es la única copia.'}
      </p>
      <p className="mt-2 text-sm">
        Último respaldo descargado en este dispositivo: <strong>{last ? formatInstant(last) : 'nunca'}</strong>
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="primary"
          loading={busy && !preview}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await exportBackup()
              toast({ tone: r.missing ? 'info' : 'ok', message: r.missing ? `Respaldo descargado. ${r.missing} captura(s) no se pudieron incluir (sin conexión).` : `Respaldo descargado: ${plural(r.entries, 'registro', 'registros')}, ${plural(r.files, 'captura', 'capturas')}.` })
            } catch (e) {
              toast({ tone: 'error', message: `No se pudo crear el respaldo: ${(e as Error).message}` })
            } finally {
              setBusy(false)
            }
          }}
        >
          <Download className="size-4" /> Descargar respaldo completo
        </Button>
        <Button onClick={() => fileRef.current?.click()} loading={busy && !!preview}>
          <Upload className="size-4" /> Importar respaldo
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Archivo de respaldo"
          data-testid="import-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void onFile(f)
          }}
        />
      </div>
      <p className="mt-3 text-xs text-ink-3">El archivo incluye datos privados (sueldo, si lo registraste). Guárdalo en un lugar seguro.</p>

      <Modal open={!!errors} onOpenChange={(o) => !o && setErrors(null)} title="No se puede importar este archivo" description="Tus datos actuales no se modificaron." footer={<Button onClick={() => setErrors(null)}>Entendido</Button>}>
        <ul className="grid list-disc gap-1 pl-5 text-sm text-danger" data-testid="import-errors">
          {errors?.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </Modal>

      <Modal
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        title="Vista previa de la importación"
        description={preview?.fileName}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Cancelar
            </Button>
            <Button variant={strategy === 'replace' ? 'danger' : 'primary'} disabled={strategy === 'replace' && !ack} loading={importing} onClick={() => void runImport()} data-testid="import-confirm">
              {strategy === 'replace' ? 'Reemplazar todo' : 'Combinar'}
            </Button>
          </>
        }
      >
        {p && plan && (
          <div className="grid gap-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <dt className="text-ink-3">Creado</dt>
              <dd>{p.exportedAt ? formatInstant(p.exportedAt) : '—'}</dd>
              <dt className="text-ink-3">Registros</dt>
              <dd>
                {p.counts.entries}
                {p.entriesRange ? ` (${formatDate(p.entriesRange[0], 'dayMonth')} – ${formatDate(p.entriesRange[1], 'medium')})` : ''}
              </dd>
              <dt className="text-ink-3">Juntas · cambios · acciones</dt>
              <dd>
                {p.counts.meetings} · {p.counts.changes} · {p.counts.actions}
              </dd>
              <dt className="text-ink-3">Proyectos · objetivos · asistencia</dt>
              <dd>
                {p.counts.projects} · {p.counts.goals} · {p.counts.attendance}
              </dd>
              <dt className="text-ink-3">Capturas</dt>
              <dd>
                {p.counts.files} ({formatBytes(p.attachmentBytes)})
              </dd>
              {p.workspace === 'demo' && (
                <>
                  <dt className="text-warn">Aviso</dt>
                  <dd className="text-warn">Este respaldo viene del modo demo (datos ficticios).</dd>
                </>
              )}
              {p.hasPrivate && (
                <>
                  <dt className="text-ink-3">Privado</dt>
                  <dd>Incluye datos de sueldo</dd>
                </>
              )}
            </dl>
            {preview.res.warnings.map((w) => (
              <p key={w} className="rounded-xl bg-warn-soft px-3 py-2 text-warn">
                {w}
              </p>
            ))}
            <fieldset className="grid gap-2">
              <legend className="mb-1 font-medium">¿Cómo importar?</legend>
              {(['merge', 'replace'] as const).map((sv) => (
                <label key={sv} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5', strategy === sv ? 'border-ink-2 bg-surface-2' : 'border-line')}>
                  <input type="radio" name="strategy" className="mt-1 accent-[var(--accent-ink)]" checked={strategy === sv} onChange={() => setStrategy(sv)} />
                  <span>
                    <span className="block font-semibold">{sv === 'merge' ? 'Combinar (recomendado)' : 'Reemplazar todo'}</span>
                    <span className="block text-ink-2">
                      {sv === 'merge'
                        ? `Agrega ${preview.plans.merge.added}, actualiza ${preview.plans.merge.updated} (la copia del respaldo es más reciente), conserva ${preview.plans.merge.keptLocal} tuyos más recientes; ${preview.plans.merge.unchanged} ya son iguales. Duplicados detectados por identificador.`
                        : `Deja exactamente lo del respaldo: ${preview.plans.replace.added} nuevos, ${preview.plans.replace.updated} reemplazados y ${preview.plans.replace.removed} actuales eliminados.`}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            {strategy === 'replace' && (
              <label className="flex items-start gap-3 rounded-xl bg-danger-soft px-3 py-2.5 text-danger">
                <input type="checkbox" className="mt-1 size-5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>
                  Entiendo que se reemplazarán mis datos actuales{ws.mode === 'account' ? ' en mi cuenta y en todos mis dispositivos' : ''}. (Te sugerimos descargar un respaldo antes.)
                </span>
              </label>
            )}
            <p className="text-xs text-ink-3">La importación es todo o nada: si algo falla, tus datos quedan como estaban.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}

function ProfileBlock() {
  const { profile } = useData()
  const { repo } = useWorkspace()
  const toast = useToast()
  const [p, setP] = useState<ProfileSettings>(profile)
  useEffect(() => setP(profile), [profile])
  const set = (k: keyof ProfileSettings, v: string) => setP({ ...p, [k]: v })
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await repo.putSettings({ ...p, createdAt: p.createdAt || nowISO() })
          toast({ tone: 'ok', message: 'Perfil guardado.' })
        } catch (err) {
          toast({ tone: 'error', message: storageErrorMessage(err) })
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Nombre" value={p.name} onChange={(e) => set('name', e.target.value)} />
        <TextField label="Cómo te saluda la app" value={p.nickname ?? ''} onChange={(e) => set('nickname', e.target.value)} placeholder="Josh" />
        <TextField label="Nombre completo (para informes)" value={p.fullName} onChange={(e) => set('fullName', e.target.value)} />
        <TextField label="Empresa" value={p.company} onChange={(e) => set('company', e.target.value)} />
        <TextField label="Área" value={p.area} onChange={(e) => set('area', e.target.value)} />
        <TextField label="Equipo" value={p.team} onChange={(e) => set('team', e.target.value)} />
        <TextField label="Fecha de ingreso" type="date" value={p.startDate} onChange={(e) => e.target.value && set('startDate', e.target.value)} />
        <div className="grid gap-1.5 text-sm">
          <span className="font-medium">Zona horaria y semana</span>
          <span className="text-ink-2">America/Mexico_City · lunes a domingo · español de México</span>
        </div>
      </div>
      <Button type="submit" variant="secondary" className="justify-self-start">
        Guardar perfil
      </Button>
    </form>
  )
}

function ThemeBlock() {
  const [pref, setPref] = useTheme()
  const opts: [ThemePref, string, typeof Sun][] = [
    ['system', 'Sistema', Monitor],
    ['light', 'Claro', Sun],
    ['dark', 'Oscuro', Moon],
  ]
  return (
    <div role="radiogroup" aria-label="Tema" className="flex flex-wrap gap-2">
      {opts.map(([id, label, Icon]) => (
        <button key={id} type="button" role="radio" aria-checked={pref === id} onClick={() => setPref(id)} className={cn('inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm', pref === id ? 'border-ink-2 bg-surface-2 font-semibold' : 'border-line-strong')}>
          <Icon className="size-4" aria-hidden /> {label}
        </button>
      ))}
    </div>
  )
}

function PrivacyBlock() {
  const ws = useWorkspace()
  const [est, setEst] = useState<{ usage?: number; quota?: number; persisted?: boolean } | null>(null)
  const toast = useToast()
  const load = async () => {
    const e = await navigator.storage?.estimate?.().catch(() => undefined)
    const persisted = await navigator.storage?.persisted?.().catch(() => undefined)
    setEst({ usage: e?.usage, quota: e?.quota, persisted })
  }
  useEffect(() => {
    void load()
  }, [])
  return (
    <div className="grid gap-4 text-sm leading-relaxed text-ink-2">
      <ul className="grid list-disc gap-1.5 pl-5">
        {ws.mode === 'account' ? (
          <>
            <li>Tus datos se guardan en tu cuenta (Supabase) y cada registro y archivo solo es accesible con tu sesión: la autorización la aplica el servidor (Row Level Security).</li>
            <li>Este dispositivo guarda una copia para usar la app sin conexión. Al cerrar sesión, esa copia se borra.</li>
            <li>Las capturas se guardan en almacenamiento privado; nunca se publican con enlaces abiertos.</li>
            <li>La sincronización no es un respaldo: descarga respaldos de vez en cuando.</li>
          </>
        ) : (
          <>
            <li>Los datos permanecen en este navegador y dispositivo.</li>
            <li>Borrar los datos del navegador puede eliminarlos.</li>
            <li>Abrir la app en otro dispositivo no sincroniza el diario.</li>
          </>
        )}
        <li>La app no tiene analítica ni rastreo, y no envía tus registros a ningún servicio de IA.</li>
        <li>Las transcripciones de juntas no se incluyen en tus informes profesionales.</li>
      </ul>
      <div className="rounded-2xl bg-surface-2 p-4">
        <p>
          Espacio usado en este dispositivo: <strong>{est?.usage !== undefined ? formatBytes(est.usage) : '—'}</strong>
          {est?.quota ? ` de ${formatBytes(est.quota)} disponibles` : ''}
        </p>
        <p className="mt-1">
          Almacenamiento persistente: <strong>{est?.persisted === undefined ? 'no disponible' : est.persisted ? 'activado' : 'no activado'}</strong>
        </p>
        {est?.persisted === false && (
          <Button
            size="sm"
            className="mt-3"
            onClick={async () => {
              const ok = await navigator.storage.persist().catch(() => false)
              toast({ tone: ok ? 'ok' : 'info', message: ok ? 'El navegador conservará los datos de la app.' : 'El navegador no lo concedió (suele concederse al instalar la app).' })
              void load()
            }}
          >
            Pedir que el navegador no borre los datos
          </Button>
        )}
      </div>
    </div>
  )
}

function InstallBlock() {
  const install = useInstallPrompt()
  const toast = useToast()
  if (install.standalone) return <p className="text-sm text-ok">La app ya está instalada en este dispositivo.</p>
  return (
    <div className="grid gap-3 text-sm text-ink-2">
      {install.available && (
        <Button
          variant="primary"
          className="justify-self-start"
          onClick={async () => {
            const ok = await install.prompt()
            if (ok) toast({ tone: 'ok', message: 'App instalada.' })
          }}
        >
          <Smartphone className="size-4" /> Instalar app
        </Button>
      )}
      <ul className="grid list-disc gap-1 pl-5">
        <li>
          <strong>iPhone/iPad (Safari):</strong> Compartir → “Agregar a inicio”.
        </li>
        <li>
          <strong>Android (Chrome):</strong> menú ⋮ → “Instalar app”.
        </li>
        <li>
          <strong>Windows (Chrome/Edge):</strong> icono de instalar en la barra de direcciones.
        </li>
        <li>
          <strong>Mac (Safari):</strong> Archivo → “Agregar al Dock”. En Chrome: icono de instalar.
        </li>
      </ul>
      <p className="text-xs text-ink-3">También funciona entrando a la dirección web, sin instalar nada.</p>
    </div>
  )
}

function DemoBlock() {
  const ws = useWorkspace()
  const { enterDemo, exitDemo, resetDemo } = useSession()
  const { ask, node } = useConfirm()
  return (
    <div className="text-sm text-ink-2">
      <p>Datos ficticios para probar la app. Viven en una base separada de este navegador y nunca se mezclan con tu diario ni se sincronizan.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {ws.mode === 'demo' ? (
          <>
            <Button onClick={exitDemo}>Salir del demo</Button>
            <Button
              variant="ghost"
              onClick={async () => {
                if (await ask({ title: '¿Reiniciar el demo?', body: 'Se borran solo los datos ficticios.', confirm: 'Reiniciar' })) await resetDemo()
              }}
            >
              Reiniciar datos de demo
            </Button>
          </>
        ) : (
          <Button onClick={enterDemo}>
            <FlaskConical className="size-4" /> Abrir modo demo
          </Button>
        )}
      </div>
      {node}
    </div>
  )
}

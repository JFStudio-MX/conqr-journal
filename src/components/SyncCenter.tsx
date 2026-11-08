import { useState } from 'react'
import { CircleCheck, CloudOff, CloudUpload, GitMerge, HardDrive, RefreshCw, TriangleExclamationPoint } from 'lucide-react'
import type { CollectionName, ConflictRow } from '../db/types'
import { stableStringify } from '../lib/backup'
import { CATEGORY_BY_ID, STATUS_LABEL } from '../lib/constants'
import { formatDate, formatInstant } from '../lib/dates'
import { cn } from '../lib/cn'
import { useData } from '../app/data'
import { useSyncState, useWorkspace } from '../app/session'
import { Badge, Button } from './ui/ui'
import { Sheet } from './ui/overlay'
import { useToast } from './ui/toast'
import type { SyncState } from '../sync/engine'

export function shortLabel(text: string): string {
  return text.replace('Solo en este dispositivo', 'Local').replace('Pendiente de sincronizar', 'Pendiente').replace('Error al sincronizar', 'Error').replace('Sincronizando…', 'Sincronizando')
}

export function syncLabel(mode: string, s: SyncState | null): { text: string; tone: 'ok' | 'warn' | 'danger' | 'muted'; Icon: typeof CircleCheck } {
  if (mode === 'demo') return { text: 'Demo', tone: 'muted', Icon: HardDrive }
  if (mode === 'local' || !s) return { text: 'Solo en este dispositivo', tone: 'muted', Icon: HardDrive }
  if (s.conflicts) return { text: `${s.conflicts} ${s.conflicts === 1 ? 'conflicto' : 'conflictos'}`, tone: 'danger', Icon: GitMerge }
  if (s.phase === 'error') return { text: 'Error al sincronizar', tone: 'danger', Icon: TriangleExclamationPoint }
  if (s.phase === 'offline') return { text: s.pending ? `Pendiente de sincronizar (${s.pending})` : 'Sin conexión', tone: 'warn', Icon: CloudOff }
  if (s.pending) return { text: `Pendiente de sincronizar (${s.pending})`, tone: 'warn', Icon: CloudUpload }
  if (s.phase === 'syncing') return { text: 'Sincronizando…', tone: 'muted', Icon: RefreshCw }
  if (s.lastSyncedAt) return { text: 'Sincronizado', tone: 'ok', Icon: CircleCheck }
  return { text: 'Conectando…', tone: 'muted', Icon: RefreshCw }
}

export function SyncPill({ className, compact }: { className?: string; compact?: boolean }) {
  const { mode } = useWorkspace()
  const s = useSyncState()
  const [open, setOpen] = useState(false)
  const { text, tone, Icon } = syncLabel(mode, s)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex h-9 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium',
          tone === 'ok' && 'border-[color-mix(in_oklab,var(--ok)_35%,transparent)] text-ok',
          tone === 'warn' && 'border-[color-mix(in_oklab,var(--warn)_40%,transparent)] bg-warn-soft text-warn',
          tone === 'danger' && 'border-[color-mix(in_oklab,var(--danger)_40%,transparent)] bg-danger-soft text-danger',
          tone === 'muted' && 'border-line-strong text-ink-2',
          className,
        )}
        aria-label={`Estado: ${text}. Ver detalles`}
        data-testid="sync-pill"
      >
        <Icon className={cn('size-3.5 shrink-0', s?.phase === 'syncing' && 'spin')} aria-hidden />
        <span className="truncate">{compact ? shortLabel(text) : text}</span>
      </button>
      <SyncSheet open={open} onOpenChange={setOpen} />
    </>
  )
}

export function SyncSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { mode, engine, user } = useWorkspace()
  const s = useSyncState()
  const { conflicts } = useData()
  const toast = useToast()
  const { text } = syncLabel(mode, s)
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Sincronización" description={mode === 'account' ? user?.email : undefined} wide={conflicts.length > 0}>
      <div className="grid gap-5 pb-4">
        {mode !== 'account' ? (
          <p className="text-sm text-ink-2">
            {mode === 'demo'
              ? 'Estás en el modo demo: datos ficticios guardados aparte, en este navegador. No se sincronizan ni tocan tu diario.'
              : 'Este despliegue no tiene cuenta configurada: el diario se guarda solo en este navegador y dispositivo. Para usarlo en celular, PC y Mac con los mismos datos, configura Supabase (ver README).'}
          </p>
        ) : (
          <>
            <dl className="grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-3">Estado</dt>
                <dd className="font-medium">{text}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-3">Cambios en este dispositivo por subir</dt>
                <dd className="tabular font-medium">{s?.pending ?? 0}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-3">Última sincronización confirmada</dt>
                <dd className="font-medium">{s?.lastSyncedAt ? formatInstant(s.lastSyncedAt) : 'Aún no en esta sesión'}</dd>
              </div>
              {s?.lastError && (
                <div className="rounded-xl bg-danger-soft px-3 py-2 text-danger" role="alert">
                  {s.lastError}
                </div>
              )}
            </dl>
            <p className="text-xs leading-relaxed text-ink-3">
              Todo se guarda primero en este dispositivo y se sube a tu cuenta al guardar, al volver a la app y al recuperar internet. “Sincronizado” solo aparece después de que el servidor confirma.
            </p>
            <Button
              variant="secondary"
              onClick={async () => {
                const st = await engine?.syncNow()
                if (st?.phase === 'idle') toast({ tone: 'ok', message: 'Sincronizado.' })
                else toast({ tone: 'error', message: st?.lastError ?? 'No se pudo sincronizar.' })
              }}
              disabled={!navigator.onLine}
            >
              <RefreshCw className="size-4" /> Sincronizar ahora
            </Button>
          </>
        )}
        {conflicts.length > 0 && <ConflictList conflicts={conflicts} />}
      </div>
    </Sheet>
  )
}

const COLLECTION_LABEL: Record<CollectionName, string> = {
  entries: 'Registro',
  brands: 'Marca',
  projects: 'Proyecto',
  goals: 'Objetivo',
  reflections: 'Revisión semanal',
  reviews: 'Revisión profesional',
  attendance: 'Asistencia',
  settings: 'Ajuste',
  attachments: 'Captura',
  meetings: 'Junta',
  transcripts: 'Texto original de junta',
  actions: 'Acción de junta',
  changes: 'Cambio solicitado',
}
const FIELD_LABEL: Record<string, string> = {
  text: 'Texto',
  date: 'Fecha',
  categories: 'Categorías',
  projectId: 'Proyecto',
  brandId: 'Marca',
  status: 'Estado',
  outcome: 'Resultado',
  contribution: 'Contribución',
  collaborators: 'Colaboradores',
  skills: 'Habilidades',
  timeSpentMin: 'Tiempo (min)',
  feedback: 'Feedback',
  links: 'Enlaces',
  attachmentIds: 'Capturas',
  nextStep: 'Próximo paso',
  timeSaving: 'Ahorro de tiempo',
  evidence: 'Evidencia',
  pending: 'Por confirmar',
  kind: 'Tipo',
  time: 'Hora',
  title: 'Título',
  name: 'Nombre',
}

function fmt(key: string, v: unknown, projects: { id: string; name: string }[], brands: { id: string; name: string }[]): string {
  if (v === undefined || v === null || v === '') return '—'
  if (key === 'categories' && Array.isArray(v)) return v.map((c) => CATEGORY_BY_ID[c as keyof typeof CATEGORY_BY_ID]?.label ?? c).join(', ') || '—'
  if (key === 'projectId') return projects.find((p) => p.id === v)?.name ?? String(v)
  if (key === 'brandId') return brands.find((b) => b.id === v)?.name ?? String(v)
  if (key === 'status') return STATUS_LABEL[v as keyof typeof STATUS_LABEL] ?? String(v)
  if (key === 'date' && typeof v === 'string') return formatDate(v, 'medium')
  if (key === 'attachmentIds' && Array.isArray(v)) return `${v.length}`
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function ConflictList({ conflicts }: { conflicts: ConflictRow[] }) {
  const { engine } = useWorkspace()
  const { projects, brands } = useData()
  const toast = useToast()
  const [busy, setBusy] = useState<string>()
  const run = async (key: string, fn: () => Promise<void>, msg: string) => {
    setBusy(key)
    try {
      await fn()
      toast({ tone: 'ok', message: msg })
    } catch (e) {
      toast({ tone: 'error', message: (e as Error).message })
    } finally {
      setBusy(undefined)
    }
  }
  return (
    <section aria-labelledby="conf-title" className="grid gap-4">
      <div>
        <h3 id="conf-title" className="display text-lg">
          Conflictos por resolver
        </h3>
        <p className="text-sm text-ink-2">El mismo elemento cambió en dos dispositivos. Ninguna versión se ha sobrescrito: elige qué conservar.</p>
      </div>
      {conflicts.map((c) => {
        const keys = [...new Set([...Object.keys(c.local ?? {}), ...Object.keys(c.remote ?? {})])].filter(
          (k) => !['id', 'createdAt', 'updatedAt'].includes(k) && stableStringify((c.local ?? {})[k]) !== stableStringify((c.remote ?? {})[k]),
        )
        const label = COLLECTION_LABEL[c.collection]
        const when = (c.local?.date ?? c.remote?.date) as string | undefined
        return (
          <article key={c.key} className="rounded-2xl border border-[color-mix(in_oklab,var(--danger)_35%,transparent)] p-4">
            <p className="text-sm font-semibold">
              {label}
              {when ? ` · ${formatDate(when, 'medium')}` : ''}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(['local', 'remote'] as const).map((side) => {
                const deleted = side === 'local' ? c.localDeleted : c.remoteDeleted
                const data = side === 'local' ? c.local : c.remote
                return (
                  <div key={side} className="min-w-0 rounded-xl bg-surface-2 p-3">
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink-3 uppercase">
                      {side === 'local' ? 'Este dispositivo' : 'Otro dispositivo'}
                      {side === 'remote' && c.remoteUpdatedAt && <span className="font-normal normal-case">· {formatInstant(c.remoteUpdatedAt)}</span>}
                    </p>
                    {deleted ? (
                      <Badge tone="danger">Eliminado aquí</Badge>
                    ) : (
                      <dl className="grid gap-1.5 text-sm">
                        {(keys.length ? keys : ['text']).map((k) => (
                          <div key={k} className="min-w-0">
                            <dt className="text-xs text-ink-3">{FIELD_LABEL[k] ?? k}</dt>
                            <dd className="break-words whitespace-pre-line">{fmt(k, data?.[k], projects, brands)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" loading={busy === c.key + 'l'} onClick={() => run(c.key + 'l', () => engine!.keepLocal(c), 'Se conservó la versión de este dispositivo.')}>
                {c.localDeleted ? 'Mantener eliminado' : 'Conservar la de este dispositivo'}
              </Button>
              <Button size="sm" loading={busy === c.key + 'r'} onClick={() => run(c.key + 'r', () => engine!.keepRemote(c), 'Se conservó la versión del otro dispositivo.')}>
                {c.remoteDeleted ? 'Aceptar eliminación' : 'Conservar la del otro dispositivo'}
              </Button>
              {c.collection === 'entries' && !c.localDeleted && !c.remoteDeleted && (
                <Button size="sm" variant="ghost" loading={busy === c.key + 'b'} onClick={() => run(c.key + 'b', () => engine!.keepBoth(c), 'Se conservaron ambas versiones como registros separados.')}>
                  Conservar ambas
                </Button>
              )}
            </div>
          </article>
        )
      })}
    </section>
  )
}

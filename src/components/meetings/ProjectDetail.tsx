import { useState } from 'react'
import { ArrowUpRight, Plus, Users } from 'lucide-react'
import type { ChangeStatus } from '../../db/types'
import { CHANGE_STATUSES } from '../../lib/constants'
import { formatDate } from '../../lib/dates'
import { pendingReviewCount } from '../../lib/meetings'
import { plural } from '../../lib/text'
import { cn } from '../../lib/cn'
import { useData } from '../../app/data'
import { navigate } from '../../app/router'
import { useMeetingUi } from '../../app/meeting-ui'
import { Badge, Button } from '../ui/ui'
import { Sheet } from '../ui/overlay'
import { ActionEditor, ActionRow, ChangeCard } from './parts'

export function ProjectDetailSheet({ projectId, onClose }: { projectId: string | null; onClose: () => void }) {
  const { projects, brands, entries, meetings, actions, changes } = useData()
  const { newMeeting, openMeeting, editChange } = useMeetingUi()
  const [filter, setFilter] = useState<ChangeStatus | 'abiertos' | 'todos'>('abiertos')
  const [newAction, setNewAction] = useState(false)
  const p = projectId ? projects.find((x) => x.id === projectId) : undefined
  if (!projectId || !p) return null
  const brand = p.brandId && !p.brandUnconfirmed ? brands.find((b) => b.id === p.brandId) : undefined
  const pMeetings = meetings.filter((m) => m.projectId === p.id)
  const pActions = actions.filter((a) => a.projectId === p.id)
  const confirmed = pActions.filter((a) => a.status === 'confirmada').sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
  const toReviewActions = pActions.filter((a) => a.status === 'por_revisar')
  const pChanges = changes.filter((c) => c.projectId === p.id)
  const replaced = new Set(pChanges.map((c) => c.supersedesId).filter(Boolean))
  const shown = pChanges.filter((c) => {
    if (filter === 'todos') return true
    if (filter === 'abiertos') return c.status !== 'aprobado' && !replaced.has(c.id)
    return c.status === filter
  })
  const nEntries = entries.filter((e) => e.projectId === p.id && !e.pending).length

  return (
    <Sheet open={!!projectId} onOpenChange={(o) => !o && onClose()} title={p.name} description={[brand?.name ?? (p.brandUnconfirmed ? 'Marca por confirmar' : 'Sin marca'), p.description].filter(Boolean).join(' · ')} wide>
      <div className="grid gap-7 pb-8">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => newMeeting({ projectId: p.id })}>
            <Users className="size-4" /> Nueva junta
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              onClose()
              navigate('diario', { project: p.id })
            }}
          >
            {plural(nEntries, 'registro', 'registros')} en el diario <ArrowUpRight className="size-4" />
          </Button>
        </div>

        <section aria-labelledby="pd-actions">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 id="pd-actions" className="display text-lg">
              Pendientes confirmados
            </h3>
            <Button size="sm" onClick={() => setNewAction(true)}>
              <Plus className="size-4" /> Acción
            </Button>
          </div>
          {confirmed.length ? (
            <ul className="grid gap-2">
              {confirmed.map((a) => (
                <ActionRow key={a.id} action={a} showContext />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">Sin pendientes confirmados.</p>
          )}
          {toReviewActions.length > 0 && <p className="mt-2 text-sm text-warn">{plural(toReviewActions.length, 'acción por revisar', 'acciones por revisar')} en las juntas (no cuentan como pendientes hasta confirmarlas).</p>}
          <ActionEditor open={newAction} onClose={() => setNewAction(false)} projectId={p.id} />
        </section>

        <section aria-labelledby="pd-changes">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 id="pd-changes" className="display text-lg">
              Registro de cambios
            </h3>
            <Button size="sm" onClick={() => editChange({ projectId: p.id })}>
              <Plus className="size-4" /> Cambio
            </Button>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar cambios">
            {(
              [
                ['abiertos', 'Abiertos'],
                ...CHANGE_STATUSES.map((s) => [s.id, s.label]),
                ['todos', 'Historial completo'],
              ] as [typeof filter, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={cn('h-9 rounded-full border px-3 text-sm', filter === id ? 'border-ink-2 bg-surface-2 font-semibold' : 'border-line-strong text-ink-2')}
              >
                {label}
              </button>
            ))}
          </div>
          {shown.length ? (
            <div className="grid gap-2">
              {shown.map((c) => (
                <ChangeCard key={c.id} change={c} all={pChanges} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-3">{pChanges.length ? 'Ningún cambio con este filtro.' : 'Sin cambios registrados.'}</p>
          )}
        </section>

        <section aria-labelledby="pd-meetings">
          <h3 id="pd-meetings" className="display mb-3 text-lg">
            Juntas
          </h3>
          {pMeetings.length ? (
            <ul className="grid gap-2">
              {pMeetings.map((m) => {
                const n = pendingReviewCount({ meeting: m, actions: actions.filter((a) => a.meetingId === m.id), changes: changes.filter((c) => c.meetingId === m.id) })
                return (
                  <li key={m.id}>
                    <button type="button" onClick={() => openMeeting(m.id)} className="flex w-full flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-left hover:bg-surface-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-ink-3">{formatDate(m.date, 'medium')}</span>
                        <span className="block font-medium text-ink">{m.title}</span>
                      </span>
                      {n > 0 && <Badge tone="warn">{n} por revisar</Badge>}
                      {m.closedAt ? <Badge tone="ok">Cerrada</Badge> : <Badge tone="outline">Abierta</Badge>}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">Sin juntas en este proyecto.</p>
          )}
        </section>
      </div>
    </Sheet>
  )
}

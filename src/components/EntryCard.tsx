import { CloudUpload, Copy, Ellipsis, GitMerge, Paperclip, Pencil, Star, Trash, CircleCheck, Clock3 } from 'lucide-react'
import type { Entry, Stored } from '../db/types'
import { STATUS_LABEL } from '../lib/constants'
import { cn } from '../lib/cn'
import { formatMinutes } from '../lib/dates'
import { useData } from '../app/data'
import { useWorkspace } from '../app/session'
import { useEntryUi } from '../app/entry-ui'
import { CategoryIcon, projectAndBrand } from './bits'
import { Badge, Button } from './ui/ui'
import { Menu, MenuItem, MenuSeparator } from './ui/overlay'

export function EntryCard({ entry, fresh, showDate }: { entry: Stored<Entry>; fresh?: boolean; showDate?: string }) {
  const { projects, brands } = useData()
  const { mode } = useWorkspace()
  const ui = useEntryUi()
  const { project, brand } = projectAndBrand(entry, projects, brands)
  const pendingSync = mode === 'account' && entry._dirty === 1 && !entry._conflict
  const meta: string[] = []
  if (project) meta.push(project.name)
  if (brand) meta.push(brand.name)
  if (entry.status) meta.push(STATUS_LABEL[entry.status])
  if (entry.timeSpentMin) meta.push(formatMinutes(entry.timeSpentMin))

  return (
    <article
      className={cn(
        'group relative flex gap-3 rounded-2xl border border-line bg-surface p-3.5 transition-shadow sm:p-4',
        fresh && 'animate-fresh',
        entry.pending && 'border-dashed border-line-strong',
      )}
    >
      <button
        type="button"
        onClick={() => ui.openEntry(entry.id)}
        className="absolute inset-0 rounded-2xl"
        aria-label={`Ver registro: ${entry.text.slice(0, 80)}`}
      />
      <div className="pointer-events-none flex w-5 shrink-0 flex-col items-center gap-1.5 pt-0.5" aria-hidden>
        {entry.categories.length ? entry.categories.slice(0, 3).map((c) => <CategoryIcon key={c} id={c} />) : <span className="mt-1.5 size-2 rounded-full bg-line-strong" />}
      </div>
      <div className="pointer-events-none min-w-0 flex-1">
        {showDate && <p className="mb-0.5 text-xs font-medium text-ink-3">{showDate}</p>}
        <p className="line-clamp-3 text-[15px] leading-relaxed whitespace-pre-line text-ink">{entry.text}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-ink-3">
          {entry.pending && <Badge tone="warn">Por confirmar</Badge>}
          {entry._conflict === 1 && (
            <Badge tone="danger">
              <GitMerge className="size-3" aria-hidden /> Conflicto
            </Badge>
          )}
          {entry.evidence && (
            <Badge tone="neutral">
              <Star className="size-3 fill-[var(--cat-logro)] text-[var(--cat-logro)]" aria-hidden /> Evidencia
            </Badge>
          )}
          {meta.length > 0 && <span className="min-w-0 truncate">{meta.join(' · ')}</span>}
          {entry.categories.length > 0 && <span className="sr-only">Categorías: {entry.categories.join(', ')}</span>}
          {entry.attachmentIds.length > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Paperclip className="size-3.5" aria-hidden />
              {entry.attachmentIds.length}
              <span className="sr-only">capturas</span>
            </span>
          )}
          {pendingSync && (
            <span className="inline-flex items-center gap-1 text-warn" title="Guardado en este dispositivo; pendiente de sincronizar">
              <CloudUpload className="size-3.5" aria-hidden />
              Pendiente
            </span>
          )}
        </div>
      </div>
      <div className="relative z-[1] -mt-1 -mr-1 shrink-0">
        <Menu
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label="Acciones del registro">
              <Ellipsis className="size-5" />
            </Button>
          }
        >
          <MenuItem icon={<Pencil />} onSelect={() => ui.openEntry(entry.id, true)}>
            Editar
          </MenuItem>
          <MenuItem icon={<Star />} onSelect={() => void ui.toggleEvidence(entry)}>
            {entry.evidence ? 'Quitar de evidencia' : 'Marcar como evidencia'}
          </MenuItem>
          {entry.pending && (
            <MenuItem icon={<CircleCheck />} onSelect={() => void ui.confirmPending(entry)}>
              Confirmar registro
            </MenuItem>
          )}
          <MenuItem icon={<Copy />} onSelect={() => void ui.duplicateAsDraft(entry)}>
            Duplicar como borrador
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash />} danger onSelect={() => void ui.removeEntry(entry)}>
            Eliminar
          </MenuItem>
        </Menu>
      </div>
    </article>
  )
}

export function SyncBadge({ entry }: { entry: Stored<Entry> }) {
  const { mode } = useWorkspace()
  if (mode !== 'account') return <Badge tone="outline">Guardado en este dispositivo</Badge>
  if (entry._conflict) return <Badge tone="danger">Conflicto por resolver</Badge>
  if (entry._dirty)
    return (
      <Badge tone="warn">
        <Clock3 className="size-3" aria-hidden /> Pendiente de sincronizar
      </Badge>
    )
  return (
    <Badge tone="ok">
      <CircleCheck className="size-3" aria-hidden /> Sincronizado
    </Badge>
  )
}

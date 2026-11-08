import { useId, useMemo, useRef, useState } from 'react'
import { Popover } from 'radix-ui'
import { Check, ChevronDown, FolderKanban, Plus, Tag, X } from 'lucide-react'
import { useData } from '../app/data'
import { useWorkspace } from '../app/session'
import { cn, nowISO, uid } from '../lib/cn'
import { fold } from '../lib/text'
import { useToast } from './ui/toast'

export interface PickerValue {
  projectId?: string
  brandId?: string
}

interface Option {
  key: string
  kind: 'project' | 'brand' | 'create' | 'clear'
  id?: string
  label: string
  sub?: string
  group: string
}

/** Selector de proyecto o marca con recientes, búsqueda y creación rápida. */
export function ProjectPicker({ value, onChange, className }: { value: PickerValue; onChange: (v: PickerValue) => void; className?: string }) {
  const { entries, projects, brands } = useData()
  const { repo } = useWorkspace()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const brandName = (id?: string) => brands.find((b) => b.id === id)?.name
  const project = value.projectId ? projects.find((p) => p.id === value.projectId) : undefined
  const brand = value.brandId ? brands.find((b) => b.id === value.brandId) : undefined
  const label = project ? project.name : brand ? brand.name : 'Proyecto o marca'

  const options = useMemo<Option[]>(() => {
    const f = fold(q)
    const match = (s: string) => !f || fold(s).includes(f)
    const out: Option[] = []
    if (!f) {
      const seen = new Set<string>()
      for (const e of entries) {
        const key = e.projectId ? `p:${e.projectId}` : e.brandId ? `b:${e.brandId}` : ''
        if (!key || seen.has(key)) continue
        seen.add(key)
        if (e.projectId) {
          const p = projects.find((x) => x.id === e.projectId)
          if (p) out.push({ key: `r-${key}`, kind: 'project', id: p.id, label: p.name, sub: p.brandUnconfirmed ? 'Marca por confirmar' : brandName(p.brandId), group: 'Recientes' })
        } else if (e.brandId) {
          const b = brands.find((x) => x.id === e.brandId)
          if (b) out.push({ key: `r-${key}`, kind: 'brand', id: b.id, label: b.name, sub: 'Marca', group: 'Recientes' })
        }
        if (seen.size >= 4) break
      }
    }
    for (const p of projects) if (p.status !== 'cerrado' && match(p.name)) {
      out.push({ key: `p-${p.id}`, kind: 'project', id: p.id, label: p.name, sub: p.brandUnconfirmed ? 'Marca por confirmar' : brandName(p.brandId), group: 'Proyectos' })
    }
    for (const b of brands) if (!b.archived && match(b.name)) out.push({ key: `b-${b.id}`, kind: 'brand', id: b.id, label: b.name, group: 'Marcas' })
    if (q.trim() && !projects.some((p) => fold(p.name) === f)) out.push({ key: 'create', kind: 'create', label: `Crear proyecto “${q.trim()}”`, group: 'Nuevo' })
    if (value.projectId || value.brandId) out.push({ key: 'clear', kind: 'clear', label: 'Quitar selección', group: ' ' })
    return out
  }, [q, entries, projects, brands, value.projectId, value.brandId])

  const choose = async (o: Option) => {
    if (o.kind === 'project') onChange({ projectId: o.id })
    else if (o.kind === 'brand') onChange({ brandId: o.id })
    else if (o.kind === 'clear') onChange({})
    else if (o.kind === 'create') {
      const now = nowISO()
      const id = uid()
      try {
        await repo.put('projects', { id, name: q.trim().slice(0, 120), status: 'activo', createdAt: now, updatedAt: now })
        onChange({ projectId: id })
      } catch {
        toast({ tone: 'error', message: 'No se pudo crear el proyecto.' })
        return
      }
    }
    setOpen(false)
    setQ('')
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(options.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = options[active]
      if (o) void choose(o)
    }
  }

  let lastGroup = ''
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        setActive(0)
        if (!o) setQ('')
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-10 max-w-full min-w-0 items-center gap-2 rounded-full border px-3 text-sm transition-colors',
            project || brand ? 'border-ink-2 bg-surface-2 font-medium text-ink' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-2',
            className,
          )}
          aria-label={project || brand ? `Proyecto o marca: ${label}. Cambiar` : 'Elegir proyecto o marca (opcional)'}
        >
          {brand && !project ? <Tag className="size-4 shrink-0" aria-hidden /> : <FolderKanban className="size-4 shrink-0" aria-hidden />}
          <span className="truncate">{label}</span>
          <ChevronDown className="size-4 shrink-0 opacity-70" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            inputRef.current?.focus()
          }}
          className="anim-fade z-50 w-[min(360px,calc(100vw-24px))] rounded-2xl border border-line bg-surface p-2 shadow-lift"
        >
          <div className="relative">
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKey}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={options[active] ? `${listId}-${options[active].key}` : undefined}
              aria-label="Buscar o crear proyecto"
              placeholder="Buscar o crear proyecto…"
              className="field h-11 pr-9"
            />
            {q && (
              <button type="button" onClick={() => setQ('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-ink-3" aria-label="Limpiar búsqueda">
                <X className="size-4" />
              </button>
            )}
          </div>
          <ul id={listId} role="listbox" aria-label="Proyectos y marcas" className="mt-2 max-h-[min(50dvh,340px)] overflow-y-auto">
            {options.map((o, i) => {
              const header = o.group !== lastGroup ? o.group : null
              lastGroup = o.group
              const selected = (o.kind === 'project' && o.id === value.projectId) || (o.kind === 'brand' && o.id === value.brandId && !value.projectId)
              return (
                <li key={o.key} role="none">
                  {header && header.trim() && <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">{header}</div>}
                  <div
                    id={`${listId}-${o.key}`}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => setActive(i)}
                    onClick={() => void choose(o)}
                    className={cn('flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-2.5', i === active && 'bg-surface-2', o.kind === 'clear' && 'text-ink-3')}
                  >
                    {o.kind === 'create' ? <Plus className="size-4 text-accent-ink" aria-hidden /> : o.kind === 'brand' ? <Tag className="size-4 text-ink-3" aria-hidden /> : o.kind === 'project' ? <FolderKanban className="size-4 text-ink-3" aria-hidden /> : <X className="size-4" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] text-ink">{o.label}</span>
                      {o.sub && <span className="block truncate text-xs text-ink-3">{o.sub}</span>}
                    </span>
                    {selected && <Check className="size-4 text-ink" aria-hidden />}
                  </div>
                </li>
              )
            })}
            {!options.length && <li className="px-3 py-4 text-sm text-ink-3">Sin resultados.</li>}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

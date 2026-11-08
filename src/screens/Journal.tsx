import { useEffect, useMemo, useState } from 'react'
import { CalendarPlus, FolderKanban, ListFilter, Search, Star, Users, X } from 'lucide-react'
import { pendingReviewCount } from '../lib/meetings'
import { useMeetingUi } from '../app/meeting-ui'
import { Badge } from '../components/ui/ui'
import type { CategoryId, Entry, Stored } from '../db/types'
import { CATEGORIES } from '../lib/constants'
import { capitalize, formatDate, relativeDay } from '../lib/dates'
import { fold, plural } from '../lib/text'
import { cn } from '../lib/cn'
import { useData } from '../app/data'
import { useRoute } from '../app/router'
import { useEntryUi } from '../app/entry-ui'
import { EntryCard } from '../components/EntryCard'
import { projectAndBrand } from '../components/bits'
import { ProjectsSheet } from '../components/ProjectsSheet'
import { Button, EmptyState } from '../components/ui/ui'

const PAGE = 120

type Tab = 'registros' | 'juntas' | 'proyectos'

export function JournalScreen() {
  const route = useRoute()
  const t = route.params.get('tab')
  const tab: Tab = t === 'juntas' || t === 'proyectos' ? t : 'registros'
  const tabs: [Tab, string][] = [
    ['registros', 'Registros'],
    ['juntas', 'Juntas'],
    ['proyectos', 'Proyectos'],
  ]
  return (
    <div className="mx-auto max-w-[920px]">
      <h1 className="display text-[2.3rem] leading-none sm:text-5xl">Diario</h1>
      <div role="tablist" aria-label="Vistas del diario" className="mt-5 inline-flex rounded-full border border-line-strong bg-surface p-1">
        {tabs.map(([id, label]) => (
          <a
            key={id}
            role="tab"
            aria-selected={tab === id}
            href={id === 'registros' ? '#/diario' : `#/diario?tab=${id}`}
            className={cn('inline-flex h-9 items-center rounded-full px-4 text-sm font-medium', tab === id ? 'bg-[var(--btn-primary)] text-[var(--btn-primary-fg)]' : 'text-ink-2 hover:text-ink')}
          >
            {label}
          </a>
        ))}
      </div>
      <div className="mt-6">
        {tab === 'registros' && <EntriesTab />}
        {tab === 'juntas' && <MeetingsTab />}
        {tab === 'proyectos' && <ProjectsTab />}
      </div>
    </div>
  )
}

function MeetingsTab() {
  const { meetings, projects, actions, changes } = useData()
  const { newMeeting, openMeeting } = useMeetingUi()
  const route = useRoute()
  useEffect(() => {
    const id = route.params.get('meeting')
    if (id) openMeeting(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params])
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-3">Notas, acuerdos, cambios y pendientes de tus reuniones.</p>
        <Button variant="primary" onClick={() => newMeeting()}>
          <Users className="size-4" /> Nueva junta
        </Button>
      </div>
      <div className="mt-5">
        {meetings.length ? (
          <ul className="grid gap-2.5">
            {meetings.map((m) => {
              const p = projects.find((x) => x.id === m.projectId)
              const mActions = actions.filter((a) => a.meetingId === m.id)
              const n = pendingReviewCount({ meeting: m, actions: mActions, changes: changes.filter((c) => c.meetingId === m.id) })
              const open = mActions.filter((a) => a.status === 'confirmada').length
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => openMeeting(m.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-line bg-surface px-4 py-3.5 text-left hover:bg-surface-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-ink-3">
                        {formatDate(m.date, 'full')}
                        {p ? ` · ${p.name}` : ''}
                      </span>
                      <span className="block text-[15px] font-medium text-ink">{m.title}</span>
                    </span>
                    {n > 0 && <Badge tone="warn">{n} por revisar</Badge>}
                    {open > 0 && <Badge>{plural(open, 'pendiente', 'pendientes')}</Badge>}
                    {m.closedAt ? <Badge tone="ok">Cerrada</Badge> : <Badge tone="outline">Abierta</Badge>}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyState title="Aún no hay juntas" action={<Button onClick={() => newMeeting()}>Registrar una junta</Button>}>
            Título y fecha bastan. Después puedes pegar el resumen o importar la transcripción (TXT, VTT o SRT).
          </EmptyState>
        )}
      </div>
    </div>
  )
}

function ProjectsTab() {
  const { projects, brands, entries, actions, changes, meetings } = useData()
  const { openProject } = useMeetingUi()
  const [manage, setManage] = useState(false)
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-3">Cada proyecto reúne sus registros, juntas, pendientes y cambios.</p>
        <Button onClick={() => setManage(true)}>
          <FolderKanban className="size-4" /> Gestionar proyectos y marcas
        </Button>
      </div>
      <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
        {projects.map((p) => {
          const b = brands.find((x) => x.id === p.brandId)
          const pending = actions.filter((a) => a.projectId === p.id && a.status === 'confirmada').length
          const replaced = new Set(changes.map((c) => c.supersedesId).filter(Boolean))
          const openChanges = changes.filter((c) => c.projectId === p.id && c.status !== 'aprobado' && !replaced.has(c.id)).length
          return (
            <li key={p.id}>
              <button type="button" onClick={() => openProject(p.id)} className="flex h-full w-full flex-col items-start gap-2 rounded-2xl border border-line bg-surface p-4 text-left hover:bg-surface-2">
                <span className="text-xs text-ink-3">{p.brandUnconfirmed ? 'Marca por confirmar' : (b?.name ?? 'Sin marca')}</span>
                <span className="display text-xl leading-tight text-ink">{p.name}</span>
                <span className="mt-auto flex flex-wrap gap-1.5 text-xs">
                  <Badge>{plural(entries.filter((e) => e.projectId === p.id && !e.pending).length, 'registro', 'registros')}</Badge>
                  <Badge>{plural(meetings.filter((m) => m.projectId === p.id).length, 'junta', 'juntas')}</Badge>
                  {pending > 0 && <Badge tone="accent">{plural(pending, 'pendiente', 'pendientes')}</Badge>}
                  {openChanges > 0 && <Badge tone="warn">{plural(openChanges, 'cambio abierto', 'cambios abiertos')}</Badge>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {!projects.length && <p className="mt-4 text-sm text-ink-3">Aún no hay proyectos.</p>}
      <ProjectsSheet open={manage} onOpenChange={setManage} />
    </div>
  )
}

function EntriesTab() {
  const { entries, projects, brands, today } = useData()
  const ui = useEntryUi()
  const route = useRoute()
  const [q, setQ] = useState('')
  const [brand, setBrand] = useState('')
  const [project, setProject] = useState('')
  const [cat, setCat] = useState<CategoryId | ''>('')
  const [onlyEvidence, setOnlyEvidence] = useState(false)
  const [onlyPending, setOnlyPending] = useState(false)
  const [projectsOpen, setProjectsOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [limit, setLimit] = useState(PAGE)

  useEffect(() => {
    const id = route.params.get('entry')
    if (id) ui.openEntry(id)
    const p = route.params.get('project')
    if (p) setProject(p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params])

  const filtered = useMemo(() => {
    const f = fold(q)
    return entries.filter((e) => {
      if (onlyEvidence && !e.evidence) return false
      if (onlyPending && !e.pending) return false
      if (cat && !e.categories.includes(cat)) return false
      if (project && (project === '__none' ? !!e.projectId : e.projectId !== project)) return false
      const pb = projectAndBrand(e, projects, brands)
      if (brand && (brand === '__none' ? !!pb.brand : pb.brand?.id !== brand)) return false
      if (f) {
        const hay = fold(
          [e.text, e.outcome, e.contribution, e.collaborators, e.skills.join(' '), e.feedback?.quote, e.feedback?.interpretation, e.feedback?.person, e.nextStep, pb.project?.name, pb.brand?.name]
            .filter(Boolean)
            .join(' '),
        )
        if (!hay.includes(f)) return false
      }
      return true
    })
  }, [entries, projects, brands, q, brand, project, cat, onlyEvidence, onlyPending])

  const groups = useMemo(() => {
    const out: { date: string; items: Stored<Entry>[] }[] = []
    for (const e of filtered.slice(0, limit)) {
      const last = out[out.length - 1]
      if (last && last.date === e.date) last.items.push(e)
      else out.push({ date: e.date, items: [e] })
    }
    return out
  }, [filtered, limit])

  const active = [brand, project, cat, onlyEvidence, onlyPending].filter(Boolean).length
  const clear = () => {
    setQ('')
    setBrand('')
    setProject('')
    setCat('')
    setOnlyEvidence(false)
    setOnlyPending(false)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-3">Todo lo que has registrado, con sus detalles y evidencias.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => ui.newEntry()} variant="secondary">
            <CalendarPlus className="size-4" /> Registro de otro día
          </Button>
          <Button onClick={() => setProjectsOpen(true)} variant="ghost">
            <FolderKanban className="size-4" /> Proyectos y marcas
          </Button>
        </div>
      </div>

      <div className="mt-5 flex gap-2" role="search">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <label htmlFor="j-search" className="sr-only">
            Buscar en el diario
          </label>
          <input id="j-search" type="search" className="field pl-9" placeholder="Buscar texto, persona, habilidad…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button variant={active ? 'subtle' : 'secondary'} className="sm:hidden" aria-expanded={filtersOpen} aria-controls="j-filters" onClick={() => setFiltersOpen((o) => !o)}>
          <ListFilter className="size-4" /> Filtros{active ? ` (${active})` : ''}
        </Button>
      </div>

      <div id="j-filters" className={cn('mt-3 flex-wrap items-center gap-2', filtersOpen ? 'flex' : 'hidden sm:flex')}>
        <label className="sr-only" htmlFor="f-brand">
          Marca
        </label>
        <select id="f-brand" className="field h-10 min-h-10 w-auto max-w-[46%] rounded-full py-0 text-sm sm:max-w-none" value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">Todas las marcas</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
          <option value="__none">Sin marca</option>
        </select>
        <label className="sr-only" htmlFor="f-project">
          Proyecto
        </label>
        <select id="f-project" className="field h-10 min-h-10 w-auto max-w-[46%] rounded-full py-0 text-sm sm:max-w-none" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">Todos los proyectos</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="__none">Sin proyecto</option>
        </select>
        <label className="sr-only" htmlFor="f-cat">
          Categoría
        </label>
        <select id="f-cat" className="field h-10 min-h-10 w-auto rounded-full py-0 text-sm" value={cat} onChange={(e) => setCat(e.target.value as CategoryId | '')}>
          <option value="">Todas las categorías</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={onlyEvidence}
          onClick={() => setOnlyEvidence((v) => !v)}
          className={cn('inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm', onlyEvidence ? 'border-ink-2 bg-surface-2 font-semibold' : 'border-line-strong text-ink-2')}
        >
          <Star className={cn('size-4', onlyEvidence && 'fill-[var(--cat-logro)] text-[var(--cat-logro)]')} aria-hidden /> Destacados
        </button>
        <button
          type="button"
          aria-pressed={onlyPending}
          onClick={() => setOnlyPending((v) => !v)}
          className={cn('inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm', onlyPending ? 'border-ink-2 bg-surface-2 font-semibold' : 'border-line-strong text-ink-2')}
        >
          Por confirmar
        </button>
      </div>

      <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-3" aria-live="polite">
        {plural(filtered.length, 'registro', 'registros')}
        {(active > 0 || q) && (
          <button type="button" onClick={clear} className="inline-flex items-center gap-1 rounded-md font-medium text-accent-ink underline-offset-4 hover:underline">
            <X className="size-3.5" aria-hidden /> Limpiar filtros
          </button>
        )}
      </p>

      <div className="mt-4">
        {!entries.length ? (
          <EmptyState title="Aún no hay registros" action={<Button onClick={() => (location.hash = '#/hoy')}>Registrar mi día</Button>}>
            Cuando registres tu día aparecerá aquí, agrupado por fecha.
          </EmptyState>
        ) : !filtered.length ? (
          <EmptyState title="Nada coincide" action={<Button onClick={clear}>Limpiar filtros</Button>}>
            Prueba con otra palabra o quita algún filtro.
          </EmptyState>
        ) : (
          <div className="grid gap-7">
            {groups.map((g) => (
              <section key={g.date} aria-labelledby={`d-${g.date}`}>
                <h2 id={`d-${g.date}`} className="sticky top-[calc(56px+env(safe-area-inset-top))] z-10 -mx-1 mb-2.5 flex items-baseline gap-2 bg-bg/95 px-1 py-1.5 backdrop-blur-sm lg:top-0">
                  <span className="display text-lg text-ink">{capitalize(relativeDay(g.date, today))}</span>
                  <span className="text-xs text-ink-3">
                    {relativeDay(g.date, today).length < 6 ? `${formatDate(g.date, 'dayMonth')} · ` : ''}
                    {plural(g.items.length, 'registro', 'registros')}
                  </span>
                </h2>
                <div className="grid gap-2.5">
                  {g.items.map((e) => (
                    <EntryCard key={e.id} entry={e} />
                  ))}
                </div>
              </section>
            ))}
            {filtered.length > limit && (
              <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE)} className="justify-self-center">
                Mostrar más
              </Button>
            )}
          </div>
        )}
      </div>
      <ProjectsSheet open={projectsOpen} onOpenChange={setProjectsOpen} />
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Archive, ChevronLeft, ChevronRight, CircleCheck, Ellipsis, Link2, Pencil, Plus, Search, Star } from 'lucide-react'
import type { Goal, Reflection } from '../../db/types'
import { storageErrorMessage } from '../../db/database'
import { LIMITS } from '../../lib/constants'
import { addDays, diffDays, formatDate, formatInstant, startOfWeek } from '../../lib/dates'
import { excerpt, fold, plural } from '../../lib/text'
import { cn, nowISO, uid } from '../../lib/cn'
import { useData } from '../../app/data'
import { useWorkspace } from '../../app/session'
import { useEntryUi } from '../../app/entry-ui'
import { Badge, Burst, Button, EmptyState, SectionTitle, TextArea, TextField } from '../ui/ui'
import { Menu, MenuItem, Modal } from '../ui/overlay'
import { useToast } from '../ui/toast'

export function GoalsSection() {
  const { goals, today } = useData()
  const [edit, setEdit] = useState<Goal | 'new' | null>(null)
  const [link, setLink] = useState<Goal | null>(null)
  const active = goals.filter((g) => g.status === 'activo').sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const done = goals.filter((g) => g.status === 'cumplido').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
  const full = active.length >= LIMITS.maxActiveGoals
  return (
    <section aria-labelledby="goals-title">
      <SectionTitle
        id="goals-title"
        sub={`Hasta ${LIMITS.maxActiveGoals} activos, con criterio de cumplimiento y evidencias reales.`}
        aside={
          <Button onClick={() => setEdit('new')} disabled={full} title={full ? 'Ya tienes 3 objetivos activos' : undefined}>
            <Plus className="size-4" /> Nuevo objetivo
          </Button>
        }
      >
        Objetivos
      </SectionTitle>
      {full && <p className="-mt-1 mb-3 text-xs text-ink-3">Tienes {LIMITS.maxActiveGoals} objetivos activos. Cumple o archiva uno para agregar otro.</p>}
      {active.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {active.map((g) => (
            <GoalCard key={g.id} goal={g} today={today} onEdit={() => setEdit(g)} onLink={() => setLink(g)} />
          ))}
        </div>
      ) : (
        <EmptyState title="Sin objetivos activos" action={<Button onClick={() => setEdit('new')}>Definir un objetivo</Button>}>
          Por ejemplo: “Liderar la dirección de arte de una pieza completa”, con un criterio claro de cuándo lo darás por cumplido.
        </EmptyState>
      )}
      {done.length > 0 && (
        <details className="mt-4">
          <summary className="inline-flex min-h-10 items-center text-sm font-medium text-ink-2">Cumplidos ({done.length})</summary>
          <ul className="mt-2 grid gap-2">
            {done.map((g) => (
              <li key={g.id} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                <CircleCheck className="size-4 text-ok" aria-hidden />
                <span className="min-w-0 flex-1">{g.title}</span>
                {g.completedAt && <span className="text-xs text-ink-3">{formatInstant(g.completedAt)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <GoalForm state={edit} onClose={() => setEdit(null)} />
      <GoalEvidence goal={link} onClose={() => setLink(null)} />
    </section>
  )
}

function GoalCard({ goal, today, onEdit, onLink }: { goal: Goal; today: string; onEdit: () => void; onLink: () => void }) {
  const { repo } = useWorkspace()
  const { entries } = useData()
  const ui = useEntryUi()
  const toast = useToast()
  const [celebrate, setCelebrate] = useState(false)
  const ids = [...new Set(goal.evidenceIds)].filter((id) => entries.some((e) => e.id === id))
  const days = goal.dueDate ? diffDays(goal.dueDate, today) : null
  const complete = async () => {
    setCelebrate(true)
    window.setTimeout(() => setCelebrate(false), 900)
    try {
      await repo.put('goals', { ...goal, status: 'cumplido', completedAt: nowISO() })
      toast({ tone: 'ok', message: 'Objetivo cumplido. ¡Bien!', action: { label: 'Deshacer', onClick: () => void repo.put('goals', { ...goal, status: 'activo', completedAt: undefined }) } })
    } catch (e) {
      toast({ tone: 'error', message: storageErrorMessage(e) })
    }
  }
  return (
    <article className="card flex flex-col gap-3 p-5">
      <div className="flex items-start gap-2">
        <h3 className="display min-w-0 flex-1 text-xl leading-snug">{goal.title}</h3>
        <Menu
          trigger={
            <Button size="icon-sm" variant="ghost" aria-label={`Acciones del objetivo ${goal.title}`}>
              <Ellipsis className="size-5" />
            </Button>
          }
        >
          <MenuItem icon={<Pencil />} onSelect={onEdit}>
            Editar
          </MenuItem>
          <MenuItem icon={<Archive />} onSelect={() => void repo.put('goals', { ...goal, status: 'archivado' })}>
            Archivar
          </MenuItem>
        </Menu>
      </div>
      {goal.criterion && (
        <p className="text-sm text-ink-2">
          <span className="font-medium text-ink">Criterio:</span> {goal.criterion}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5 text-xs">
        {goal.dueDate ? (
          <Badge tone={days !== null && days < 0 ? 'danger' : 'neutral'}>
            {days !== null && days < 0 ? `Venció el ${formatDate(goal.dueDate, 'dayMonth')}` : `Para el ${formatDate(goal.dueDate, 'medium')}${days !== null ? ` · ${plural(days, 'día', 'días')}` : ''}`}
          </Badge>
        ) : (
          <Badge tone="outline">Sin fecha</Badge>
        )}
        <Badge tone={ids.length ? 'accent' : 'outline'}>{plural(ids.length, 'evidencia', 'evidencias')}</Badge>
      </div>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <span className="relative">
          <Button size="sm" variant="secondary" onClick={() => void complete()}>
            <CircleCheck className="size-4" /> Cumplido
          </Button>
          <Burst show={celebrate} />
        </span>
        <Button size="sm" variant="ghost" onClick={onLink}>
          <Link2 className="size-4" /> Evidencias
        </Button>
        {ids.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => ui.openList(goal.title, ids, 'evidencias del objetivo')}>
            Ver
          </Button>
        )}
      </div>
    </article>
  )
}

function GoalForm({ state, onClose }: { state: Goal | 'new' | null; onClose: () => void }) {
  const { repo } = useWorkspace()
  const { goals } = useData()
  const g = state && state !== 'new' ? state : undefined
  const [title, setTitle] = useState('')
  const [criterion, setCriterion] = useState('')
  const [due, setDue] = useState('')
  const [err, setErr] = useState<string>()
  useEffect(() => {
    if (!state) return
    setTitle(g?.title ?? '')
    setCriterion(g?.criterion ?? '')
    setDue(g?.dueDate ?? '')
    setErr(undefined)
  }, [state, g])
  const save = async () => {
    if (!title.trim()) return setErr('Escribe el objetivo.')
    if (!g && goals.filter((x) => x.status === 'activo').length >= LIMITS.maxActiveGoals) return setErr('Ya tienes 3 objetivos activos.')
    const now = nowISO()
    try {
      await repo.put('goals', {
        id: g?.id ?? uid(),
        title: title.trim().slice(0, 300),
        criterion: criterion.trim() || undefined,
        dueDate: due || undefined,
        status: g?.status ?? 'activo',
        evidenceIds: g?.evidenceIds ?? [],
        completedAt: g?.completedAt,
        createdAt: g?.createdAt ?? now,
        updatedAt: now,
      })
      onClose()
    } catch (e) {
      setErr(storageErrorMessage(e))
    }
  }
  return (
    <Modal
      open={!!state}
      onOpenChange={(o) => !o && onClose()}
      title={g ? 'Editar objetivo' : 'Nuevo objetivo'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <TextField label="Objetivo" value={title} onChange={(e) => setTitle(e.target.value)} error={err} maxLength={300} />
        <TextArea label="Criterio de cumplimiento" optional rows={2} value={criterion} onChange={(e) => setCriterion(e.target.value)} placeholder="¿Cómo sabrás que lo lograste?" />
        <TextField label="Fecha" optional type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </div>
    </Modal>
  )
}

function GoalEvidence({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const { entries } = useData()
  const { repo } = useWorkspace()
  const [q, setQ] = useState('')
  const [ids, setIds] = useState<string[]>([])
  useEffect(() => {
    if (goal) {
      setIds([...new Set(goal.evidenceIds)])
      setQ('')
    }
  }, [goal])
  if (!goal) return null
  const f = fold(q)
  const list = entries
    .filter((e) => !e.pending && (!f || fold(e.text).includes(f)))
    .sort((a, b) => Number(!!b.evidence) - Number(!!a.evidence) || b.date.localeCompare(a.date))
    .slice(0, 80)
  return (
    <Modal
      open={!!goal}
      onOpenChange={(o) => !o && onClose()}
      title="Evidencias del objetivo"
      description="Vincula registros reales. Primero aparecen los marcados como evidencia."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              await repo.put('goals', { ...goal, evidenceIds: ids })
              onClose()
            }}
          >
            Guardar ({ids.length})
          </Button>
        </>
      }
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <label htmlFor="ge-q" className="sr-only">
          Buscar
        </label>
        <input id="ge-q" className="field pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en el diario" />
      </div>
      <ul className="grid gap-1.5">
        {list.map((e) => {
          const on = ids.includes(e.id)
          return (
            <li key={e.id}>
              <label className={cn('flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2', on ? 'border-ink-2 bg-surface-2' : 'border-line')}>
                <input type="checkbox" className="mt-1 size-5 accent-[var(--accent-ink)]" checked={on} onChange={() => setIds(on ? ids.filter((x) => x !== e.id) : [...ids, e.id])} />
                <span className="text-sm">
                  <span className="flex items-center gap-1.5 text-xs text-ink-3">
                    {formatDate(e.date, 'medium')}
                    {e.evidence && <Star className="size-3 fill-[var(--cat-logro)] text-[var(--cat-logro)]" aria-label="Evidencia" />}
                  </span>
                  {excerpt(e.text, 140)}
                </span>
              </label>
            </li>
          )
        })}
        {!list.length && <li className="text-sm text-ink-3">Sin registros.</li>}
      </ul>
    </Modal>
  )
}

export function ReflectionSection() {
  const { reflections, today } = useData()
  const { repo } = useWorkspace()
  const [week, setWeek] = useState(() => startOfWeek(today))
  const rec = reflections.find((r) => r.id === week)
  const [vals, setVals] = useState({ wentWell: '', learned: '', improve: '' })
  const [status, setStatus] = useState('')
  const dirty = useRef(false)
  useEffect(() => {
    dirty.current = false
    setVals({ wentWell: rec?.wentWell ?? '', learned: rec?.learned ?? '', improve: rec?.improve ?? '' })
    setStatus('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week])
  useEffect(() => {
    if (!dirty.current) return
    const t = window.setTimeout(async () => {
      if (!rec && !vals.wentWell.trim() && !vals.learned.trim() && !vals.improve.trim()) return
      const now = nowISO()
      const r: Reflection = { id: week, ...vals, createdAt: rec?.createdAt ?? now, updatedAt: now }
      try {
        await repo.put('reflections', r)
        dirty.current = false
        setStatus('Guardado')
      } catch (e) {
        setStatus(storageErrorMessage(e))
      }
    }, 700)
    return () => window.clearTimeout(t)
  }, [vals, week, rec, repo])
  const set = (k: keyof typeof vals, v: string) => {
    dirty.current = true
    setStatus('')
    setVals((s) => ({ ...s, [k]: v }))
  }
  const thisWeek = startOfWeek(today)
  return (
    <section aria-labelledby="refl-title">
      <SectionTitle
        id="refl-title"
        sub="Breve. Tres preguntas, cuando quieras."
        aside={
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" aria-label="Semana anterior" onClick={() => setWeek(addDays(week, -7))}>
              <ChevronLeft className="size-5" />
            </Button>
            <span className="min-w-36 text-center text-sm font-medium">{week === thisWeek ? 'Esta semana' : `Semana del ${formatDate(week, 'dayMonth')}`}</span>
            <Button size="icon-sm" variant="ghost" aria-label="Semana siguiente" disabled={week >= thisWeek} onClick={() => setWeek(addDays(week, 7))}>
              <ChevronRight className="size-5" />
            </Button>
          </div>
        }
      >
        Revisión semanal
      </SectionTitle>
      <div className="card grid gap-4 p-5 md:grid-cols-3">
        <TextArea label="Qué salió bien" rows={4} value={vals.wentWell} onChange={(e) => set('wentWell', e.target.value)} />
        <TextArea label="Qué aprendí" rows={4} value={vals.learned} onChange={(e) => set('learned', e.target.value)} />
        <TextArea label="Qué quiero mejorar" rows={4} value={vals.improve} onChange={(e) => set('improve', e.target.value)} />
        <p className="text-xs text-ink-3 md:col-span-3" aria-live="polite">
          {status || 'Se guarda solo mientras escribes.'}
        </p>
      </div>
    </section>
  )
}

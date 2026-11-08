import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, CircleCheck, CloudUpload, TriangleExclamationPoint } from 'lucide-react'
import type { CategoryId, Entry, QuickDraft } from '../db/types'
import type { DraftFile } from '../db/repo'
import { storageErrorMessage } from '../db/database'
import { CATEGORIES } from '../lib/constants'
import { addDays, diffDays, formatDate } from '../lib/dates'
import { cn, nowISO, uid } from '../lib/cn'
import { useData } from '../app/data'
import { useSyncState, useWorkspace } from '../app/session'
import { DRAFT_EVENT } from '../app/entry-ui'
import { CategoryIcon } from './bits'
import { EntryDetailsFields, emptyDetails, type Details } from './EntryFields'
import { pickDetails } from './EntrySheet'
import { ProjectPicker, type PickerValue } from './ProjectPicker'
import { Button, Chip } from './ui/ui'

const DRAFT_KEY = 'draft:quick'
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

function filledDetails(d: Details): number {
  let n = 0
  if (d.outcome) n++
  if (d.status) n++
  if (d.contribution) n++
  if (d.collaborators) n++
  if (d.skills?.length) n++
  if (d.timeSpentMin) n++
  if (d.feedback && (d.feedback.quote || d.feedback.person || d.feedback.interpretation)) n++
  if (d.links?.length) n++
  if (d.nextStep) n++
  if (d.timeSaving && Object.values(d.timeSaving).some((v) => v !== undefined && v !== '')) n++
  if (d.evidence) n++
  return n
}

function dayHeading(date: string, today: string): string {
  const d = diffDays(today, date)
  if (d === 0) return 'hoy'
  if (d === 1) return 'ayer'
  return `el ${formatDate(date, 'weekday')} ${Number(date.slice(8))}` // "el jueves 5"
}

export function QuickCapture({ date, onDateChange, onSaved }: { date: string; onDateChange: (d: string) => void; onSaved: (id: string, date: string) => void }) {
  const { repo, mode } = useWorkspace()
  const { profile, today, entries } = useData()
  const sync = useSyncState()
  const [loaded, setLoaded] = useState(false)
  const [entryId, setEntryId] = useState(() => uid())
  const [text, setText] = useState('')
  const [cats, setCats] = useState<CategoryId[]>([])
  const [pick, setPick] = useState<PickerValue>({})
  const [details, setDetails] = useState<Details>(emptyDetails)
  const [files, setFiles] = useState<DraftFile[]>([])
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const lock = useRef(false)
  const [draftAt, setDraftAt] = useState<string>()
  const [draftError, setDraftError] = useState(false)
  const [lastSaved, setLastSaved] = useState<{ id: string; at: number } | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string>()
  const textRef = useRef<HTMLTextAreaElement>(null)

  const loadDraft = useCallback(async () => {
    const d = await repo.getLocal<QuickDraft>(DRAFT_KEY)
    if (d) {
      setEntryId(d.entryId)
      setText(d.text ?? '')
      setCats(d.categories ?? [])
      setPick({ projectId: d.projectId, brandId: d.brandId })
      const det = { ...emptyDetails(), ...pickDetails(d.details ?? {}) }
      setDetails(det)
      setFiles(d.files ?? [])
      setDraftAt(d.savedAt)
      if (d.date && d.date <= today) onDateChange(d.date)
      if (filledDetails(det) || d.files?.length) setOpen(true)
    }
    setLoaded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo])

  useEffect(() => {
    void loadDraft()
    const on = () => {
      void loadDraft()
      setLastSaved(null)
      textRef.current?.focus()
    }
    window.addEventListener(DRAFT_EVENT, on)
    return () => window.removeEventListener(DRAFT_EVENT, on)
  }, [loadDraft])

  // Borrador automático (solo en este dispositivo).
  useEffect(() => {
    if (!loaded) return
    const t = window.setTimeout(async () => {
      const empty = !text.trim() && !cats.length && !pick.projectId && !pick.brandId && !files.length && !filledDetails(details)
      try {
        if (empty) {
          await repo.delLocal(DRAFT_KEY)
          setDraftAt(undefined)
        } else {
          const savedAt = nowISO()
          await repo.saveDraft({ entryId, date, text, categories: cats, projectId: pick.projectId, brandId: pick.brandId, details, files, savedAt })
          setDraftAt(savedAt)
        }
        setDraftError(false)
      } catch {
        setDraftError(true)
      }
    }, 400)
    return () => window.clearTimeout(t)
  }, [loaded, repo, entryId, date, text, cats, pick, details, files])

  const save = async () => {
    if (lock.current) return
    if (!text.trim()) {
      setError('Escribe qué hiciste, aunque sea una línea.')
      textRef.current?.focus()
      return
    }
    if (date > today) {
      setError('La fecha no puede ser futura.')
      return
    }
    lock.current = true
    setSaving(true)
    setError(undefined)
    const now = nowISO()
    const entry: Entry = {
      ...details,
      id: entryId,
      date,
      text: text.trim(),
      categories: cats,
      projectId: pick.projectId,
      brandId: pick.projectId ? undefined : pick.brandId,
      skills: details.skills ?? [],
      links: details.links ?? [],
      attachmentIds: [],
      createdAt: now,
      updatedAt: now,
    }
    try {
      await repo.saveNewEntry(entry, files)
      // Solo después de que la escritura terminó:
      setEntryId(uid())
      setText('')
      setCats([])
      setPick({})
      setDetails(emptyDetails())
      setFiles([])
      setOpen(false)
      setDraftAt(undefined)
      await repo.delLocal(DRAFT_KEY).catch(() => {})
      setLastSaved({ id: entry.id, at: Date.now() })
      setJustSaved(true)
      window.setTimeout(() => setJustSaved(false), 1600)
      onSaved(entry.id, date)
    } catch (e) {
      setError(storageErrorMessage(e) + ' Tu texto sigue aquí.')
    } finally {
      lock.current = false
      setSaving(false)
    }
  }

  const savedEntry = lastSaved ? entries.find((e) => e.id === lastSaved.id) : undefined
  const status = useMemo(() => {
    if (error) return { tone: 'error' as const, text: error }
    if (saving) return { tone: 'muted' as const, text: 'Guardando…' }
    if (lastSaved && !text) {
      if (mode !== 'account') return { tone: 'ok' as const, text: 'Guardado en este dispositivo' }
      if (savedEntry && savedEntry._dirty === 0) return { tone: 'ok' as const, text: 'Guardado y sincronizado' }
      if (sync?.phase === 'offline') return { tone: 'warn' as const, text: 'Guardado en este dispositivo · pendiente de sincronizar (sin conexión)' }
      if (sync?.phase === 'error') return { tone: 'warn' as const, text: 'Guardado en este dispositivo · error al sincronizar, se reintentará' }
      return { tone: 'muted' as const, text: 'Guardado en este dispositivo · sincronizando…' }
    }
    if (draftError) return { tone: 'warn' as const, text: 'No se pudo guardar el borrador en este dispositivo.' }
    if (draftAt && text) return { tone: 'muted' as const, text: 'Borrador guardado en este dispositivo' }
    return null
  }, [error, saving, lastSaved, text, mode, savedEntry, sync?.phase, draftError, draftAt])

  const nick = profile.nickname || profile.name
  const nDetails = filledDetails(details) + (files.length ? 1 : 0)

  return (
    <section
      aria-labelledby="qc-title"
      className="card relative p-4 sm:p-6"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          void save()
        }
      }}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="qc-date" className="sr-only">
          Fecha del registro
        </label>
        <input
          id="qc-date"
          type="date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && onDateChange(e.target.value)}
          className="field h-10 min-h-10 w-auto rounded-full px-3 py-0 text-sm"
        />
        {date !== today ? (
          <>
            <span className="text-sm font-medium text-accent-ink">Registro de un día anterior</span>
            <Button size="sm" variant="ghost" onClick={() => onDateChange(today)}>
              Volver a hoy
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onDateChange(addDays(today, -1))}>
            ¿Fue ayer?
          </Button>
        )}
      </div>

      <h1 id="qc-title" className="display text-[1.9rem] leading-[1.08] text-ink sm:text-[2.55rem]">
        ¿Qué hiciste {dayHeading(date, today)}, <span className="text-accent-ink italic">{nick}</span>?
      </h1>

      <textarea
        ref={textRef}
        id="qc-text"
        aria-labelledby="qc-title"
        aria-describedby="qc-status"
        aria-invalid={error && !text.trim() ? true : undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (error) setError(undefined)
          if (lastSaved) setLastSaved(null)
        }}
        maxLength={20000}
        placeholder="Una línea basta. Ej. Ajusté la animación del logo y la mandé a revisión."
        className="field mt-4 max-h-[50dvh] min-h-[7.5rem] resize-none rounded-2xl px-4 py-3 text-[17px] leading-relaxed [field-sizing:content] sm:text-lg"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ProjectPicker value={pick} onChange={setPick} />
      </div>

      <fieldset className="mt-3">
        <legend className="sr-only">Categorías (opcional)</legend>
        <div className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3 sm:flex sm:flex-wrap">
          {CATEGORIES.map((c) => (
            <Chip
              key={c.id}
              pressed={cats.includes(c.id)}
              color={c.color}
              title={c.hint}
              icon={<CategoryIcon id={c.id} />}
              onPressedChange={(v) => setCats(v ? [...cats, c.id] : cats.filter((x) => x !== c.id))}
              className="justify-center sm:justify-start"
            >
              {c.label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="qc-details"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-ink-2 hover:text-ink"
        >
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
          Agregar detalles
          {nDetails > 0 && <span className="rounded-full bg-surface-2 px-2 text-xs">{nDetails}</span>}
        </button>
        {open && (
          <div id="qc-details" className="anim-fade mt-3">
            <EntryDetailsFields value={details} onChange={setDetails} files={files} onFilesChange={setFiles} />
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p
          id="qc-status"
          role={status?.tone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={cn(
            'flex min-h-5 items-center gap-1.5 text-sm',
            status?.tone === 'error' && 'font-medium text-danger',
            status?.tone === 'ok' && 'text-ok',
            status?.tone === 'warn' && 'text-warn',
            status?.tone === 'muted' && 'text-ink-3',
          )}
        >
          {status?.tone === 'ok' && <CircleCheck className="size-4" aria-hidden />}
          {status?.tone === 'warn' && <CloudUpload className="size-4" aria-hidden />}
          {status?.tone === 'error' && <TriangleExclamationPoint className="size-4" aria-hidden />}
          {status?.text ?? <span className="hidden text-ink-3 sm:inline">{isMac ? '⌘' : 'Ctrl'} + Enter para guardar</span>}
        </p>
        <Button variant="primary" size="lg" onClick={() => void save()} loading={saving} className="w-full sm:w-auto sm:min-w-36" data-testid="quick-save">
          {justSaved ? (
            <>
              <Check className="animate-pop size-5" aria-hidden /> Guardado
            </>
          ) : (
            'Guardar'
          )}
        </Button>
      </div>
    </section>
  )
}

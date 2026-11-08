import { useEffect, useMemo, useState } from 'react'
import { CircleCheck, Copy, Link2, Pencil, Star, Trash } from 'lucide-react'
import type { Attachment, CategoryId, Entry, Stored } from '../db/types'
import type { DraftFile } from '../db/repo'
import { storageErrorMessage } from '../db/database'
import { CATEGORIES, STATUS_LABEL } from '../lib/constants'
import { formatDate, formatInstant, formatMinutes, relativeDay } from '../lib/dates'
import { timeSavingResult } from '../lib/metrics'
import { displayUrl } from '../lib/text'
import { nowISO } from '../lib/cn'
import { useData } from '../app/data'
import { useWorkspace } from '../app/session'
import { useEntryUi } from '../app/entry-ui'
import { AttachmentThumb, CategoryIcon, CategoryTags, FullImage, projectAndBrand } from './bits'
import { EntryCard, SyncBadge } from './EntryCard'
import { EntryDetailsFields, emptyDetails, type Details } from './EntryFields'
import { ProjectPicker, type PickerValue } from './ProjectPicker'
import { Badge, Button, Chip, Switch } from './ui/ui'
import { Modal, Sheet } from './ui/overlay'
import { useToast } from './ui/toast'

export function EntrySheet({
  state,
  onClose,
  onEdit,
  onCreated,
}: {
  state: { id: string; edit: boolean; isNew?: boolean; date?: string; template?: Partial<Entry> } | null
  onClose: () => void
  onEdit: (edit: boolean) => void
  onCreated: (id: string) => void
}) {
  const { entries, today } = useData()
  const entry = state ? entries.find((e) => e.id === state.id) : undefined
  const open = !!state && (!!entry || !!state.isNew)

  useEffect(() => {
    if (state && !state.isNew && !entry) onClose()
  }, [state, entry, onClose])

  const blank: Entry = useMemo(() => {
    const now = nowISO()
    return { id: state?.id ?? '', date: state?.date ?? today, text: '', categories: [], skills: [], links: [], attachmentIds: [], createdAt: now, updatedAt: now, ...state?.template }
  }, [state?.id, state?.date, state?.template, today])

  if (!state) return null
  const editing = state.edit || (state.isNew && !entry)
  const title = state.isNew && !entry ? 'Nuevo registro' : entry ? relativeDay(entry.date, today) : ''
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={editing ? (state.isNew && !entry ? 'Nuevo registro' : 'Editar registro') : title}
      description={editing ? 'Solo el texto es obligatorio.' : entry ? formatDate(entry.date, 'full') : undefined}
      guard={editing}
      wide={editing}
    >
      {editing ? (
        <EntryEditor key={state.id} initial={entry ?? blank} isNew={!entry} onCancel={() => (entry ? onEdit(false) : onClose())} onSaved={() => (entry ? onEdit(false) : onCreated(state.id))} />
      ) : entry ? (
        <EntryView entry={entry} onEdit={() => onEdit(true)} />
      ) : null}
    </Sheet>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 border-t border-line py-3 sm:grid-cols-[150px_1fr] sm:gap-4">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="min-w-0 text-[15px] break-words whitespace-pre-line text-ink">{children}</dd>
    </div>
  )
}

function EntryView({ entry, onEdit }: { entry: Stored<Entry>; onEdit: () => void }) {
  const { projects, brands, attachments } = useData()
  const ui = useEntryUi()
  const [lightbox, setLightbox] = useState<Attachment | null>(null)
  const { project, brand } = projectAndBrand(entry, projects, brands)
  const atts = entry.attachmentIds.map((id) => attachments.find((a) => a.id === id)).filter(Boolean) as Attachment[]
  const ts = timeSavingResult(entry.timeSaving)
  const f = entry.feedback

  return (
    <div className="pb-2">
      {entry.pending && (
        <div className="mb-4 rounded-2xl border border-dashed border-[color-mix(in_oklab,var(--warn)_50%,transparent)] bg-warn-soft p-4">
          <p className="text-sm font-semibold text-warn">Por confirmar · excluido de métricas</p>
          {entry.pendingNote && <p className="mt-1 text-sm text-ink-2">{entry.pendingNote}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => void ui.confirmPending(entry)}>
              <CircleCheck className="size-4" /> Confirmar
            </Button>
            <Button size="sm" onClick={onEdit}>
              <Pencil className="size-4" /> Corregir
            </Button>
          </div>
        </div>
      )}
      <p className="text-[17px] leading-relaxed whitespace-pre-line text-ink">{entry.text}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <CategoryTags ids={entry.categories} />
        {entry.evidence && (
          <Badge>
            <Star className="size-3 fill-[var(--cat-logro)] text-[var(--cat-logro)]" aria-hidden /> Evidencia
          </Badge>
        )}
      </div>

      <dl className="mt-5">
        {(project || brand) && (
          <Row label="Proyecto / marca">
            {project?.name}
            {project && brand && ' · '}
            {brand?.name}
            {project?.brandUnconfirmed && <span className="ml-1 text-sm text-ink-3">(marca por confirmar)</span>}
          </Row>
        )}
        {entry.outcome && <Row label="Resultado">{entry.outcome}</Row>}
        {entry.status && <Row label="Estado">{STATUS_LABEL[entry.status]}</Row>}
        {entry.contribution && <Row label="Mi contribución">{entry.contribution}</Row>}
        {entry.collaborators && <Row label="Colaboradores">{entry.collaborators}</Row>}
        {entry.skills.length > 0 && <Row label="Habilidad practicada">{entry.skills.join(', ')}</Row>}
        {entry.timeSpentMin ? <Row label="Tiempo dedicado">{formatMinutes(entry.timeSpentMin)}</Row> : null}
        {f && (f.quote || f.interpretation || f.person) && (
          <Row label="Feedback">
            {f.quote ? (
              <blockquote className="border-l-2 border-[var(--cat-feedback)] pl-3">
                <span className="text-xs font-semibold text-ink-3 uppercase">Cita textual</span>
                <p className="mt-0.5">«{f.quote}»</p>
              </blockquote>
            ) : (
              <span className="text-sm text-ink-3">Sin cita textual registrada.</span>
            )}
            {(f.person || f.date) && (
              <p className="mt-1 text-sm text-ink-2">
                — {f.person ?? 'persona no registrada'}
                {f.date ? `, ${formatDate(f.date, 'medium')}` : ''}
              </p>
            )}
            {f.interpretation && (
              <div className="mt-2 rounded-xl bg-surface-2 px-3 py-2">
                <span className="text-xs font-semibold text-ink-3 uppercase">Mi interpretación</span>
                <p className="mt-0.5">{f.interpretation}</p>
              </div>
            )}
          </Row>
        )}
        {entry.timeSaving && (entry.timeSaving.baselineMin !== undefined || entry.timeSaving.newMin !== undefined) && (
          <Row label="Ahorro de tiempo">
            {ts.ok ? (
              <>
                {entry.timeSaving.scope}: de {formatMinutes(entry.timeSaving.baselineMin!)} a {formatMinutes(entry.timeSaving.newMin!)} ·{' '}
                <strong>
                  {formatMinutes(Math.abs(ts.diffMin))} {ts.diffMin >= 0 ? 'menos' : 'más'} ({Math.abs(ts.pct)} %)
                </strong>{' '}
                <Badge tone={ts.certainty === 'medido' ? 'ok' : 'warn'}>{ts.certainty}</Badge>
                {entry.timeSaving.baselineSource && <span className="mt-1 block text-sm text-ink-3">Referencia: {entry.timeSaving.baselineSource}</span>}
              </>
            ) : (
              <span className="text-ink-2">Datos incompletos: falta {ts.missing.join(', ')}. No se calcula diferencia.</span>
            )}
          </Row>
        )}
        {entry.links.length > 0 && (
          <Row label="Enlaces">
            <ul className="grid gap-1">
              {entry.links.map((l) => (
                <li key={l}>
                  <a href={l} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-accent-ink underline underline-offset-2">
                    <Link2 className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{displayUrl(l)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </Row>
        )}
        {atts.length > 0 && (
          <Row label="Capturas">
            <div className="flex flex-wrap gap-2">
              {atts.map((a) => (
                <AttachmentThumb key={a.id} att={a} onOpen={() => setLightbox(a)} />
              ))}
            </div>
          </Row>
        )}
        {entry.nextStep && <Row label="Próximo paso">{entry.nextStep}</Row>}
        <Row label="Estado de guardado">
          <span className="flex flex-wrap items-center gap-2">
            <SyncBadge entry={entry} />
            <span className="text-xs text-ink-3">Creado {formatInstant(entry.createdAt)}</span>
          </span>
        </Row>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        <Button variant="primary" onClick={onEdit}>
          <Pencil className="size-4" /> Editar
        </Button>
        <Button onClick={() => void ui.toggleEvidence(entry)} aria-pressed={!!entry.evidence}>
          <Star className={entry.evidence ? 'size-4 fill-[var(--cat-logro)] text-[var(--cat-logro)]' : 'size-4'} />
          {entry.evidence ? 'Evidencia' : 'Marcar evidencia'}
        </Button>
        <Button onClick={() => void ui.duplicateAsDraft(entry)}>
          <Copy className="size-4" /> Duplicar como borrador
        </Button>
        <Button variant="danger" onClick={() => void ui.removeEntry(entry)}>
          <Trash className="size-4" /> Eliminar
        </Button>
      </div>
      <Modal open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)} title={lightbox?.name ?? ''} size="lg">
        {lightbox && <FullImage att={lightbox} />}
      </Modal>
    </div>
  )
}

function EntryEditor({ initial, isNew, onCancel, onSaved }: { initial: Entry; isNew: boolean; onCancel: () => void; onSaved: () => void }) {
  const { repo } = useWorkspace()
  const { attachments, today } = useData()
  const toast = useToast()
  const [date, setDate] = useState(initial.date)
  const [text, setText] = useState(initial.text)
  const [cats, setCats] = useState<CategoryId[]>(initial.categories)
  const [pick, setPick] = useState<PickerValue>({ projectId: initial.projectId, brandId: initial.brandId })
  const [pending, setPending] = useState(!!initial.pending)
  const [details, setDetails] = useState<Details>(() => ({ ...emptyDetails(), ...pickDetails(initial) }))
  const [files, setFiles] = useState<DraftFile[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string>()
  const existing = initial.attachmentIds.map((id) => attachments.find((a) => a.id === id)).filter(Boolean) as Attachment[]

  const save = async () => {
    if (saving) return
    if (!text.trim()) return setErr('Escribe qué hiciste.')
    if (!date || date > today) return setErr('La fecha no puede ser futura.')
    setSaving(true)
    setErr(undefined)
    const now = nowISO()
    const next: Entry = {
      ...initial,
      ...details,
      date,
      text: text.trim(),
      categories: cats,
      projectId: pick.projectId,
      brandId: pick.projectId ? undefined : pick.brandId,
      pending: pending || undefined,
      pendingNote: pending ? initial.pendingNote : undefined,
      skills: details.skills ?? [],
      links: details.links ?? [],
      createdAt: isNew ? now : initial.createdAt,
      updatedAt: now,
    }
    try {
      if (isNew) await repo.saveNewEntry(next, files)
      else await repo.updateEntry(next, files, removed)
      toast({ tone: 'ok', message: 'Guardado en este dispositivo.' })
      onSaved()
    } catch (e) {
      setErr(storageErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="grid gap-5 pb-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          void save()
        }
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor="ed-date" className="text-sm font-medium">
          Fecha
        </label>
        <input id="ed-date" type="date" className="field w-auto max-w-[220px]" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="ed-text" className="text-sm font-medium">
          ¿Qué hiciste?
        </label>
        <textarea id="ed-text" className="field min-h-32 text-[16px] leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} maxLength={20000} aria-invalid={err && !text.trim() ? true : undefined} />
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Categorías (opcional)</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <Chip key={c.id} pressed={cats.includes(c.id)} color={c.color} icon={<CategoryIcon id={c.id} />} onPressedChange={(v) => setCats(v ? [...cats, c.id] : cats.filter((x) => x !== c.id))}>
              {c.label}
            </Chip>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">Proyecto o marca (opcional)</span>
        <ProjectPicker value={pick} onChange={setPick} />
      </div>
      {initial.pending !== undefined || pending ? <Switch checked={pending} onChange={setPending} label="Por confirmar" description="Los registros por confirmar no cuentan en métricas." /> : null}
      <EntryDetailsFields value={details} onChange={setDetails} files={files} onFilesChange={setFiles} existing={existing} removed={removed} onRemoveExisting={(id) => setRemoved((r) => [...r, id])} />
      {err && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
          {err}
        </p>
      )}
      <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-line bg-surface px-5 pt-3 pb-1">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {isNew ? 'Guardar registro' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}

export function pickDetails(e: Partial<Entry>): Details {
  return {
    outcome: e.outcome,
    status: e.status,
    contribution: e.contribution,
    collaborators: e.collaborators,
    skills: e.skills ?? [],
    timeSpentMin: e.timeSpentMin,
    feedback: e.feedback,
    links: e.links ?? [],
    nextStep: e.nextStep,
    timeSaving: e.timeSaving,
    evidence: e.evidence,
  }
}

/** Lista de registros de origen (p. ej. detrás de una cifra o una afirmación). */
export function EntriesSheet({ state, onClose }: { state: { title: string; ids: string[]; note?: string } | null; onClose: () => void }) {
  const { entries, today } = useData()
  const list = useMemo(() => {
    if (!state) return []
    const ids = new Set(state.ids)
    return entries.filter((e) => ids.has(e.id))
  }, [state, entries])
  const missing = state ? new Set(state.ids).size - list.length : 0
  return (
    <Sheet open={!!state} onOpenChange={(o) => !o && onClose()} title={state?.title ?? ''} description={`${list.length} ${list.length === 1 ? 'registro' : 'registros'}${state?.note ? ` · ${state.note}` : ''}`}>
      <div className="grid gap-2.5 pb-4">
        {list.map((e) => (
          <EntryCard key={e.id} entry={e} showDate={relativeDay(e.date, today)} />
        ))}
        {missing > 0 && <p className="text-sm text-ink-3">{missing} registro(s) de origen ya no existen.</p>}
        {!list.length && !missing && <p className="text-sm text-ink-3">Sin registros.</p>}
      </div>
    </Sheet>
  )
}

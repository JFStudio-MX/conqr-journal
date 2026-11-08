import { useEffect, useState } from 'react'
import { Check, CircleCheck, Ellipsis, Link2, Pencil, Plus, Trash, User, X } from 'lucide-react'
import type { ActionItem, Attachment, ChangeRequest, ChangeStatus, MeetingItem, Stored } from '../../db/types'
import type { DraftFile } from '../../db/repo'
import { storageErrorMessage } from '../../db/database'
import { ACTION_STATUS_LABEL, CHANGE_STATUSES, CHANGE_STATUS_LABEL } from '../../lib/constants'
import { formatDate, todayISO } from '../../lib/dates'
import { displayUrl, excerpt, safeUrl } from '../../lib/text'
import { cn, nowISO, uid } from '../../lib/cn'
import { useData } from '../../app/data'
import { useWorkspace } from '../../app/session'
import { useMeetingUi as useMeetingUiLazy } from '../../app/meeting-ui'
import { AttachmentThumb } from '../bits'
import { FilesInput } from '../EntryFields'
import { Badge, Button, SelectField, Switch, TextArea, TextField } from '../ui/ui'
import { Menu, MenuItem, MenuSeparator, Modal, Sheet, useConfirm } from '../ui/overlay'
import { useToast } from '../ui/toast'

export function ReviewBadge({ review }: { review: 'por_revisar' | 'revisado' }) {
  return review === 'por_revisar' ? <Badge tone="warn">Por revisar</Badge> : null
}

/** Lista editable (decisiones, ideas, preguntas, materiales). Lo que escribes tú entra como revisado. */
export function ItemList({
  label,
  items,
  onChange,
  placeholder,
  allowSupersede,
  emptyText,
}: {
  label: string
  items: MeetingItem[]
  onChange: (items: MeetingItem[]) => void
  placeholder: string
  allowSupersede?: boolean
  emptyText?: string
}) {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [supersedeFor, setSupersedeFor] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const update = (id: string, patch: Partial<MeetingItem>) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  const add = () => {
    if (!text.trim()) return
    onChange([...items, { id: uid(), text: text.trim().slice(0, 4000), review: 'revisado' }])
    setText('')
  }
  return (
    <div>
      {items.length ? (
        <ul className="grid gap-2">
          {items.map((i) => (
            <li key={i.id} className={cn('rounded-xl border px-3 py-2.5', i.review === 'por_revisar' ? 'border-dashed border-[color-mix(in_oklab,var(--warn)_55%,transparent)] bg-warn-soft/40' : 'border-line bg-surface')}>
              {editing === i.id ? (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (draft.trim()) update(i.id, { text: draft.trim() })
                    setEditing(null)
                  }}
                >
                  <label className="sr-only" htmlFor={`it-${i.id}`}>
                    Editar
                  </label>
                  <input id={`it-${i.id}`} className="field" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                  <Button type="submit" size="icon" variant="secondary" aria-label="Guardar">
                    <Check className="size-5" />
                  </Button>
                </form>
              ) : (
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[15px] text-ink', i.superseded && 'text-ink-3 line-through')}>{i.text}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <ReviewBadge review={i.review} />
                      {i.superseded && <Badge>Sustituida{i.supersededNote ? `: ${excerpt(i.supersededNote, 60)}` : ''}</Badge>}
                      {i.source && <span className="text-xs text-ink-3">Fuente: {excerpt(i.source, 80)}</span>}
                    </div>
                    {i.review === 'por_revisar' && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => update(i.id, { review: 'revisado' })}>
                          <CircleCheck className="size-4" /> Confirmar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(i.id)
                            setDraft(i.text)
                          }}
                        >
                          <Pencil className="size-4" /> Corregir
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onChange(items.filter((x) => x.id !== i.id))}>
                          <X className="size-4" /> Descartar
                        </Button>
                      </div>
                    )}
                  </div>
                  {i.review === 'revisado' && (
                    <Menu
                      trigger={
                        <Button size="icon-sm" variant="ghost" aria-label={`Acciones: ${excerpt(i.text, 40)}`}>
                          <Ellipsis className="size-5" />
                        </Button>
                      }
                    >
                      <MenuItem
                        icon={<Pencil />}
                        onSelect={() => {
                          setEditing(i.id)
                          setDraft(i.text)
                        }}
                      >
                        Editar
                      </MenuItem>
                      {allowSupersede && (
                        <MenuItem
                          onSelect={() => {
                            if (i.superseded) update(i.id, { superseded: undefined, supersededNote: undefined })
                            else {
                              setSupersedeFor(i.id)
                              setNote('')
                            }
                          }}
                        >
                          {i.superseded ? 'Quitar “sustituida”' : 'Marcar como sustituida'}
                        </MenuItem>
                      )}
                      <MenuSeparator />
                      <MenuItem icon={<Trash />} danger onSelect={() => onChange(items.filter((x) => x.id !== i.id))}>
                        Eliminar
                      </MenuItem>
                    </Menu>
                  )}
                </div>
              )}
              {supersedeFor === i.id && (
                <form
                  className="mt-2 grid gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    update(i.id, { superseded: true, supersededNote: note.trim() || undefined })
                    setSupersedeFor(null)
                  }}
                >
                  <label htmlFor={`sup-${i.id}`} className="text-sm font-medium">
                    ¿Qué acuerdo la sustituye? <span className="font-normal text-ink-3">(opcional; esta se conserva en el historial)</span>
                  </label>
                  <input id={`sup-${i.id}`} className="field" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" variant="secondary">
                      Marcar como sustituida
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSupersedeFor(null)}>
                      Cancelar
                    </Button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : (
        emptyText && <p className="text-sm text-ink-3">{emptyText}</p>
      )}
      <div className="mt-2 flex gap-2">
        <label htmlFor={`add-${label}`} className="sr-only">
          Agregar a {label}
        </label>
        <input
          id={`add-${label}`}
          className="field"
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <Button variant="secondary" size="icon" aria-label={`Agregar a ${label}`} onClick={add}>
          <Plus className="size-5" />
        </Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ acciones

export function ActionRow({ action, showContext }: { action: Stored<ActionItem>; showContext?: boolean }) {
  const { repo } = useWorkspace()
  const { meetings, projects, today } = useData()
  const toast = useToast()
  const [edit, setEdit] = useState(false)
  const m = action.meetingId ? meetings.find((x) => x.id === action.meetingId) : undefined
  const p = action.projectId ? projects.find((x) => x.id === action.projectId) : undefined
  const overdue = action.status === 'confirmada' && action.dueDate && action.dueDate < today
  const setStatus = async (status: ActionItem['status']) => {
    try {
      await repo.put('actions', { ...action, status, doneAt: status === 'hecha' ? nowISO() : undefined })
      if (status === 'hecha') toast({ tone: 'ok', message: 'Acción marcada como hecha.', action: { label: 'Deshacer', onClick: () => void repo.put('actions', { ...action, status: 'confirmada', doneAt: undefined }) } })
    } catch (e) {
      toast({ tone: 'error', message: storageErrorMessage(e) })
    }
  }
  return (
    <li className={cn('flex items-start gap-3 rounded-xl border px-3 py-2.5', action.status === 'por_revisar' ? 'border-dashed border-[color-mix(in_oklab,var(--warn)_55%,transparent)] bg-warn-soft/40' : 'border-line bg-surface')}>
      {action.status === 'confirmada' || action.status === 'hecha' ? (
        <input
          type="checkbox"
          className="mt-1 size-5 shrink-0 accent-[var(--accent-ink)]"
          checked={action.status === 'hecha'}
          onChange={(e) => void setStatus(e.target.checked ? 'hecha' : 'confirmada')}
          aria-label={`Marcar como hecha: ${action.text}`}
        />
      ) : (
        <span className="mt-1.5 size-4 shrink-0 rounded-full border-2 border-dashed border-line-strong" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn('text-[15px] text-ink', (action.status === 'hecha' || action.status === 'descartada') && 'text-ink-3 line-through')}>{action.text}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
          {action.status !== 'confirmada' && <Badge tone={action.status === 'por_revisar' ? 'warn' : 'neutral'}>{ACTION_STATUS_LABEL[action.status]}</Badge>}
          <span className="inline-flex items-center gap-1">
            <User className="size-3" aria-hidden />
            {action.owner?.trim() || 'Responsable por definir'}
            {action.mine && <Badge tone="accent">Mía</Badge>}
          </span>
          <span className={cn(overdue && 'font-semibold text-danger')}>· {action.dueDate ? `${overdue ? 'Venció' : 'Para'} el ${formatDate(action.dueDate, 'dayMonth')}` : 'Sin fecha'}</span>
          {showContext && (m || p) && <span>· {[p?.name, m?.title].filter(Boolean).join(' / ')}</span>}
        </p>
        {action.status === 'por_revisar' && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void setStatus('confirmada')}>
              <CircleCheck className="size-4" /> Confirmar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>
              <Pencil className="size-4" /> Corregir
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void setStatus('descartada')}>
              <X className="size-4" /> Descartar
            </Button>
          </div>
        )}
      </div>
      {action.status !== 'por_revisar' && (
        <Button size="icon-sm" variant="ghost" aria-label={`Editar acción ${excerpt(action.text, 40)}`} onClick={() => setEdit(true)}>
          <Pencil className="size-4" />
        </Button>
      )}
      <ActionEditor open={edit} onClose={() => setEdit(false)} action={action} />
    </li>
  )
}

export function ActionEditor({ open, onClose, action, meetingId, projectId }: { open: boolean; onClose: () => void; action?: ActionItem; meetingId?: string; projectId?: string }) {
  const { repo } = useWorkspace()
  const toast = useToast()
  const [text, setText] = useState('')
  const [owner, setOwner] = useState('')
  const [mine, setMine] = useState(false)
  const [due, setDue] = useState('')
  const [status, setStatus] = useState<ActionItem['status']>('confirmada')
  const [err, setErr] = useState<string>()
  useEffect(() => {
    if (!open) return
    setText(action?.text ?? '')
    setOwner(action?.owner ?? '')
    setMine(!!action?.mine)
    setDue(action?.dueDate ?? '')
    setStatus(action?.status === 'por_revisar' ? 'confirmada' : (action?.status ?? 'confirmada'))
    setErr(undefined)
  }, [open, action])
  const save = async () => {
    if (!text.trim()) return setErr('Describe la acción.')
    const now = nowISO()
    try {
      await repo.put('actions', {
        id: action?.id ?? uid(),
        meetingId: action?.meetingId ?? meetingId,
        projectId: action?.projectId ?? projectId,
        text: text.trim().slice(0, 2000),
        owner: owner.trim() || undefined,
        mine: mine || undefined,
        dueDate: due || undefined,
        status,
        source: action?.source,
        key: action?.key,
        doneAt: status === 'hecha' ? (action?.doneAt ?? now) : undefined,
        createdAt: action?.createdAt ?? now,
        updatedAt: now,
      })
      onClose()
    } catch (e) {
      toast({ tone: 'error', message: storageErrorMessage(e) })
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={action ? 'Acción' : 'Nueva acción'}
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
        <TextArea label="Qué hay que hacer" rows={2} value={text} onChange={(e) => setText(e.target.value)} error={err} />
        <TextField label="Responsable" optional value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Nombre de quien lo hará" hint="No se asigna a nadie por defecto." />
        <Switch checked={mine} onChange={setMine} label="Es una tarea mía" description="Las tuyas confirmadas aparecen en “Hoy” cuando se acerca la fecha." />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Fecha" optional type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <SelectField label="Estado" value={status} onChange={(e) => setStatus(e.target.value as ActionItem['status'])}>
            <option value="confirmada">Confirmada</option>
            <option value="hecha">Hecha</option>
            <option value="descartada">Descartada</option>
          </SelectField>
        </div>
        {action?.source && <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-ink-2">Fuente: {action.source}</p>}
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ cambios

export function ChangeCard({ change, all }: { change: Stored<ChangeRequest>; all: Stored<ChangeRequest>[] }) {
  const { meetings, attachments } = useData()
  const { editChange } = useMeetingUiLazy()
  const replacedBy = all.find((c) => c.supersedesId === change.id)
  const replaces = change.supersedesId ? all.find((c) => c.id === change.supersedesId) : undefined
  const m = change.meetingId ? meetings.find((x) => x.id === change.meetingId) : undefined
  const atts = change.attachmentIds.map((id) => attachments.find((a) => a.id === id)).filter(Boolean) as Attachment[]
  const where = [change.piece, change.version ? `v${change.version.replace(/^v/i, '')}` : '', change.location].filter(Boolean).join(' · ')
  return (
    <article className={cn('rounded-2xl border p-3.5', change.review === 'por_revisar' ? 'border-dashed border-[color-mix(in_oklab,var(--warn)_55%,transparent)] bg-warn-soft/40' : 'border-line bg-surface', replacedBy && 'opacity-75')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {where && <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{where}</p>}
          <p className={cn('mt-0.5 text-[15px] text-ink', replacedBy && 'line-through')}>{change.request}</p>
          {change.keep && <p className="mt-1 text-sm text-ink-2">Conservar: {change.keep}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
            <ReviewBadge review={change.review} />
            <Badge tone={change.status === 'aprobado' ? 'ok' : change.status === 'por_aclarar' ? 'outline' : 'neutral'}>{CHANGE_STATUS_LABEL[change.status]}</Badge>
            {replacedBy && <Badge tone="danger">Sustituido por un cambio posterior</Badge>}
            {replaces && <Badge tone="neutral">Sustituye a: {excerpt(replaces.request, 40)}</Badge>}
            <span>Solicitó: {change.requestedBy || 'no registrado'}</span>
            <span>· Responsable: {change.assignee || 'por definir'}</span>
            <span>· {change.agreedDate ? `Acordado para el ${formatDate(change.agreedDate, 'dayMonth')}` : 'Sin fecha acordada'}</span>
            {change.clientDate && <span>· El cliente pidió el {formatDate(change.clientDate, 'dayMonth')}</span>}
            {m && <span>· Junta: {excerpt(m.title, 40)}</span>}
          </div>
          {(change.source?.fragment || change.source?.link || change.source?.timestamp) && (
            <p className="mt-1.5 text-xs text-ink-3">
              Fuente: {change.source.timestamp && `[${change.source.timestamp}] `}
              {change.source.fragment && excerpt(change.source.fragment, 100)}
              {change.source.link && (
                <a href={change.source.link} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-accent-ink underline">
                  <Link2 className="size-3" aria-hidden /> {displayUrl(change.source.link)}
                </a>
              )}
            </p>
          )}
          {atts.length > 0 && (
            <div className="mt-2 flex gap-2">
              {atts.map((a) => (
                <AttachmentThumb key={a.id} att={a} className="size-14" />
              ))}
            </div>
          )}
        </div>
        <Button size="icon-sm" variant="ghost" aria-label={`Editar cambio ${excerpt(change.request, 40)}`} onClick={() => editChange({ change })}>
          <Pencil className="size-4" />
        </Button>
      </div>
    </article>
  )
}

export interface ChangeEditorState {
  change?: ChangeRequest
  meetingId?: string
  projectId?: string
}

export function ChangeEditorSheet({ state, onClose }: { state: ChangeEditorState | null; onClose: () => void }) {
  const { repo } = useWorkspace()
  const { changes, attachments, meetings } = useData()
  const toast = useToast()
  const { ask, node } = useConfirm()
  const c = state?.change
  const [f, setF] = useState<ChangeRequest | null>(null)
  const [files, setFiles] = useState<DraftFile[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [err, setErr] = useState<string>()
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!state) return
    const now = nowISO()
    const m = state.meetingId ? meetings.find((x) => x.id === state.meetingId) : undefined
    setF(
      c ?? {
        id: uid(),
        meetingId: state.meetingId,
        projectId: state.projectId ?? m?.projectId,
        request: '',
        status: 'por_aclarar',
        review: 'revisado',
        attachmentIds: [],
        createdAt: now,
        updatedAt: now,
      },
    )
    setFiles([])
    setRemoved([])
    setErr(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])
  if (!state || !f) return null
  const set = <K extends keyof ChangeRequest>(k: K, v: ChangeRequest[K]) => setF({ ...f, [k]: v })
  const others = changes.filter((x) => x.id !== f.id && (f.projectId ? x.projectId === f.projectId : x.meetingId === f.meetingId))
  const existing = f.attachmentIds.map((id) => attachments.find((a) => a.id === id)).filter(Boolean) as Attachment[]
  const save = async (markReviewed = false) => {
    if (!f.request.trim()) return setErr('Describe qué se pidió.')
    const link = f.source?.link ? safeUrl(f.source.link) : undefined
    if (f.source?.link && !link) return setErr('El enlace de la fuente no es válido.')
    setSaving(true)
    try {
      await repo.saveChange({ ...f, request: f.request.trim(), review: markReviewed ? 'revisado' : f.review, source: f.source ? { ...f.source, link: link ?? undefined } : undefined }, files, removed)
      toast({ tone: 'ok', message: 'Cambio guardado.' })
      onClose()
    } catch (e) {
      setErr(storageErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Sheet
      open={!!state}
      onOpenChange={(o) => !o && onClose()}
      title={c ? 'Cambio solicitado' : 'Nuevo cambio'}
      description="Distingue la fecha que pidió el cliente de la que aceptó el equipo."
      guard
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {c && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={async () => {
                const ok = await ask({ title: '¿Eliminar este cambio?', body: 'Si fue sustituido por otro, mejor márcalo así para conservar el historial.', confirm: 'Eliminar', tone: 'danger' })
                if (!ok) return
                await repo.deleteChange(c.id)
                onClose()
              }}
            >
              <Trash className="size-4" /> Eliminar
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          {f.review === 'por_revisar' && (
            <Button onClick={() => void save(true)} loading={saving}>
              Confirmar y guardar
            </Button>
          )}
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            Guardar
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 pb-4">
        {f.review === 'por_revisar' && <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">Detectado automáticamente: está “por revisar” y no cuenta como acuerdo hasta que lo confirmes.</p>}
        <TextArea label="Qué se pidió" rows={3} value={f.request} onChange={(e) => set('request', e.target.value)} error={err} />
        <TextArea label="Qué debe conservarse" optional rows={2} value={f.keep ?? ''} onChange={(e) => set('keep', e.target.value || undefined)} />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Pieza" optional value={f.piece ?? ''} onChange={(e) => set('piece', e.target.value || undefined)} placeholder="Ej. Video 15 s" />
          <TextField label="Versión" optional value={f.version ?? ''} onChange={(e) => set('version', e.target.value || undefined)} placeholder="Ej. 3" />
          <TextField label="Página, escena o segundo" optional value={f.location ?? ''} onChange={(e) => set('location', e.target.value || undefined)} placeholder="Ej. 0:12–0:15" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Quién lo solicitó" optional value={f.requestedBy ?? ''} onChange={(e) => set('requestedBy', e.target.value || undefined)} />
          <TextField label="Responsable de ejecutarlo" optional value={f.assignee ?? ''} onChange={(e) => set('assignee', e.target.value || undefined)} hint="No se asigna a nadie por defecto." />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Fecha que pidió el cliente" optional type="date" value={f.clientDate ?? ''} onChange={(e) => set('clientDate', e.target.value || undefined)} />
          <TextField label="Fecha aceptada por el equipo" optional type="date" value={f.agreedDate ?? ''} onChange={(e) => set('agreedDate', e.target.value || undefined)} hint={f.agreedDate ? undefined : 'Vacía = “Sin fecha acordada”.'} />
        </div>
        <SelectField label="Estado" value={f.status} onChange={(e) => set('status', e.target.value as ChangeStatus)}>
          {CHANGE_STATUSES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Sustituye a un cambio anterior" optional value={f.supersedesId ?? ''} onChange={(e) => set('supersedesId', e.target.value || undefined)} hint="Ambos se conservan en el historial.">
          <option value="">No sustituye a ninguno</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {formatDate(todayISO(new Date(o.createdAt)), 'dayMonth')} · {excerpt(o.request, 60)}
            </option>
          ))}
        </SelectField>
        <fieldset className="grid gap-3 rounded-2xl border border-line p-3">
          <legend className="px-1 text-sm font-medium">Fuente</legend>
          <TextArea label="Fragmento de notas" optional rows={2} value={f.source?.fragment ?? ''} onChange={(e) => set('source', { ...f.source, fragment: e.target.value || undefined })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Enlace" optional type="url" inputMode="url" value={f.source?.link ?? ''} onChange={(e) => set('source', { ...f.source, link: e.target.value || undefined })} />
            <TextField label="Marca de tiempo" optional value={f.source?.timestamp ?? ''} onChange={(e) => set('source', { ...f.source, timestamp: e.target.value || undefined })} placeholder="00:12:30" />
          </div>
        </fieldset>
        <FilesInput files={files} onFilesChange={setFiles} existing={existing.filter((a) => !removed.includes(a.id))} onRemoveExisting={(id) => setRemoved((r) => [...r, id])} />
      </div>
      {node}
    </Sheet>
  )
}

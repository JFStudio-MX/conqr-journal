import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ClipboardCopy, FileText, Link2, LockOpen, NotebookPen, Plus, Search, Trash, Upload, WandSparkles } from 'lucide-react'
import type { Meeting, MeetingClosing, Stored, Transcript } from '../../db/types'
import { storageErrorMessage } from '../../db/database'
import { stripMeta, stableStringify } from '../../lib/backup'
import { TRANSCRIPT_MAX_CHARS } from '../../lib/constants'
import { addDays, formatDate, formatInstant, isISODate } from '../../lib/dates'
import { buildMinutes, closingDraft, contentHash, detectFormat, extractProposals, parseSubtitles, pendingReviewCount } from '../../lib/meetings'
import { displayUrl, excerpt, plural, safeUrl } from '../../lib/text'
import { cn, nowISO, uid } from '../../lib/cn'
import { useData } from '../../app/data'
import { useWorkspace } from '../../app/session'
import { useEntryUi } from '../../app/entry-ui'
import { useMeetingUi } from '../../app/meeting-ui'
import { EntryCard } from '../EntryCard'
import { Badge, Button, SelectField, TextArea, TextField } from '../ui/ui'
import { Modal, Sheet, useConfirm } from '../ui/overlay'
import { useToast } from '../ui/toast'
import { ActionEditor, ActionRow, ChangeCard, ItemList, ReviewBadge } from './parts'

export function MeetingSheet({ state, onClose, onCreated }: { state: { id?: string; projectId?: string; date?: string } | null; onClose: () => void; onCreated: (id: string) => void }) {
  const { meetings, projects } = useData()
  const meeting = state?.id ? meetings.find((m) => m.id === state.id) : undefined
  if (!state) return null
  const project = meeting?.projectId ? projects.find((p) => p.id === meeting.projectId) : undefined
  return (
    <Sheet
      open={!!state}
      onOpenChange={(o) => !o && onClose()}
      title={meeting ? meeting.title : 'Nueva junta'}
      description={meeting ? `${formatDate(meeting.date, 'full')}${project ? ` · ${project.name}` : ''}` : 'Solo el título y la fecha son obligatorios.'}
      wide
      guard={!meeting}
    >
      {meeting ? <MeetingEditor key={meeting.id} meeting={meeting} onDeleted={onClose} /> : <NewMeetingForm init={state} onCreated={onCreated} onCancel={onClose} />}
    </Sheet>
  )
}

function NewMeetingForm({ init, onCreated, onCancel }: { init: { projectId?: string; date?: string }; onCreated: (id: string) => void; onCancel: () => void }) {
  const { projects, today } = useData()
  const { repo } = useWorkspace()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(init.date ?? today)
  const [projectId, setProjectId] = useState(init.projectId ?? '')
  const [participants, setParticipants] = useState('')
  const [link, setLink] = useState('')
  const [err, setErr] = useState<string>()
  const [busy, setBusy] = useState(false)
  const create = async () => {
    if (!title.trim()) return setErr('Escribe un título.')
    if (!isISODate(date)) return setErr('Elige una fecha.')
    const url = link.trim() ? safeUrl(link) : null
    if (link.trim() && !url) return setErr('El enlace no es válido.')
    setBusy(true)
    const now = nowISO()
    const m: Meeting = {
      id: uid(),
      title: title.trim().slice(0, 300),
      date,
      projectId: projectId || undefined,
      participants: participants.trim() || undefined,
      sourceLink: url ?? undefined,
      decisions: [],
      ideas: [],
      questions: [],
      materials: [],
      entryIds: [],
      createdAt: now,
      updatedAt: now,
    }
    try {
      await repo.put('meetings', m)
      onCreated(m.id)
    } catch (e) {
      setErr(storageErrorMessage(e))
      setBusy(false)
    }
  }
  return (
    <form
      className="grid gap-4 pb-4"
      onSubmit={(e) => {
        e.preventDefault()
        void create()
      }}
    >
      <TextField label="Título" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Revisión de video con cliente" autoFocus maxLength={300} error={err} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <SelectField label="Proyecto" optional value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Sin proyecto</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField label="Participantes" optional value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder="Nombres separados por comas" />
      <TextField label="Enlace al documento original" optional type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://… (Teams, Drive, Notion…)" />
      <p className="text-xs text-ink-3">Sin grabación ni acceso a tu calendario: tú decides qué texto agregar.</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          Crear junta
        </Button>
      </div>
    </form>
  )
}

function Section({ title, hint, children, aside, id }: { title: string; hint?: ReactNode; children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <section className="border-t border-line pt-5" aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id={id} className="display text-lg leading-tight">
            {title}
          </h3>
          {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

function MeetingEditor({ meeting, onDeleted }: { meeting: Stored<Meeting>; onDeleted: () => void }) {
  const { repo, mode } = useWorkspace()
  const { projects, actions, changes, entries, today } = useData()
  const entryUi = useEntryUi()
  const { editChange } = useMeetingUi()
  const toast = useToast()
  const { ask, node } = useConfirm()
  const [m, setM] = useState<Meeting>(() => stripMeta(meeting) as Meeting)
  const pending = useRef(false)
  const lastSaved = useRef(stableStringify(stripMeta(meeting)))
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [closingOpen, setClosingOpen] = useState(false)
  const [newAction, setNewAction] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)

  // Si llega una versión nueva desde otro dispositivo y no hay edición local pendiente, se adopta.
  useEffect(() => {
    const incoming = stableStringify(stripMeta(meeting))
    if (!pending.current && incoming !== lastSaved.current) {
      setM(stripMeta(meeting) as Meeting)
      lastSaved.current = incoming
    }
  }, [meeting])

  const mRef = useRef(m)
  mRef.current = m
  const patch = (p: Partial<Meeting> | ((cur: Meeting) => Partial<Meeting>)) => {
    pending.current = true
    setM((cur) => ({ ...cur, ...(typeof p === 'function' ? p(cur) : p) }))
  }
  const flush = async () => {
    if (!pending.current) return
    const cur = mRef.current
    setSaveState('saving')
    try {
      await repo.put('meetings', cur)
      lastSaved.current = stableStringify(cur)
      pending.current = false
      setSaveState('saved')
    } catch (e) {
      setSaveState('error')
      toast({ tone: 'error', message: storageErrorMessage(e) })
      throw e
    }
  }
  useEffect(() => {
    if (!pending.current) return
    const t = window.setTimeout(() => void flush().catch(() => {}), 600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m])

  const mActions = actions.filter((a) => a.meetingId === m.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const mChanges = changes.filter((c) => c.meetingId === m.id)
  const projectChanges = changes.filter((c) => (m.projectId ? c.projectId === m.projectId : c.meetingId === m.id))
  const input = { meeting: m, projectName: projects.find((p) => p.id === m.projectId)?.name, actions: mActions, changes: mChanges }
  const toReview = pendingReviewCount(input) + (m.objectiveReview === 'por_revisar' ? 1 : 0)
  const linked = entries.filter((e) => m.entryIds.includes(e.id))

  return (
    <div className="grid gap-5 pb-8">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {m.closedAt ? <Badge tone="ok">Cerrada · {formatInstant(m.closedAt)}</Badge> : <Badge tone="outline">Abierta</Badge>}
        {toReview > 0 && <Badge tone="warn">{plural(toReview, 'propuesta por revisar', 'propuestas por revisar')}</Badge>}
        <span className="ml-auto text-xs text-ink-3" aria-live="polite">
          {saveState === 'saving' ? 'Guardando…' : saveState === 'saved' ? (mode === 'account' ? 'Guardado en este dispositivo · se sincroniza' : 'Guardado') : saveState === 'error' ? 'Error al guardar' : ''}
        </span>
      </div>

      <div className="grid gap-4">
        <TextField label="Título" value={m.title} onChange={(e) => patch({ title: e.target.value })} maxLength={300} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Fecha" type="date" value={m.date} onChange={(e) => e.target.value && patch({ date: e.target.value })} />
          <SelectField
            label="Proyecto"
            optional
            value={m.projectId ?? ''}
            onChange={(e) => {
              const projectId = e.target.value || undefined
              patch({ projectId })
              void repo.reassignMeetingProject(m.id, projectId)
            }}
          >
            <option value="">Sin proyecto</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField label="Participantes" optional value={m.participants ?? ''} onChange={(e) => patch({ participants: e.target.value || undefined })} />
        <SourceLinkField value={m.sourceLink} onChange={(v) => patch({ sourceLink: v })} />
      </div>

      <Section title="Mis notas" hint="Tus notas y correcciones. Se guardan aparte del texto original." id="mt-notes">
        <label htmlFor="mt-notes-ta" className="sr-only">
          Mis notas
        </label>
        <textarea id="mt-notes-ta" className="field min-h-32 leading-relaxed [field-sizing:content]" value={m.notes ?? ''} onChange={(e) => patch({ notes: e.target.value || undefined })} placeholder="Lo que quieras anotar…" />
      </Section>

      <TranscriptPanel meeting={m} flush={flush} />

      <Section title="Objetivo de la reunión" id="mt-obj">
        <TextArea label="Objetivo" rows={2} value={m.objective ?? ''} onChange={(e) => patch({ objective: e.target.value || undefined, objectiveReview: undefined })} />
        {m.objectiveReview === 'por_revisar' && (
          <div className="mt-2 flex items-center gap-2">
            <ReviewBadge review="por_revisar" />
            <Button size="sm" variant="secondary" onClick={() => patch({ objectiveReview: undefined })}>
              Confirmar objetivo
            </Button>
          </div>
        )}
      </Section>

      <Section title="Decisiones confirmadas" hint="Una sugerencia no es una decisión. Si un acuerdo cambia, márcalo como sustituido: no se borra." id="mt-dec">
        <ItemList label="decisiones" items={m.decisions} onChange={(decisions) => patch({ decisions })} placeholder="Agregar decisión confirmada" allowSupersede emptyText="Sin decisiones registradas." />
      </Section>

      <Section
        title="Cambios solicitados"
        id="mt-ch"
        aside={
          <Button size="sm" onClick={() => editChange({ meetingId: m.id, projectId: m.projectId })}>
            <Plus className="size-4" /> Agregar cambio
          </Button>
        }
      >
        {mChanges.length ? (
          <div className="grid gap-2">
            {mChanges.map((c) => (
              <ChangeCard key={c.id} change={c} all={projectChanges} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-3">Sin cambios registrados en esta junta.</p>
        )}
      </Section>

      <Section title="Ideas exploratorias" hint="Todavía no aprobadas." id="mt-ideas">
        <ItemList label="ideas" items={m.ideas} onChange={(ideas) => patch({ ideas })} placeholder="Agregar idea" emptyText="Sin ideas registradas." />
      </Section>

      <Section title="Preguntas pendientes" id="mt-q">
        <ItemList label="preguntas" items={m.questions} onChange={(questions) => patch({ questions })} placeholder="Agregar pregunta" emptyText="Sin preguntas pendientes." />
      </Section>

      <Section title="Materiales que debe enviar el cliente" id="mt-mat">
        <ItemList label="materiales" items={m.materials} onChange={(materials) => patch({ materials })} placeholder="Agregar material pendiente" emptyText="Sin materiales pendientes." />
      </Section>

      <Section
        title="Acciones, responsables y fechas"
        hint="Nadie queda asignado por defecto. Marca “Es una tarea mía” para verla en Hoy."
        id="mt-act"
        aside={
          <Button size="sm" onClick={() => setNewAction(true)}>
            <Plus className="size-4" /> Agregar acción
          </Button>
        }
      >
        {mActions.length ? (
          <ul className="grid gap-2">
            {mActions.map((a) => (
              <ActionRow key={a.id} action={a} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Sin acciones.</p>
        )}
        <ActionEditor open={newAction} onClose={() => setNewAction(false)} meetingId={m.id} projectId={m.projectId} />
      </Section>

      <Section
        title="Diario y evidencias"
        hint="Asistir a una junta no cuenta como logro ni como entregable: tú eliges qué registrar y cómo categorizarlo."
        id="mt-diary"
        aside={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                entryUi.newEntry(m.date <= today ? m.date : today, { text: `Junta «${m.title}»: `, projectId: m.projectId }, (id) =>
                  patch((cur) => ({ entryIds: [...cur.entryIds, id] })),
                )
              }
            >
              <NotebookPen className="size-4" /> Crear registro
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLinkOpen(true)}>
              <Link2 className="size-4" /> Vincular existente
            </Button>
          </div>
        }
      >
        {linked.length ? (
          <div className="grid gap-2">
            {linked.map((e) => (
              <EntryCard key={e.id} entry={e} showDate={formatDate(e.date, 'medium')} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-3">Sin registros vinculados.</p>
        )}
        <LinkEntriesModal open={linkOpen} onClose={() => setLinkOpen(false)} meeting={m} onChange={(ids) => patch({ entryIds: ids })} />
      </Section>

      <Section title="Cierre y minuta" id="mt-close">
        {m.closedAt && m.closing ? (
          <div className="grid gap-3">
            <ClosingSummary closing={m.closing} />
            <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => patch({ closedAt: undefined })}>
              <LockOpen className="size-4" /> Reabrir junta
            </Button>
          </div>
        ) : (
          <Button variant="primary" onClick={() => setClosingOpen(true)}>
            Revisar y cerrar junta
          </Button>
        )}
        <MinutesBlock meeting={m} input={input} onChange={(minutes) => patch({ minutes })} />
        <ClosingModal open={closingOpen} onClose={() => setClosingOpen(false)} input={input} toReview={toReview} onConfirm={(closing) => patch({ closing, closedAt: nowISO() })} />
      </Section>

      <div className="border-t border-line pt-5">
        <Button
          variant="danger"
          onClick={async () => {
            const ok = await ask({
              title: '¿Eliminar esta junta?',
              body: 'Se eliminan la junta y su texto original. Las acciones y los cambios se conservan en el proyecto.',
              confirm: 'Eliminar junta',
              tone: 'danger',
            })
            if (!ok) return
            await repo.deleteMeeting(m.id)
            onDeleted()
            toast({ tone: 'info', message: 'Junta eliminada.' })
          }}
        >
          <Trash className="size-4" /> Eliminar junta
        </Button>
      </div>
      {node}
    </div>
  )
}

function SourceLinkField({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  const [text, setText] = useState(value ?? '')
  const [err, setErr] = useState<string>()
  useEffect(() => setText(value ?? ''), [value])
  return (
    <div>
      <TextField
        label="Enlace al documento original"
        optional
        type="url"
        inputMode="url"
        value={text}
        error={err}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!text.trim()) {
            setErr(undefined)
            return onChange(undefined)
          }
          const u = safeUrl(text)
          if (!u) return setErr('Enlace no válido.')
          setErr(undefined)
          onChange(u)
        }}
        placeholder="https://"
      />
      {value && (
        <a href={value} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-accent-ink underline">
          <Link2 className="size-4" aria-hidden /> Abrir {displayUrl(value)}
        </a>
      )}
    </div>
  )
}

function TranscriptPanel({ meeting, flush }: { meeting: Meeting; flush: () => Promise<void> }) {
  const { db, repo } = useWorkspace()
  const toast = useToast()
  const transcripts = useLiveQuery(async () => (await db.transcripts.where('meetingId').equals(meeting.id).toArray()).filter((t) => !t._deleted), [db, meeting.id])
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const detect = async (text: string) => {
    const proposals = extractProposals(text, meeting.id, meeting.date)
    if (!proposals.length) {
      toast({ tone: 'info', message: 'No se encontraron secciones claras (Decisiones, Acciones…). Puedes llenar la estructura a mano.' })
      return
    }
    await flush()
    const r = await repo.applyProposals(meeting.id, proposals)
    toast({ tone: 'ok', message: `${plural(r.added, 'propuesta nueva', 'propuestas nuevas')} por revisar${r.skipped ? ` · ${r.skipped} ya existían (no se duplicaron)` : ''}.` })
  }

  const add = async (raw: string, format: Transcript['format'], fileName?: string) => {
    const text = format === 'vtt' || format === 'srt' ? parseSubtitles(raw) : raw.replace(/\r\n?/g, '\n').trim()
    if (!text) return toast({ tone: 'error', message: 'El texto está vacío o no se pudo leer.' })
    if (text.length > TRANSCRIPT_MAX_CHARS) return toast({ tone: 'error', message: `El texto supera ${TRANSCRIPT_MAX_CHARS.toLocaleString('es-MX')} caracteres. Divídelo en partes.` })
    const now = nowISO()
    try {
      const r = await repo.addTranscript({ id: uid(), meetingId: meeting.id, text, format, fileName, hash: contentHash(text), createdAt: now, updatedAt: now })
      if (r === 'duplicate') toast({ tone: 'info', message: 'Ese texto ya estaba en esta junta; no se duplicó.' })
      await detect(text)
    } catch (e) {
      toast({ tone: 'error', message: storageErrorMessage(e) })
    }
  }

  return (
    <Section
      title="Texto original"
      hint="Resumen o transcripción tal cual, separado de tus notas. No se incluye en informes profesionales."
      id="mt-orig"
      aside={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setPasteOpen(true)}>
            <FileText className="size-4" /> Pegar texto
          </Button>
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> Importar TXT, VTT o SRT
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.vtt,.srt,text/plain,text/vtt"
            className="sr-only"
            tabIndex={-1}
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              if (f.size > 2 * 1024 * 1024) return toast({ tone: 'error', message: 'El archivo es demasiado grande (máx. 2 MB).' })
              const raw = await f.text()
              const fmt = detectFormat(f.name, raw)
              await add(raw, fmt, f.name)
            }}
          />
        </div>
      }
    >
      {transcripts?.length ? (
        <div className="grid gap-2">
          {transcripts.map((t) => (
            <details key={t.id} className="rounded-xl border border-line bg-surface-2/50">
              <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-3 text-sm">
                <span className="font-medium">{t.fileName ?? 'Texto pegado'}</span>
                <Badge>{t.format.toUpperCase()}</Badge>
                <span className="text-xs text-ink-3">{t.text.length.toLocaleString('es-MX')} caracteres</span>
              </summary>
              <div className="border-t border-line px-3 pt-2 pb-3">
                <pre className="max-h-72 overflow-auto font-sans text-sm leading-relaxed whitespace-pre-wrap text-ink-2">{t.text}</pre>
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => void detect(t.text)}>
                  <WandSparkles className="size-4" /> Detectar propuestas otra vez
                </Button>
              </div>
            </details>
          ))}
          <Button size="sm" variant="danger" className="justify-self-start" onClick={() => setDeleteOpen(true)}>
            <Trash className="size-4" /> Eliminar texto original
          </Button>
        </div>
      ) : (
        <p className="text-sm text-ink-3">Sin texto original. Al agregarlo se detectan propuestas en secciones claras; todas empiezan “por revisar”.</p>
      )}
      <Modal
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        title="Pegar resumen o transcripción"
        description="Se guarda tal cual. Las secciones con título (Decisiones, Acciones, Próximos pasos…) se proponen para revisión."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPasteOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                await add(pasteText, 'pegado')
                setPasteText('')
                setPasteOpen(false)
              }}
              disabled={!pasteText.trim()}
            >
              Guardar texto
            </Button>
          </>
        }
      >
        <label htmlFor="paste-ta" className="sr-only">
          Texto
        </label>
        <textarea id="paste-ta" className="field min-h-64 font-sans text-sm" value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
      </Modal>
      <DeleteTranscriptModal open={deleteOpen} onClose={() => setDeleteOpen(false)} meeting={meeting} flush={flush} />
    </Section>
  )
}

function DeleteTranscriptModal({ open, onClose, meeting, flush }: { open: boolean; onClose: () => void; meeting: Meeting; flush: () => Promise<void> }) {
  const { repo } = useWorkspace()
  const { actions, changes } = useData()
  const toast = useToast()
  const [keep, setKeep] = useState<Set<string>>(new Set())
  const items = useMemo(() => {
    const out: { id: string; label: string; text: string }[] = []
    if (meeting.objectiveReview === 'por_revisar' && meeting.objective) out.push({ id: 'objective', label: 'Objetivo', text: meeting.objective })
    const add = (label: string, list: Meeting['decisions']) => list.filter((i) => i.review === 'por_revisar').forEach((i) => out.push({ id: i.id, label, text: i.text }))
    add('Decisión', meeting.decisions)
    add('Idea', meeting.ideas)
    add('Pregunta', meeting.questions)
    add('Material', meeting.materials)
    actions.filter((a) => a.meetingId === meeting.id && a.status === 'por_revisar').forEach((a) => out.push({ id: a.id, label: 'Acción', text: a.text }))
    changes.filter((c) => c.meetingId === meeting.id && c.review === 'por_revisar').forEach((c) => out.push({ id: c.id, label: 'Cambio', text: c.request }))
    return out
  }, [meeting, actions, changes])
  useEffect(() => {
    if (open) setKeep(new Set())
  }, [open])
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Eliminar texto original"
      description="Se conservan tus notas y todo lo que ya revisaste. Elige qué propuestas sin revisar quieres conservar; las demás se descartan."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await flush()
                await repo.deleteTranscripts(meeting.id, keep)
                toast({ tone: 'ok', message: 'Texto original eliminado. Se conservaron tus notas y acuerdos revisados.' })
                onClose()
              } catch (e) {
                toast({ tone: 'error', message: storageErrorMessage(e) })
              }
            }}
          >
            Eliminar texto original
          </Button>
        </>
      }
    >
      {items.length ? (
        <ul className="grid gap-2">
          {items.map((i) => (
            <li key={i.id}>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line px-3 py-2">
                <input
                  type="checkbox"
                  className="mt-1 size-5 accent-[var(--accent-ink)]"
                  checked={keep.has(i.id)}
                  onChange={(e) => {
                    const n = new Set(keep)
                    if (e.target.checked) n.add(i.id)
                    else n.delete(i.id)
                    setKeep(n)
                  }}
                />
                <span className="text-sm">
                  <span className="font-semibold">{i.label}:</span> {excerpt(i.text, 160)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-2">No hay propuestas sin revisar. Se eliminará solo el texto original.</p>
      )}
    </Modal>
  )
}

function ClosingSummary({ closing }: { closing: MeetingClosing }) {
  const rows: [string, string | undefined][] = [
    ['¿Qué se aprobó?', closing.approved],
    ['¿Qué cambia?', closing.changes],
    ['¿Quién hace qué?', closing.who],
    ['¿Para cuándo?', closing.when],
    ['¿Qué sigue pendiente de respuesta?', closing.pending],
  ]
  return (
    <dl className="grid gap-2 rounded-2xl bg-surface-2 p-4 text-sm">
      {rows.map(([q, a]) => (
        <div key={q}>
          <dt className="font-semibold">{q}</dt>
          <dd className="whitespace-pre-line text-ink-2">{a?.trim() || '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

function ClosingModal({
  open,
  onClose,
  input,
  toReview,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  input: Parameters<typeof closingDraft>[0]
  toReview: number
  onConfirm: (c: MeetingClosing) => void
}) {
  const [c, setC] = useState<MeetingClosing>({})
  useEffect(() => {
    if (open) setC(input.meeting.closing && Object.values(input.meeting.closing).some(Boolean) ? input.meeting.closing : closingDraft(input))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const field = (k: keyof MeetingClosing, label: string) => <TextArea label={label} rows={2} value={c[k] ?? ''} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Revisión breve antes de cerrar"
      description="Prellenado solo con lo que ya revisaste. Corrige lo que haga falta."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Seguir editando
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onConfirm(c)
              onClose()
            }}
          >
            Cerrar junta
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {toReview > 0 && (
          <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
            {plural(toReview, 'propuesta sigue', 'propuestas siguen')} sin revisar. No se toman como acuerdos hasta que las confirmes.
          </p>
        )}
        {field('approved', '¿Qué se aprobó?')}
        {field('changes', '¿Qué cambia?')}
        {field('who', '¿Quién hace qué?')}
        {field('when', '¿Para cuándo?')}
        {field('pending', '¿Qué sigue pendiente de respuesta?')}
      </div>
    </Modal>
  )
}

function MinutesBlock({ meeting, input, onChange }: { meeting: Meeting; input: Parameters<typeof buildMinutes>[0]; onChange: (v?: string) => void }) {
  const toast = useToast()
  const { ask, node } = useConfirm()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(meeting.minutes ?? '')
      toast({ tone: 'ok', message: 'Minuta copiada. No se envió a nadie.' })
    } catch {
      toast({ tone: 'error', message: 'No se pudo copiar. Selecciona el texto y cópialo manualmente.' })
    }
  }
  return (
    <div className="mt-5 grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">Minuta</h4>
        <span className="text-xs text-ink-3">Editable. Se copia para compartir; nunca se envía automáticamente.</span>
      </div>
      {meeting.minutes !== undefined ? (
        <>
          <label htmlFor="minutes-ta" className="sr-only">
            Minuta
          </label>
          <textarea id="minutes-ta" className="field min-h-56 text-sm leading-relaxed [field-sizing:content]" value={meeting.minutes} onChange={(e) => onChange(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void copy()}>
              <ClipboardCopy className="size-4" /> Copiar minuta
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                const ok = await ask({ title: '¿Regenerar la minuta?', body: 'Se reemplazará el texto actual con lo revisado en la junta.', confirm: 'Regenerar' })
                if (ok) onChange(buildMinutes(input))
              }}
            >
              Regenerar desde la junta
            </Button>
          </div>
        </>
      ) : (
        <Button variant="secondary" className="justify-self-start" onClick={() => onChange(buildMinutes(input))}>
          Generar minuta
        </Button>
      )}
      {node}
    </div>
  )
}

function LinkEntriesModal({ open, onClose, meeting, onChange }: { open: boolean; onClose: () => void; meeting: Meeting; onChange: (ids: string[]) => void }) {
  const { entries } = useData()
  const [q, setQ] = useState('')
  const from = addDays(meeting.date, -7)
  const to = addDays(meeting.date, 7)
  const list = entries.filter((e) => (q ? e.text.toLowerCase().includes(q.toLowerCase()) : e.date >= from && e.date <= to)).slice(0, 60)
  const toggle = (id: string) => onChange(meeting.entryIds.includes(id) ? meeting.entryIds.filter((x) => x !== id) : [...meeting.entryIds, id])
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Vincular registros del diario" description="Registros de una semana antes y después de la junta, o busca otros." size="lg" footer={<Button onClick={onClose}>Listo</Button>}>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <label htmlFor="le-q" className="sr-only">
          Buscar registro
        </label>
        <input id="le-q" className="field pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en el diario" />
      </div>
      <ul className="grid gap-1.5">
        {list.map((e) => (
          <li key={e.id}>
            <label className={cn('flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2', meeting.entryIds.includes(e.id) ? 'border-ink-2 bg-surface-2' : 'border-line')}>
              <input type="checkbox" className="mt-1 size-5 accent-[var(--accent-ink)]" checked={meeting.entryIds.includes(e.id)} onChange={() => toggle(e.id)} />
              <span className="text-sm">
                <span className="block text-xs text-ink-3">{formatDate(e.date, 'medium')}</span>
                {excerpt(e.text, 140)}
              </span>
            </label>
          </li>
        ))}
        {!list.length && <li className="text-sm text-ink-3">Sin registros en ese rango.</li>}
      </ul>
    </Modal>
  )
}

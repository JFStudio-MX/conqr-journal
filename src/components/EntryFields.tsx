import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ImagePlus, Link2, Plus, Star, X } from 'lucide-react'
import type { Attachment, Entry, TimeSaving } from '../db/types'
import type { DraftFile } from '../db/repo'
import { LIMITS, STATUSES } from '../lib/constants'
import { formatMinutes } from '../lib/dates'
import { compressImage, formatBytes } from '../lib/images'
import { allSkills, timeSavingResult } from '../lib/metrics'
import { cleanSkill, displayUrl, safeUrl, skillKey } from '../lib/text'
import { cn, uid } from '../lib/cn'
import { useData } from '../app/data'
import { AttachmentThumb } from './bits'
import { Badge, Button, FieldShell, SelectField, Spinner, TextArea, TextField } from './ui/ui'
import { useToast } from './ui/toast'

export type Details = Pick<
  Entry,
  'outcome' | 'status' | 'contribution' | 'collaborators' | 'skills' | 'timeSpentMin' | 'feedback' | 'links' | 'nextStep' | 'timeSaving' | 'evidence'
>

export function emptyDetails(): Details {
  return { skills: [], links: [] }
}

function Group({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <fieldset className="min-w-0 border-t border-line pt-4">
      <legend className="eyebrow mb-3 pr-2">{title}</legend>
      {hint && <p className="-mt-1 mb-3 text-xs text-ink-3">{hint}</p>}
      <div className="grid gap-4">{children}</div>
    </fieldset>
  )
}

export function EntryDetailsFields({
  value,
  onChange,
  files,
  onFilesChange,
  existing = [],
  removed = [],
  onRemoveExisting,
}: {
  value: Details
  onChange: (v: Details) => void
  files: DraftFile[]
  onFilesChange: (f: DraftFile[]) => void
  existing?: Attachment[]
  removed?: string[]
  onRemoveExisting?: (id: string) => void
}) {
  const set = <K extends keyof Details>(k: K, v: Details[K]) => onChange({ ...value, [k]: v })
  const fb = value.feedback ?? {}
  const ts = value.timeSaving ?? {}
  const setFb = (p: Partial<NonNullable<Entry['feedback']>>) => set('feedback', { ...fb, ...p })
  const setTs = (p: Partial<TimeSaving>) => set('timeSaving', { ...ts, ...p })
  const tsResult = timeSavingResult(value.timeSaving)
  const hasTs = ts.baselineMin !== undefined || ts.newMin !== undefined || !!ts.scope
  const certName = useId()

  return (
    <div className="grid gap-5">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line-strong bg-surface px-3 py-2">
        <input type="checkbox" className="peer sr-only" checked={!!value.evidence} onChange={(e) => set('evidence', e.target.checked || undefined)} />
        <Star className={cn('size-5 transition-transform', value.evidence ? 'animate-pop fill-[var(--cat-logro)] text-[var(--cat-logro)]' : 'text-ink-3')} aria-hidden />
        <span className="flex-1 text-sm">
          <span className="font-medium text-ink">Marcar como evidencia para revisión</span>
          <span className="block text-xs text-ink-3">Aparecerá en “Destacados” y tendrá prioridad en Mi revisión.</span>
        </span>
        <span className="text-xs font-semibold text-ink-2">{value.evidence ? 'Sí' : 'No'}</span>
      </label>

      <Group title="Resultado">
        <TextField label="Resultado o entregable" optional value={value.outcome ?? ''} onChange={(e) => set('outcome', e.target.value || undefined)} placeholder="Ej. 6 banners finales, prototipo funcional…" maxLength={2000} />
        <SelectField label="Estado" optional value={value.status ?? ''} onChange={(e) => set('status', (e.target.value || undefined) as Entry['status'])}>
          <option value="">Sin estado</option>
          {STATUSES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </SelectField>
      </Group>

      <Group title="Mi parte">
        <TextArea label="Mi contribución específica" optional rows={2} value={value.contribution ?? ''} onChange={(e) => set('contribution', e.target.value || undefined)} placeholder="Qué hice yo, concretamente" maxLength={4000} />
        <TextField label="Colaboradores" optional value={value.collaborators ?? ''} onChange={(e) => set('collaborators', e.target.value || undefined)} placeholder="Con quién trabajé" maxLength={500} />
        <SkillsInput value={value.skills ?? []} onChange={(s) => set('skills', s)} />
        <TimeSpent value={value.timeSpentMin} onChange={(m) => set('timeSpentMin', m)} />
      </Group>

      <Group title="Feedback" hint="Separa lo que te dijeron (textual) de tu propia interpretación.">
        <TextArea label="Lo que me dijeron (cita textual)" optional rows={2} value={fb.quote ?? ''} onChange={(e) => setFb({ quote: e.target.value || undefined })} placeholder="Palabras tal como las dijeron" maxLength={4000} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Persona" optional value={fb.person ?? ''} onChange={(e) => setFb({ person: e.target.value || undefined })} maxLength={200} />
          <TextField label="Fecha del comentario" optional type="date" value={fb.date ?? ''} onChange={(e) => setFb({ date: e.target.value || undefined })} />
        </div>
        <TextArea label="Mi interpretación" optional rows={2} value={fb.interpretation ?? ''} onChange={(e) => setFb({ interpretation: e.target.value || undefined })} placeholder="Qué entiendo yo de ese comentario" maxLength={4000} />
      </Group>

      <Group title="Evidencia">
        <LinksInput value={value.links ?? []} onChange={(l) => set('links', l)} />
        <FilesInput files={files} onFilesChange={onFilesChange} existing={existing.filter((a) => !removed.includes(a.id))} onRemoveExisting={onRemoveExisting} />
      </Group>

      <Group title="Después">
        <TextField label="Próximo paso" optional value={value.nextStep ?? ''} onChange={(e) => set('nextStep', e.target.value || undefined)} maxLength={1000} />
      </Group>

      <Group title="Ahorro de tiempo" hint="Solo si comparas un proceso anterior con uno nuevo. No se convierte a dinero.">
        <div className="grid gap-4 sm:grid-cols-2">
          <MinutesField label="Tiempo de referencia (antes)" value={ts.baselineMin} onChange={(m) => setTs({ baselineMin: m })} />
          <MinutesField label="Tiempo con el nuevo proceso" value={ts.newMin} onChange={(m) => setTs({ newMin: m })} />
        </div>
        <TextField label="¿Cómo se obtuvo el tiempo de referencia?" optional value={ts.baselineSource ?? ''} onChange={(e) => setTs({ baselineSource: e.target.value || undefined })} placeholder="Ej. cronometré 3 lotes la semana pasada" maxLength={1000} />
        <TextField label="Alcance comparable" optional value={ts.scope ?? ''} onChange={(e) => setTs({ scope: e.target.value || undefined })} placeholder="Ej. lote de 30 fotos de producto" maxLength={1000} />
        <div role="radiogroup" aria-label="¿Medido o estimado?" className="flex flex-wrap gap-2">
          {(['medido', 'estimado'] as const).map((c) => (
            <label key={c} className={cn('inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm', ts.certainty === c ? 'border-ink-2 bg-surface-2 font-semibold' : 'border-line-strong')}>
              <input type="radio" name={certName} className="accent-[var(--accent-ink)]" checked={ts.certainty === c} onChange={() => setTs({ certainty: c })} />
              {c === 'medido' ? 'Medido' : 'Estimado'}
            </label>
          ))}
        </div>
        {hasTs && (
          <p className={cn('rounded-xl px-3 py-2 text-sm', tsResult.ok ? 'bg-ok-soft text-ok' : 'bg-surface-2 text-ink-2')} aria-live="polite">
            {tsResult.ok
              ? `Diferencia: ${formatMinutes(Math.abs(tsResult.diffMin))} ${tsResult.diffMin >= 0 ? 'menos' : 'más'} (${Math.abs(tsResult.pct)} %) · ${tsResult.certainty}`
              : `Falta para calcular: ${tsResult.missing.join(', ')}.`}
          </p>
        )}
      </Group>
    </div>
  )
}

function MinutesField({ label, value, onChange }: { label: string; value?: number; onChange: (m?: number) => void }) {
  return (
    <TextField
      label={`${label} (min)`}
      optional
      type="number"
      inputMode="numeric"
      min={0}
      step={1}
      value={value ?? ''}
      onChange={(e) => {
        const n = e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value)))
        onChange(Number.isFinite(n) ? n : undefined)
      }}
    />
  )
}

function TimeSpent({ value, onChange }: { value?: number; onChange: (m?: number) => void }) {
  const h = value !== undefined ? Math.floor(value / 60) : ''
  const m = value !== undefined ? value % 60 : ''
  const update = (hh: string, mm: string) => {
    if (hh === '' && mm === '') return onChange(undefined)
    const total = (Number(hh) || 0) * 60 + (Number(mm) || 0)
    onChange(total > 0 ? Math.min(total, 24 * 60) : undefined)
  }
  const id = useId()
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-sm font-medium text-ink">
        Tiempo dedicado <span className="font-normal text-ink-3">(opcional)</span>
      </legend>
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-h`} className="sr-only">
          Horas
        </label>
        <input id={`${id}-h`} type="number" inputMode="numeric" min={0} max={24} className="field w-20" value={h} onChange={(e) => update(e.target.value, String(m))} />
        <span className="text-sm text-ink-3">h</span>
        <label htmlFor={`${id}-m`} className="sr-only">
          Minutos
        </label>
        <input id={`${id}-m`} type="number" inputMode="numeric" min={0} max={59} className="field w-20" value={m} onChange={(e) => update(String(h), e.target.value)} />
        <span className="text-sm text-ink-3">min</span>
      </div>
    </fieldset>
  )
}

export function SkillsInput({ value, onChange }: { value: string[]; onChange: (s: string[]) => void }) {
  const { entries } = useData()
  const [text, setText] = useState('')
  const suggestions = useMemo(() => allSkills(entries), [entries])
  const listId = useId()
  const add = (raw: string) => {
    const s = cleanSkill(raw)
    if (!s) return
    if (value.some((v) => skillKey(v) === skillKey(s))) return setText('')
    const existing = suggestions.find((x) => skillKey(x) === skillKey(s))
    onChange([...value, existing ?? s].slice(0, 30))
    setText('')
  }
  return (
    <FieldShell label="Habilidad practicada" optional hint="Escribe y pulsa Enter. Practicar no es lo mismo que dominar.">
      {(id, d) => (
        <div>
          {value.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Habilidades agregadas">
              {value.map((s) => (
                <li key={s}>
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pr-1 pl-3 text-sm">
                    {s}
                    <button type="button" className="rounded-full p-1 text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label={`Quitar ${s}`} onClick={() => onChange(value.filter((v) => v !== s))}>
                      <X className="size-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              id={id}
              aria-describedby={d}
              list={listId}
              className="field"
              value={text}
              placeholder="Ej. Figma, After Effects, Prompting IA"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  add(text)
                }
              }}
              onBlur={() => text.trim() && add(text)}
            />
            <Button variant="secondary" size="icon" aria-label="Agregar habilidad" onClick={() => add(text)}>
              <Plus className="size-5" />
            </Button>
          </div>
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      )}
    </FieldShell>
  )
}

function LinksInput({ value, onChange }: { value: string[]; onChange: (l: string[]) => void }) {
  const [text, setText] = useState('')
  const [err, setErr] = useState<string>()
  const add = () => {
    if (!text.trim()) return
    const u = safeUrl(text)
    if (!u) return setErr('Escribe un enlace web válido (https://…).')
    if (!value.includes(u)) onChange([...value, u].slice(0, 20))
    setText('')
    setErr(undefined)
  }
  return (
    <FieldShell label="Enlaces de evidencia" optional error={err} hint="Figma, Drive, Behance… Solo se guardan enlaces web (http/https).">
      {(id, d) => (
        <div>
          {value.length > 0 && (
            <ul className="mb-2 grid gap-1.5">
              {value.map((l) => (
                <li key={l} className="flex min-w-0 items-center gap-2 rounded-xl bg-surface-2 py-1.5 pr-1 pl-3 text-sm">
                  <Link2 className="size-4 shrink-0 text-ink-3" aria-hidden />
                  <a href={l} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-ink underline-offset-2 hover:underline">
                    {displayUrl(l)}
                  </a>
                  <button type="button" className="rounded-lg p-1.5 text-ink-3 hover:bg-surface-3" aria-label={`Quitar enlace ${displayUrl(l)}`} onClick={() => onChange(value.filter((x) => x !== l))}>
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              id={id}
              aria-describedby={d}
              aria-invalid={err ? true : undefined}
              className="field"
              inputMode="url"
              type="url"
              value={text}
              placeholder="https://"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  add()
                }
              }}
            />
            <Button variant="secondary" size="icon" aria-label="Agregar enlace" onClick={add}>
              <Plus className="size-5" />
            </Button>
          </div>
        </div>
      )}
    </FieldShell>
  )
}

function NewFileThumb({ f, onRemove }: { f: DraftFile; onRemove: () => void }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const u = URL.createObjectURL(f.blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [f.blob])
  return (
    <div className="relative">
      <div className="size-20 overflow-hidden rounded-xl border border-line bg-surface-2">{url && <img src={url} alt="" className="size-full object-cover" />}</div>
      <span className="sr-only">{f.name}</span>
      <button type="button" onClick={onRemove} className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full border border-line bg-surface shadow" aria-label={`Quitar ${f.name}`}>
        <X className="size-4" />
      </button>
    </div>
  )
}

export function FilesInput({
  files,
  onFilesChange,
  existing = [],
  onRemoveExisting,
}: {
  files: DraftFile[]
  onFilesChange: (f: DraftFile[]) => void
  existing?: Attachment[]
  onRemoveExisting?: (id: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const total = files.length + existing.length
  const full = total >= LIMITS.attachmentsPerEntry
  const onPick = async (list: FileList | null) => {
    if (!list?.length) return
    setBusy(true)
    const out: DraftFile[] = []
    for (const file of [...list].slice(0, LIMITS.attachmentsPerEntry - total)) {
      try {
        const c = await compressImage(file)
        out.push({ id: uid(), blob: c.blob, name: c.name, mime: c.mime, width: c.width, height: c.height })
      } catch (e) {
        toast({ tone: 'error', message: `${file.name}: ${(e as Error).message}` })
      }
    }
    if (list.length > LIMITS.attachmentsPerEntry - total) toast({ tone: 'info', message: `Máximo ${LIMITS.attachmentsPerEntry} capturas por registro.` })
    onFilesChange([...files, ...out])
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
  }
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink">
        Capturas <span className="font-normal text-ink-3">(opcional · hasta {LIMITS.attachmentsPerEntry}, se comprimen a ≤ {formatBytes(LIMITS.maxStoredBytes)})</span>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {existing.map((a) => (
          <div key={a.id} className="relative">
            <AttachmentThumb att={a} />
            {onRemoveExisting && (
              <button type="button" onClick={() => onRemoveExisting(a.id)} className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full border border-line bg-surface shadow" aria-label={`Quitar ${a.name}`}>
                <X className="size-4" />
              </button>
            )}
          </div>
        ))}
        {files.map((f) => (
          <NewFileThumb key={f.id} f={f} onRemove={() => onFilesChange(files.filter((x) => x.id !== f.id))} />
        ))}
        <input ref={inputRef} type="file" accept="image/*" multiple className="sr-only" id="file-pick" tabIndex={-1} onChange={(e) => void onPick(e.target.files)} />
        <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={full || busy} className="h-20 flex-col gap-1 px-4 text-xs">
          {busy ? <Spinner /> : <ImagePlus className="size-5" aria-hidden />}
          {full ? 'Límite alcanzado' : 'Agregar captura'}
        </Button>
      </div>
      {files.length > 0 && (
        <p className="mt-2 text-xs text-ink-3">
          <Badge tone="neutral">{files.length} nueva(s)</Badge> se guardarán con el registro.
        </p>
      )}
    </div>
  )
}

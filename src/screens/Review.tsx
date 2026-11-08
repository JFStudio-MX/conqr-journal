import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { FileDown, Lock, Plus, Printer, RefreshCw, Trash, X } from 'lucide-react'
import type { PrivateSettings, ReviewDoc, ReviewItem, Stored } from '../db/types'
import { storageErrorMessage } from '../db/database'
import { REVIEW_SECTIONS, REVIEW_TITLE } from '../lib/constants'
import { addDays, addMonths, capitalize, formatDate, startOfMonth, todayISO } from '../lib/dates'
import { generateSections, refreshSections, uniqueSources } from '../lib/review'
import { reviewToMarkdown, sourceLabel } from '../lib/markdown'
import { stableStringify, stripMeta } from '../lib/backup'
import { plural } from '../lib/text'
import { cn, nowISO, uid } from '../lib/cn'
import { useData } from '../app/data'
import { useWorkspace } from '../app/session'
import { useEntryUi } from '../app/entry-ui'
import { downloadBlob } from '../app/backup-io'
import { Badge, Button, EmptyState, Switch, TextField } from '../components/ui/ui'
import { useConfirm } from '../components/ui/overlay'
import { useToast } from '../components/ui/toast'

type Preset = 'ingreso' | '3m' | 'mes' | 'custom'

function usePrivate() {
  const { privateData } = useData()
  const { db, repo, mode } = useWorkspace()
  const local = useLiveQuery(async () => ((await db.local.get('private'))?.value as PrivateSettings | undefined) ?? null, [db])
  const synced = !!privateData
  const value: PrivateSettings | undefined = privateData ?? local ?? undefined
  const blank = (): PrivateSettings => ({ id: 'private', createdAt: nowISO(), updatedAt: nowISO() })
  return {
    value,
    synced,
    canSync: mode === 'account',
    save: async (v: PrivateSettings) => (synced ? repo.putSettings({ ...v, updatedAt: nowISO() }) : repo.setLocal('private', { ...v, updatedAt: nowISO() })),
    setSynced: async (on: boolean) => {
      const v = value ?? blank()
      if (on) {
        await repo.putSettings(v)
        await repo.delLocal('private')
      } else {
        await repo.setLocal('private', v)
        await repo.remove('settings', 'private')
      }
    },
  }
}

export function ReviewScreen() {
  const data = useData()
  const { reviews, profile, today } = data
  const { repo } = useWorkspace()
  const toast = useToast()
  const [selId, setSelId] = useState<string | null>(null)
  const doc = reviews.find((r) => r.id === selId) ?? reviews[0]
  const [preset, setPreset] = useState<Preset>('ingreso')
  const [start, setStart] = useState(profile.startDate)
  const [end, setEnd] = useState(today)
  const [withAttendance, setWithAttendance] = useState(false)
  const [withMeetings, setWithMeetings] = useState(false)

  useEffect(() => {
    if (preset === 'ingreso') {
      setStart(profile.startDate)
      setEnd(today)
    } else if (preset === '3m') {
      setStart(addDays(addMonths(today, -3), 1))
      setEnd(today)
    } else if (preset === 'mes') {
      setStart(startOfMonth(today))
      setEnd(today)
    }
  }, [preset, profile.startDate, today])

  const generate = async () => {
    if (start > end) return toast({ tone: 'error', message: 'El periodo termina antes de empezar.' })
    const sections = generateSections({
      allEntries: data.entries,
      projects: data.projects,
      brands: data.brands,
      goals: data.goals,
      attendance: data.attendance,
      attendanceSettings: data.attendanceSettings,
      nextStep: data.nextStep?.text,
      periodStart: start,
      periodEnd: end,
      today,
      includeAttendance: withAttendance,
      includeMeetings: withMeetings,
      meetings: data.meetings,
      actions: data.actions,
      changes: data.changes,
      makeId: uid,
    })
    const now = nowISO()
    const d: ReviewDoc = {
      id: uid(),
      title: `Revisión ${formatDate(start, 'medium')} – ${formatDate(end, 'medium')}`,
      periodStart: start,
      periodEnd: end,
      sections,
      includeSalary: false,
      includeAttendance: withAttendance,
      includeSources: true,
      includeMeetings: withMeetings || undefined,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await repo.put('reviews', d)
      setSelId(d.id)
      toast({ tone: 'ok', message: `Borrador generado con ${plural(uniqueSources(d).length, 'registro', 'registros')} de origen.` })
    } catch (e) {
      toast({ tone: 'error', message: storageErrorMessage(e) })
    }
  }

  return (
    <div className="mx-auto max-w-[1160px]">
      <h1 className="display text-[2.3rem] leading-none sm:text-5xl">Mi revisión</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-3">Prepara conversaciones de crecimiento y sueldo con evidencia real. Cada afirmación muestra sus registros de origen; nada de impacto comercial, ahorros o aprobaciones que no hayas registrado.</p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="grid content-start gap-5">
          <section className="card p-5" aria-labelledby="new-review">
            <h2 id="new-review" className="display text-lg">
              Nuevo borrador
            </h2>
            <div className="mt-3 grid gap-2" role="radiogroup" aria-label="Periodo">
              {(
                [
                  ['ingreso', 'Desde mi ingreso'],
                  ['3m', 'Últimos 3 meses'],
                  ['mes', 'Este mes'],
                  ['custom', 'Personalizado'],
                ] as [Preset, string][]
              ).map(([id, label]) => (
                <label key={id} className={cn('flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm', preset === id ? 'border-ink-2 bg-surface-2 font-semibold' : 'border-line')}>
                  <input type="radio" name="preset" className="accent-[var(--accent-ink)]" checked={preset === id} onChange={() => setPreset(id)} />
                  {label}
                </label>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <TextField label="Desde" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                <TextField label="Hasta" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            )}
            <p className="mt-2 text-xs text-ink-3">
              {formatDate(start, 'medium')} – {formatDate(end, 'medium')}
            </p>
            <div className="mt-3 grid gap-1">
              <Switch checked={withAttendance} onChange={setWithAttendance} label="Incluir puntualidad" description="Excluida por defecto." />
              <Switch checked={withMeetings} onChange={setWithMeetings} label="Incluir juntas" description="Solo acuerdos revisados; nunca transcripciones." />
            </div>
            <Button variant="primary" className="mt-4 w-full" onClick={() => void generate()}>
              Generar borrador
            </Button>
          </section>

          {reviews.length > 0 && (
            <section aria-labelledby="saved-reviews">
              <h2 id="saved-reviews" className="eyebrow mb-2">
                Borradores guardados
              </h2>
              <ul className="grid gap-1.5">
                {reviews.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setSelId(r.id)} aria-current={doc?.id === r.id ? 'true' : undefined} className={cn('w-full rounded-xl px-3 py-2 text-left text-sm', doc?.id === r.id ? 'bg-surface font-semibold shadow-soft' : 'hover:bg-surface-2')}>
                      {r.title}
                      <span className="block text-xs font-normal text-ink-3">Editado {formatDate(todayISO(new Date(r.updatedAt)), 'dayMonth')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <PrivatePanel />
        </aside>

        <div className="min-w-0">
          {doc ? (
            <ReviewEditor key={doc.id} doc={doc} onDeleted={() => setSelId(null)} />
          ) : (
            <EmptyState title="Aún no hay un borrador">Elige un periodo y genera el primer borrador. Se arma con tus registros confirmados; podrás editar cada punto y ver de dónde sale.</EmptyState>
          )}
        </div>
      </div>
    </div>
  )
}

function PrivatePanel() {
  const p = usePrivate()
  const toast = useToast()
  const [v, setV] = useState<PrivateSettings | undefined>(p.value)
  const [open, setOpen] = useState(false)
  useEffect(() => setV(p.value), [p.value])
  const set = (k: keyof PrivateSettings, val: string) => setV({ ...(v ?? { id: 'private', createdAt: nowISO(), updatedAt: nowISO() }), [k]: val || undefined })
  return (
    <section className="card p-5" aria-labelledby="priv-title">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 text-left">
        <Lock className="size-4 text-ink-3" aria-hidden />
        <span id="priv-title" className="flex-1 font-semibold">
          Privado: sueldo
        </span>
        <span className="text-xs text-ink-3">{open ? 'Ocultar' : 'Mostrar'}</span>
      </button>
      {open && (
        <div className="mt-3 grid gap-3">
          <p className="text-xs text-ink-3">
            {p.synced ? 'Se sincroniza con tu cuenta (protegido con tu sesión).' : 'Solo en este dispositivo: no se sincroniza.'} Nunca aparece en exportaciones salvo que lo marques en un borrador.
          </p>
          <TextField label="Sueldo actual" optional value={v?.currentSalary ?? ''} onChange={(e) => set('currentSalary', e.target.value)} autoComplete="off" />
          <TextField label="Objetivo salarial" optional value={v?.targetSalary ?? ''} onChange={(e) => set('targetSalary', e.target.value)} autoComplete="off" />
          <TextField label="Próxima revisión" optional type="date" value={v?.nextReviewDate ?? ''} onChange={(e) => set('nextReviewDate', e.target.value)} />
          <Button
            size="sm"
            onClick={async () => {
              try {
                await p.save(v ?? { id: 'private', createdAt: nowISO(), updatedAt: nowISO() })
                toast({ tone: 'ok', message: 'Guardado.' })
              } catch (e) {
                toast({ tone: 'error', message: storageErrorMessage(e) })
              }
            }}
          >
            Guardar
          </Button>
          {p.canSync && <Switch checked={p.synced} onChange={(on) => void p.setSynced(on)} label="Sincronizar con mi cuenta" description="Apagado: estos datos no salen de este dispositivo." />}
        </div>
      )}
    </section>
  )
}

function ReviewEditor({ doc, onDeleted }: { doc: Stored<ReviewDoc>; onDeleted: () => void }) {
  const data = useData()
  const { repo } = useWorkspace()
  const ui = useEntryUi()
  const toast = useToast()
  const priv = usePrivate()
  const { ask, node } = useConfirm()
  const [d, setD] = useState<ReviewDoc>(() => stripMeta(doc) as ReviewDoc)
  const pending = useRef(false)
  const last = useRef(stableStringify(stripMeta(doc)))
  const [print, setPrint] = useState(false)
  useEffect(() => {
    const inc = stableStringify(stripMeta(doc))
    if (!pending.current && inc !== last.current) {
      setD(stripMeta(doc) as ReviewDoc)
      last.current = inc
    }
  }, [doc])
  useEffect(() => {
    if (!pending.current) return
    const t = window.setTimeout(async () => {
      try {
        await repo.put('reviews', d)
        last.current = stableStringify(d)
        pending.current = false
      } catch (e) {
        toast({ tone: 'error', message: storageErrorMessage(e) })
      }
    }, 700)
    return () => window.clearTimeout(t)
  }, [d, repo, toast])
  const patch = (p: Partial<ReviewDoc>) => {
    pending.current = true
    setD((cur) => ({ ...cur, ...p }))
  }
  const setItems = (key: ReviewItem['id'], items: ReviewItem[]) => patch({ sections: d.sections.map((s) => (s.key === key ? { ...s, items } : s)) })
  const fresh = (opts: Partial<ReviewDoc> = {}) => {
    const next = { ...d, ...opts }
    return generateSections({
      allEntries: data.entries,
      projects: data.projects,
      brands: data.brands,
      goals: data.goals,
      attendance: data.attendance,
      attendanceSettings: data.attendanceSettings,
      nextStep: data.nextStep?.text,
      periodStart: next.periodStart,
      periodEnd: next.periodEnd,
      today: data.today,
      includeAttendance: next.includeAttendance,
      includeMeetings: !!next.includeMeetings,
      meetings: data.meetings,
      actions: data.actions,
      changes: data.changes,
      makeId: uid,
    })
  }
  const refresh = (opts: Partial<ReviewDoc> = {}) => patch({ ...opts, sections: refreshSections(d.sections, fresh(opts)) })
  const sources = useMemo(() => uniqueSources(d), [d])
  const md = () =>
    reviewToMarkdown({ doc: d, profile: data.profile, entries: data.entries, projects: data.projects, privateData: d.includeSalary ? priv.value : undefined })

  return (
    <article>
      <label htmlFor="rv-title" className="sr-only">
        Título
      </label>
      <input id="rv-title" className="display w-full rounded-lg bg-transparent text-3xl leading-tight outline-none focus-visible:outline-2" value={d.title} onChange={(e) => patch({ title: e.target.value })} maxLength={300} />
      <p className="mt-2 text-sm text-ink-3">
        {formatDate(d.periodStart, 'long')} – {formatDate(d.periodEnd, 'long')} · Basado en{' '}
        <button type="button" className="font-medium text-accent-ink underline underline-offset-2" onClick={() => ui.openList('Registros de origen', sources)}>
          {plural(sources.length, 'registro único', 'registros únicos')}
        </button>
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => downloadBlob(new Blob([md()], { type: 'text/markdown;charset=utf-8' }), `revision-${d.periodStart}_${d.periodEnd}.md`)}>
          <FileDown className="size-4" /> Exportar Markdown
        </Button>
        <Button onClick={() => setPrint(true)}>
          <Printer className="size-4" /> Vista de impresión
        </Button>
        <Button variant="ghost" onClick={() => refresh()}>
          <RefreshCw className="size-4" /> Actualizar desde registros
        </Button>
      </div>

      <div className="mt-5 grid gap-1 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2 sm:gap-x-6">
        <Switch checked={d.includeSources} onChange={(v) => patch({ includeSources: v })} label="Incluir fuentes al exportar" />
        <Switch checked={d.includeAttendance} onChange={(v) => refresh({ includeAttendance: v })} label="Incluir puntualidad" />
        <Switch checked={!!d.includeMeetings} onChange={(v) => refresh({ includeMeetings: v || undefined })} label="Incluir juntas" description="Sin transcripciones" />
        <Switch checked={d.includeSalary} onChange={(v) => patch({ includeSalary: v })} label="Incluir sueldo (privado)" description={priv.value ? undefined : 'Aún no hay datos de sueldo'} />
      </div>

      <div className="mt-8 grid gap-8">
        {d.sections
          .filter((s) => (s.key !== 'asistencia' || d.includeAttendance) && (s.key !== 'juntas' || d.includeMeetings))
          .map((sec) => (
            <section key={sec.key} aria-labelledby={`rs-${sec.key}`}>
              <h2 id={`rs-${sec.key}`} className="display border-b border-line pb-2 text-xl">
                {REVIEW_TITLE[sec.key]}
              </h2>
              {sec.items.length ? (
                <ul className="mt-3 grid gap-3">
                  {sec.items.map((it) => (
                    <li key={it.id} className="group">
                      <label htmlFor={`ri-${it.id}`} className="sr-only">
                        Punto
                      </label>
                      <textarea
                        id={`ri-${it.id}`}
                        className="field min-h-14 leading-relaxed [field-sizing:content]"
                        value={it.text}
                        onChange={(e) => setItems(sec.key, sec.items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)))}
                      />
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                        {it.sources.length > 0 ? (
                          <button type="button" className="rounded-md font-medium text-accent-ink underline underline-offset-2" onClick={() => ui.openList(REVIEW_TITLE[sec.key], it.sources, 'fuentes de este punto')}>
                            Fuentes ({it.sources.length})
                          </button>
                        ) : (
                          <span className="text-ink-3">{it.origin === 'manual' ? 'Punto propio (sin fuente)' : 'Sin registros de origen'}</span>
                        )}
                        {it.origin === 'plantilla' && it.generatedText !== undefined && it.text !== it.generatedText && <Badge>Editado</Badge>}
                        {it.origin === 'manual' && <Badge tone="outline">Manual</Badge>}
                        <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-ink-3 hover:text-danger" onClick={() => setItems(sec.key, sec.items.filter((x) => x.id !== it.id))}>
                          <X className="size-3.5" aria-hidden /> Quitar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-ink-3">{REVIEW_SECTIONS.find((s) => s.key === sec.key)?.empty}</p>
              )}
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setItems(sec.key, [...sec.items, { id: uid(), text: '', sources: [], origin: 'manual' }])}>
                <Plus className="size-4" /> Agregar punto
              </Button>
            </section>
          ))}
      </div>

      <div className="mt-10 border-t border-line pt-5">
        <Button
          variant="danger"
          onClick={async () => {
            const ok = await ask({ title: '¿Eliminar este borrador?', body: 'Tus registros no se tocan.', confirm: 'Eliminar', tone: 'danger' })
            if (!ok) return
            await repo.remove('reviews', d.id)
            onDeleted()
          }}
        >
          <Trash className="size-4" /> Eliminar borrador
        </Button>
      </div>
      {print && <PrintView doc={d} privateData={d.includeSalary ? priv.value : undefined} onClose={() => setPrint(false)} />}
      {node}
    </article>
  )
}

function PrintView({ doc, privateData, onClose }: { doc: ReviewDoc; privateData?: PrivateSettings; onClose: () => void }) {
  const { profile, entries, projects } = useData()
  const byId = new Map(entries.map((e) => [e.id, e]))
  const n = uniqueSources(doc).length
  useEffect(() => {
    const prev = document.title
    document.title = doc.title
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.title = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [doc.title, onClose])
  return (
    <div className="fixed inset-0 z-[55] overflow-y-auto bg-[#fbfaf7] text-[#1a1a1a]" role="dialog" aria-modal="true" aria-label="Vista de impresión">
      <div className="no-print sticky top-0 flex flex-wrap items-center gap-2 border-b border-[#e5e0d8] bg-[#fbfaf7]/95 px-4 py-3 backdrop-blur">
        <p className="mr-auto text-sm text-[#555]">Vista de impresión · usa “Guardar como PDF” en el diálogo de impresión.</p>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir / PDF
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cerrar
        </Button>
      </div>
      <article className="print-root mx-auto max-w-[760px] px-6 py-10 sm:px-10">
        <p className="text-xs font-semibold tracking-[0.18em] text-[#777] uppercase">
          {profile.fullName} · {profile.company} · {profile.area}, equipo {profile.team}
        </p>
        <h1 className="display mt-2 text-4xl leading-tight">{doc.title}</h1>
        <p className="mt-2 text-sm text-[#555]">
          {capitalize(formatDate(doc.periodStart, 'long'))} – {formatDate(doc.periodEnd, 'long')} · Basado en {plural(n, 'registro', 'registros')} del diario
        </p>
        {doc.sections
          .filter((s) => (s.key !== 'asistencia' || doc.includeAttendance) && (s.key !== 'juntas' || doc.includeMeetings) && s.items.some((i) => i.text.trim()))
          .map((s) => (
            <section key={s.key} className="mt-8">
              <h2 className="display border-b border-[#ddd6cb] pb-1.5 text-xl">{REVIEW_TITLE[s.key]}</h2>
              <ul className="mt-3 grid list-disc gap-2.5 pl-5 text-[15px] leading-relaxed">
                {s.items
                  .filter((i) => i.text.trim())
                  .map((i) => {
                    const src = i.sources.map((id) => byId.get(id)).filter(Boolean)
                    return (
                      <li key={i.id}>
                        {i.text}
                        {doc.includeSources && src.length > 0 && (
                          <span className="mt-0.5 block text-xs leading-snug text-[#777]">
                            Fuentes: {src.slice(0, 4).map((e) => sourceLabel(e!, projects)).join('; ')}
                            {src.length > 4 ? ` (+${src.length - 4})` : ''}
                          </span>
                        )}
                      </li>
                    )
                  })}
              </ul>
            </section>
          ))}
        {doc.includeSalary && privateData && (privateData.currentSalary || privateData.targetSalary || privateData.nextReviewDate) && (
          <section className="mt-8">
            <h2 className="display border-b border-[#ddd6cb] pb-1.5 text-xl">Compensación (privado)</h2>
            <ul className="mt-3 grid gap-1 text-[15px]">
              {privateData.currentSalary && <li>Sueldo actual: {privateData.currentSalary}</li>}
              {privateData.targetSalary && <li>Objetivo salarial: {privateData.targetSalary}</li>}
              {privateData.nextReviewDate && <li>Próxima revisión: {formatDate(privateData.nextReviewDate, 'long')}</li>}
            </ul>
          </section>
        )}
        <p className="mt-10 border-t border-[#ddd6cb] pt-3 text-xs text-[#777]">
          Elaborado a partir de mis registros personales. Los conteos son de registros, no de entregas; practicar una habilidad no implica dominarla.
        </p>
      </article>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, CalendarPlus, CircleCheck, Download, Flag, Pencil, Users } from 'lucide-react'
import { useMeetingUi } from '../app/meeting-ui'
import { ActionRow } from '../components/meetings/parts'
import type { NextStepSettings } from '../db/types'
import { storageErrorMessage } from '../db/database'
import { addDays, capitalize, diffDays, eachDay, formatDate, isISODate, isoWeekday, relativeDay, startOfWeek, todayISO } from '../lib/dates'
import { countable, periodSummary } from '../lib/metrics'
import { excerpt, plural } from '../lib/text'
import { cn, nowISO } from '../lib/cn'
import { useData } from '../app/data'
import { useWorkspace } from '../app/session'
import { useRoute } from '../app/router'
import { useEntryUi } from '../app/entry-ui'
import { useExportBackup, useLastBackup } from '../app/backup-io'
import { QuickCapture } from '../components/QuickCapture'
import { AttendanceStrip } from '../components/Attendance'
import { EntryCard } from '../components/EntryCard'
import { Badge, Burst, Button, EmptyState, SectionTitle } from '../components/ui/ui'
import { Sheet } from '../components/ui/overlay'
import { useToast } from '../components/ui/toast'

/** Pendientes confirmados que marcaste como tuyos y que vencen pronto (o ya vencieron). */
function MyActionsCard() {
  const { actions, today } = useData()
  const soon = addDays(today, 7)
  const mine = actions
    .filter((a) => a.mine && a.status === 'confirmada' && (!a.dueDate || a.dueDate <= soon))
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
  if (!mine.length) return null
  return (
    <section className="card p-5" aria-labelledby="ma-title">
      <h2 id="ma-title" className="display text-lg">
        Mis pendientes
      </h2>
      <p className="mt-0.5 text-xs text-ink-3">De tus juntas: confirmados, asignados a ti, para esta semana o sin fecha.</p>
      <ul className="mt-3 grid gap-2">
        {mine.slice(0, 6).map((a) => (
          <ActionRow key={a.id} action={a} showContext />
        ))}
      </ul>
      {mine.length > 6 && (
        <a href="#/diario?tab=proyectos" className="mt-2 inline-block text-sm text-accent-ink underline">
          Ver todos ({mine.length})
        </a>
      )}
    </section>
  )
}

export function TodayScreen() {
  const { today, entries, profile } = useData()
  const { newMeeting } = useMeetingUi()
  const route = useRoute()
  const [date, setDate] = useState(today)
  const [fresh, setFresh] = useState<string>()
  const [pastOpen, setPastOpen] = useState(false)

  useEffect(() => {
    const p = route.params.get('date')
    if (p && isISODate(p) && p <= today) setDate(p)
  }, [route.params, today])

  const dayEntries = entries.filter((e) => e.date === date)
  const hasHistory = countable(entries).length > 0
  const dayN = diffDays(today, profile.startDate) + 1
  const pickDay = (d: string) => {
    setDate(d)
    setPastOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    window.setTimeout(() => document.getElementById('qc-text')?.focus(), 250)
  }

  return (
    <div className="mx-auto grid max-w-[1160px] gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">
            {capitalize(formatDate(today, 'full'))}
            {dayN >= 1 && <span className="text-ink-3"> · Día {dayN} en {profile.company}</span>}
          </p>
          <Button size="sm" variant="secondary" onClick={() => newMeeting({ date: today })} data-testid="new-meeting">
            <Users className="size-4" /> Nueva junta
          </Button>
        </div>
        <AttendanceStrip />
        <QuickCapture
          date={date}
          onDateChange={setDate}
          onSaved={(id) => {
            setFresh(id)
            window.setTimeout(() => setFresh(undefined), 1800)
          }}
        />
        <section aria-labelledby="day-title" className="pt-2">
          <SectionTitle
            id="day-title"
            sub={dayEntries.length ? plural(dayEntries.length, 'registro', 'registros') : undefined}
            aside={
              <Button size="sm" variant="ghost" onClick={() => setPastOpen(true)}>
                <CalendarPlus className="size-4" /> Registrar días anteriores
              </Button>
            }
          >
            {date === today ? 'Registros de hoy' : `Registros · ${relativeDay(date, today)}`}
          </SectionTitle>
          {dayEntries.length ? (
            <div className="grid gap-2.5">
              {dayEntries.map((e) => (
                <EntryCard key={e.id} entry={e} fresh={e.id === fresh} />
              ))}
            </div>
          ) : !hasHistory ? (
            <EmptyState
              title="Tu diario empieza aquí"
              action={
                <Button onClick={() => setPastOpen(true)}>
                  <CalendarPlus className="size-4" /> Reconstruir mis primeros días
                </Button>
              }
            >
              Escribe arriba lo que hiciste hoy, aunque sea una línea. Si quieres, reconstruye también tus días anteriores desde tu ingreso el {formatDate(profile.startDate, 'long')}.
            </EmptyState>
          ) : (
            <p className="rounded-2xl border border-dashed border-line-strong px-4 py-5 text-sm text-ink-3">
              {date === today ? 'Aún no hay registros hoy. Cuando guardes uno, aparecerá aquí.' : 'Sin registros para este día.'}
            </p>
          )}
        </section>
      </div>

      <aside className="min-w-0 space-y-5" aria-label="Resumen">
        <MyActionsCard />
        <WeekSummary />
        <NextStepCard />
        <PendingCard />
        <BackupReminder />
      </aside>

      <PastDaysSheet open={pastOpen} onOpenChange={setPastOpen} onPick={pickDay} />
    </div>
  )
}

function WeekSummary() {
  const { entries, projects, today } = useData()
  const ws = startOfWeek(today)
  const s = periodSummary(entries, projects, ws, today)
  const days = eachDay(ws, addDays(ws, 6))
  const withEntries = new Set(countable(entries).filter((e) => e.date >= ws && e.date <= today).map((e) => e.date))
  const L = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
  return (
    <section className="card p-5" aria-labelledby="wk-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="wk-title" className="display text-lg">
          Esta semana
        </h2>
        <a href="#/progreso" className="inline-flex items-center gap-0.5 text-sm font-medium text-accent-ink underline-offset-4 hover:underline">
          Progreso <ArrowUpRight className="size-4" aria-hidden />
        </a>
      </div>
      <ol className="mt-3 grid grid-cols-7 gap-1" aria-label="Días de esta semana con registros">
        {days.map((d, i) => {
          const has = withEntries.has(d)
          const future = d > today
          return (
            <li key={d} className="flex flex-col items-center gap-1">
              <span
                aria-hidden
                className={cn(
                  'size-3.5 rounded-full border-2',
                  has ? 'border-accent bg-accent' : future ? 'border-line bg-transparent' : 'border-line-strong bg-transparent',
                  d === today && 'ring-2 ring-[color-mix(in_oklab,var(--accent)_30%,transparent)] ring-offset-2 ring-offset-[var(--surface)]',
                )}
              />
              <span className={cn('text-[11px]', d === today ? 'font-bold text-ink' : 'text-ink-3')} aria-hidden>
                {L[i]}
              </span>
              <span className="sr-only">
                {formatDate(d, 'weekdayDay')}: {future ? 'aún no llega' : has ? 'con registros' : 'sin registros'}
              </span>
            </li>
          )
        })}
      </ol>
      {s.total ? (
        <p className="mt-4 text-sm leading-relaxed text-ink-2">
          <strong className="text-ink">{plural(s.total, 'registro', 'registros')}</strong> en {plural(s.days, 'día', 'días')}
          {s.projects ? ` · ${plural(s.projects, 'proyecto', 'proyectos')}` : ''}
          {s.evidence ? ` · ${s.evidence} como evidencia` : ''}.
        </p>
      ) : (
        <p className="mt-4 text-sm text-ink-3">Sin registros esta semana todavía.</p>
      )}
      <p className="mt-2 text-xs text-ink-3">Un día sin registro no es un día sin trabajo.</p>
    </section>
  )
}

function NextStepCard() {
  const { nextStep } = useData()
  const { repo } = useWorkspace()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(nextStep?.text ?? '')
  const [done, setDone] = useState(false)
  useEffect(() => setText(nextStep?.text ?? ''), [nextStep?.text])
  const save = async (value: string) => {
    const now = nowISO()
    const rec: NextStepSettings = { id: 'nextStep', text: value.trim(), setAt: value.trim() ? now : undefined, createdAt: nextStep?.createdAt ?? now, updatedAt: now }
    try {
      await repo.putSettings(rec)
      setEditing(false)
    } catch (e) {
      toast({ tone: 'error', message: storageErrorMessage(e) })
    }
  }
  const current = nextStep?.text?.trim()
  return (
    <section className="card relative p-5" aria-labelledby="ns-title">
      <h2 id="ns-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Flag className="size-4 text-accent-ink" aria-hidden /> Siguiente paso
      </h2>
      {editing || !current ? (
        <form
          className="mt-3 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save(text)
          }}
        >
          <label htmlFor="ns-input" className="sr-only">
            Siguiente paso
          </label>
          <input id="ns-input" className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="¿Qué sigue? Ej. Pedir feedback de la demo RCO" maxLength={300} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="secondary" disabled={!text.trim() && !current}>
              Fijar
            </Button>
            {editing && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
      ) : (
        <>
          <p className="display mt-2 text-xl leading-snug text-ink">{current}</p>
          {nextStep?.setAt && <p className="mt-1 text-xs text-ink-3">Fijado el {formatDate(todayISO(new Date(nextStep.setAt)), 'dayMonth')}</p>}
          <div className="mt-3 flex gap-2">
            <span className="relative">
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  setDone(true)
                  window.setTimeout(() => setDone(false), 900)
                  await save('')
                  toast({ tone: 'ok', message: 'Siguiente paso completado.' })
                }}
              >
                <CircleCheck className="size-4" /> Hecho
              </Button>
              <Burst show={done} />
            </span>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Cambiar
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

function PendingCard() {
  const { entries, today } = useData()
  const ui = useEntryUi()
  const pending = entries.filter((e) => e.pending)
  if (!pending.length) return null
  return (
    <section className="rounded-[var(--radius-card)] border border-dashed border-[color-mix(in_oklab,var(--warn)_45%,transparent)] bg-warn-soft/60 p-5" aria-labelledby="pd-title">
      <h2 id="pd-title" className="text-sm font-semibold text-warn">
        {plural(pending.length, 'borrador por confirmar', 'borradores por confirmar')}
      </h2>
      <p className="mt-1 text-xs text-ink-2">No cuentan en tus métricas hasta que los confirmes.</p>
      <ul className="mt-3 grid gap-2">
        {pending.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => ui.openEntry(e.id)} className="w-full rounded-xl bg-surface px-3 py-2 text-left hover:bg-surface-2">
              <span className="block text-xs font-medium text-ink-3">{relativeDay(e.date, today)}</span>
              <span className="block text-sm text-ink">{excerpt(e.text, 90)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function BackupReminder() {
  const { entries, today } = useData()
  const { mode } = useWorkspace()
  const last = useLastBackup()
  const exportBackup = useExportBackup()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const n = countable(entries).length
  if (mode === 'demo' || last === undefined) return null
  const lastDay = last ? todayISO(new Date(last)) : null
  const age = lastDay ? diffDays(today, lastDay) : Infinity
  const threshold = mode === 'account' ? 30 : 7
  const since = last ? countable(entries).filter((e) => e.updatedAt > last).length : n
  if (n < 3 || (age < threshold && since < 25)) return null
  return (
    <section className="card p-5" aria-labelledby="bk-title">
      <h2 id="bk-title" className="text-sm font-semibold text-ink">
        Respaldo
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        {last ? `Tu último respaldo descargado fue hace ${plural(age, 'día', 'días')}` : 'Aún no has descargado un respaldo'}
        {since ? ` · ${plural(since, 'registro nuevo o editado', 'registros nuevos o editados')} desde entonces` : ''}.
        {mode === 'account' && ' La sincronización no sustituye un respaldo.'}
      </p>
      <Button
        size="sm"
        className="mt-3"
        loading={busy}
        onClick={async () => {
          setBusy(true)
          try {
            const r = await exportBackup()
            toast({ tone: r.missing ? 'info' : 'ok', message: r.missing ? `Respaldo descargado. ${r.missing} captura(s) no estaban disponibles sin conexión.` : 'Respaldo descargado.' })
          } catch (e) {
            toast({ tone: 'error', message: `No se pudo crear el respaldo: ${(e as Error).message}` })
          } finally {
            setBusy(false)
          }
        }}
      >
        <Download className="size-4" /> Descargar respaldo
      </Button>
    </section>
  )
}

/** Reconstruir el historial día por día desde el ingreso. */
function PastDaysSheet({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (d: string) => void }) {
  const { entries, profile, today } = useData()
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) m.set(e.date, (m.get(e.date) ?? 0) + 1)
    return m
  }, [entries])
  const start = profile.startDate < today ? profile.startDate : addDays(today, -14)
  const days = eachDay(start, addDays(today, -1)).reverse()
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Registrar días anteriores" description={`Desde tu ingreso (${formatDate(profile.startDate, 'medium')}). Elige un día y escribe lo que recuerdes.`}>
      {days.length ? (
        <ul className="grid gap-1.5 pb-4">
          {days.map((d) => {
            const n = counts.get(d) ?? 0
            const weekend = isoWeekday(d) > 5
            return (
              <li key={d}>
                <button type="button" onClick={() => onPick(d)} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-surface-2">
                  <span className={cn('flex-1 text-[15px]', weekend ? 'text-ink-3' : 'text-ink')}>{capitalize(formatDate(d, 'weekdayDay'))}</span>
                  {n ? <Badge tone="neutral">{plural(n, 'registro', 'registros')}</Badge> : <span className="text-xs text-ink-3">Sin registros</span>}
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">Aún no hay días anteriores desde tu ingreso.</p>
      )}
    </Sheet>
  )
}

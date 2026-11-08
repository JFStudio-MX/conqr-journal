import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Info, Pencil, Settings2 } from 'lucide-react'
import type { AttendanceSettings, BonusStage } from '../../db/types'
import { storageErrorMessage } from '../../db/database'
import { attendanceStats, cutoffLabel, dayStatus, stageReferenceDate, statusText, type DayStatus } from '../../lib/attendance'
import { addMonths, capitalize, diffDays, eachDay, endOfMonth, formatDate, isoWeekday, maxDate, minDate, normalizeTime, startOfMonth } from '../../lib/dates'
import { formatMoney, parseMoney, plural } from '../../lib/text'
import { cn, nowISO } from '../../lib/cn'
import { useData } from '../../app/data'
import { useWorkspace } from '../../app/session'
import { AttendanceEditor, STATUS_ICON } from '../Attendance'
import { Badge, Button, SectionTitle, Switch, TextArea, TextField } from '../ui/ui'
import { Modal } from '../ui/overlay'
import { useToast } from '../ui/toast'

const DAY_STYLE: Partial<Record<DayStatus, string>> = {
  antes: 'bg-ok-soft text-ok',
  despues: 'bg-surface-3 text-ink',
  presencial_sin_hora: 'bg-surface-2 text-ink-2',
  home_office: 'bg-surface-2 text-ink-2',
  permiso: 'bg-surface-2 text-ink-2',
  vacaciones: 'bg-surface-2 text-ink-2',
  no_laborable: 'bg-surface-2 text-ink-3',
  sin_registro: 'border border-dashed border-field text-ink-2',
  hoy_pendiente: 'border-2 border-accent text-ink',
  no_aplica: 'text-ink-3/70',
  futuro: 'text-ink-3/60',
  fuera_periodo: 'text-ink-3/50',
}

const LEGEND: DayStatus[] = ['antes', 'despues', 'sin_registro', 'home_office', 'permiso', 'vacaciones', 'no_laborable']

export function PunctualitySection() {
  const { attendance, attendanceSettings: cfg, profile, today } = useData()
  const [month, setMonth] = useState(() => startOfMonth(today))
  const [editor, setEditor] = useState<{ date: string } | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [stageEdit, setStageEdit] = useState<BonusStage | null>(null)
  const stats = useMemo(() => attendanceStats(attendance, cfg, today), [attendance, cfg, today])
  const byDate = useMemo(() => new Map(attendance.map((a) => [a.id, a])), [attendance])
  const minMonth = startOfMonth(minDate(cfg.periodStart, today))
  const maxMonth = startOfMonth(maxDate(minDate(cfg.periodEnd, addMonths(today, 1)), cfg.periodStart))
  const first = startOfMonth(month)
  const days = eachDay(first, endOfMonth(month))
  const lead = isoWeekday(first) - 1

  return (
    <section aria-labelledby="punct-title">
      <SectionTitle
        id="punct-title"
        sub="Registro personal. No sustituye el control oficial de asistencia."
        aside={
          <Button size="sm" variant="ghost" onClick={() => setConfigOpen(true)}>
            <Settings2 className="size-4" /> Horario y reglas
          </Button>
        }
      >
        Puntualidad
      </SectionTitle>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="card p-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-ink-3">A tiempo (antes de las {cutoffLabel(cfg.cutoff)})</dt>
              <dd className="text-2xl font-semibold text-ink">{stats.antes}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Retardos ({cutoffLabel(cfg.cutoff)} o después)</dt>
              <dd className="text-2xl font-semibold text-ink">{stats.despues}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink-3">Puntualidad</dt>
              <dd className="text-ink">
                {stats.pct === null ? (
                  <span className="text-ink-2">Aún sin días presenciales con hora registrada.</span>
                ) : (
                  <>
                    <span className="text-2xl font-semibold">{Math.round(stats.pct * 100)} %</span>{' '}
                    <span className="text-ink-2">sobre {plural(stats.base, 'día presencial', 'días presenciales')} con hora registrada</span>
                  </>
                )}
              </dd>
            </div>
            <div className="col-span-2 rounded-xl border border-dashed border-field px-3 py-2">
              <dt className="text-ink-3">Días presenciales aplicables sin registro</dt>
              <dd className="font-semibold text-ink">
                {stats.sinRegistro} <span className="font-normal text-ink-3">· no cuentan como retardos ni faltas, ni entran en el porcentaje</span>
              </dd>
            </div>
          </dl>
          {(stats.homeOffice || stats.permiso || stats.vacaciones || stats.noLaborable || stats.presencialSinHora) > 0 && (
            <p className="mt-3 text-xs text-ink-3">
              {[
                stats.homeOffice && `Home office: ${stats.homeOffice}`,
                stats.permiso && `Permiso: ${stats.permiso}`,
                stats.vacaciones && `Vacaciones: ${stats.vacaciones}`,
                stats.noLaborable && `No laborable: ${stats.noLaborable}`,
                stats.presencialSinHora && `Presencial sin hora: ${stats.presencialSinHora}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          <p className="mt-3 text-xs text-ink-3">
            Periodo de evaluación: {formatDate(cfg.periodStart, 'medium')} – {formatDate(cfg.periodEnd, 'medium')} · Retardo desde las {cutoffLabel(cfg.cutoff)} exactas. Si llegas a las {cutoffLabel(cfg.earlyArrival ?? '08:30')} o antes, puedes salir {cfg.earlyLeaveMinutes ?? 30} min antes.
          </p>
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <Button size="icon-sm" variant="ghost" aria-label="Mes anterior" disabled={month <= minMonth} onClick={() => setMonth(startOfMonth(addMonths(month, -1)))}>
              <ChevronLeft className="size-5" />
            </Button>
            <p className="text-sm font-semibold">{capitalize(formatDate(month, 'monthYear'))}</p>
            <Button size="icon-sm" variant="ghost" aria-label="Mes siguiente" disabled={month >= maxMonth} onClick={() => setMonth(startOfMonth(addMonths(month, 1)))}>
              <ChevronRight className="size-5" />
            </Button>
          </div>
          <div className="mx-auto grid max-w-[340px] grid-cols-7 gap-1 text-center text-[11px] text-ink-3" aria-hidden>
            {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <ol className="mx-auto mt-1 grid max-w-[340px] grid-cols-7 gap-1" aria-label={`Asistencia de ${formatDate(month, 'monthYear')}`}>
            {Array.from({ length: lead }, (_, i) => (
              <li key={`b${i}`} aria-hidden />
            ))}
            {days.map((d) => {
              const rec = byDate.get(d)
              const st = dayStatus(d, rec, cfg, today)
              const Icon = STATUS_ICON[st]
              const label = `${formatDate(d, 'weekdayDay')}: ${st === 'futuro' ? 'aún no llega' : statusText(st, cfg.cutoff)}${rec?.time ? `, ${rec.time.slice(0, 5)}` : ''}`
              const clickable = d <= today
              return (
                <li key={d}>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => setEditor({ date: d })}
                    aria-label={label}
                    title={label}
                    className={cn('flex aspect-square w-full flex-col items-center justify-center gap-0.5 rounded-lg text-xs disabled:cursor-default', DAY_STYLE[st])}
                  >
                    <span className={cn('leading-none', d === today && 'font-bold')}>{Number(d.slice(8))}</span>
                    {['antes', 'despues', 'home_office', 'permiso', 'vacaciones', 'no_laborable', 'presencial_sin_hora'].includes(st) && <Icon className="size-3" aria-hidden />}
                  </button>
                </li>
              )
            })}
          </ol>
          <ul className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-ink-2" aria-label="Leyenda">
            {LEGEND.map((st) => {
              const Icon = STATUS_ICON[st]
              return (
                <li key={st} className="inline-flex items-center gap-1">
                  <span className={cn('inline-flex size-4 items-center justify-center rounded', DAY_STYLE[st])}>{st !== 'sin_registro' && <Icon className="size-2.5" aria-hidden />}</span>
                  {statusText(st, cfg.cutoff)}
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-[11px] text-ink-3">Toca un día para registrar o corregir.</p>
        </div>
      </div>

      <div className="mt-8">
        <h3 className="display text-xl">Bonos por etapas</h3>
        <p className="mt-1 text-sm text-ink-2">
          Fechas orientativas desde tu ingreso ({formatDate(profile.startDate, 'medium')}). Son aniversarios de referencia, <strong>no fechas de pago confirmadas</strong>. Cumplir el tiempo no marca un bono como ganado: hay que validar las condiciones con la
          empresa.
        </p>
        {cfg.bonusNote && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> Nota: {cfg.bonusNote}
          </p>
        )}
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {([3, 6, 12] as const).map((months) => {
            const stage = cfg.stages.find((s) => s.months === months) ?? { months }
            const ref = stageReferenceDate(profile.startDate, months)
            const left = diffDays(ref, today)
            return (
              <article key={months} className="card flex flex-col gap-3 p-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="display text-2xl">{months} meses</h4>
                  <Button size="icon-sm" variant="ghost" aria-label={`Editar etapa de ${months} meses`} onClick={() => setStageEdit(stage)}>
                    <Pencil className="size-4" />
                  </Button>
                </div>
                <dl className="grid gap-2 text-sm">
                  <div>
                    <dt className="text-ink-3">Aniversario de referencia</dt>
                    <dd className="font-medium">{formatDate(ref, 'long')}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Importe</dt>
                    <dd>{stage.confirmedAmount !== undefined ? <span className="font-medium">{formatMoney(stage.confirmedAmount)} (confirmado)</span> : <Badge tone="outline">Por confirmar</Badge>}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Reglas</dt>
                    <dd className="whitespace-pre-line">{stage.rules?.trim() ? stage.rules : <Badge tone="outline">Por confirmar</Badge>}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Pago previsto</dt>
                    <dd>{stage.expectedPayDate ? formatDate(stage.expectedPayDate, 'medium') : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Pago recibido</dt>
                    <dd>
                      {stage.paymentReceived
                        ? `Sí${stage.paidDate ? ` · ${formatDate(stage.paidDate, 'medium')}` : ''}${stage.paidAmount !== undefined ? ` · ${formatMoney(stage.paidAmount)}` : ''}`
                        : 'No registrado'}
                    </dd>
                  </div>
                </dl>
                <p className="mt-auto text-xs text-ink-3">
                  {left > 0 ? `Faltan ${plural(left, 'día', 'días')} para la fecha de referencia.` : 'Fecha de referencia alcanzada · falta validar condiciones con la empresa.'}
                </p>
              </article>
            )
          })}
        </div>
      </div>

      <AttendanceEditor state={editor} onClose={() => setEditor(null)} />
      <AttendanceConfigModal open={configOpen} onClose={() => setConfigOpen(false)} />
      <StageModal stage={stageEdit} onClose={() => setStageEdit(null)} />
    </section>
  )
}

function useSaveAttendanceSettings() {
  const { repo } = useWorkspace()
  const { attendanceSettings } = useData()
  const toast = useToast()
  return async (patch: Partial<AttendanceSettings>) => {
    const now = nowISO()
    try {
      await repo.putSettings({ ...attendanceSettings, ...patch, id: 'attendance', createdAt: attendanceSettings.createdAt || now, updatedAt: now })
      return true
    } catch (e) {
      toast({ tone: 'error', message: storageErrorMessage(e) })
      return false
    }
  }
}

function AttendanceConfigModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { attendanceSettings: cfg } = useData()
  const save = useSaveAttendanceSettings()
  const [cutoff, setCutoff] = useState(cfg.cutoff)
  const [days, setDays] = useState<number[]>(cfg.onsiteDays)
  const [start, setStart] = useState(cfg.periodStart)
  const [end, setEnd] = useState(cfg.periodEnd)
  const [confirmed, setConfirmed] = useState(cfg.rulesConfirmed)
  const [rules, setRules] = useState(cfg.rules)
  const [note, setNote] = useState(cfg.bonusNote)
  const [early, setEarly] = useState(cfg.earlyArrival ?? '08:30')
  const [earlyMin, setEarlyMin] = useState(String(cfg.earlyLeaveMinutes ?? 30))
  const [exits, setExits] = useState<Record<string, string>>(cfg.exitTimes ?? {})
  const [err, setErr] = useState<string>()
  useEffect(() => {
    if (!open) return
    setCutoff(cfg.cutoff)
    setDays(cfg.onsiteDays)
    setStart(cfg.periodStart)
    setEnd(cfg.periodEnd)
    setConfirmed(cfg.rulesConfirmed)
    setRules(cfg.rules)
    setNote(cfg.bonusNote)
    setEarly(cfg.earlyArrival ?? '08:30')
    setEarlyMin(String(cfg.earlyLeaveMinutes ?? 30))
    setExits(cfg.exitTimes ?? {})
    setErr(undefined)
  }, [open, cfg])
  const L = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
  const N = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Horario, días presenciales y reglas"
      description="Ajusta todo cuando la empresa confirme las reglas."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const c = normalizeTime(cutoff)
              const e = normalizeTime(early)
              if (!c || !e) return setErr('Hora inválida.')
              const cleanExits = Object.fromEntries(Object.entries(exits).filter(([, v]) => normalizeTime(v)).map(([k, v]) => [k, normalizeTime(v)!.slice(0, 5)]))
              if (start > end) return setErr('El periodo termina antes de empezar.')
              if (await save({ cutoff: c.slice(0, 5), onsiteDays: [...days].sort(), periodStart: start, periodEnd: end, rulesConfirmed: confirmed, rules, bonusNote: note, earlyArrival: e.slice(0, 5), earlyLeaveMinutes: Math.max(0, Number(earlyMin) || 0), exitTimes: cleanExits })) onClose()
            }}
          >
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <TextField label="Retardo a partir de" type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} hint="Llegar exactamente a esa hora ya es retardo." error={err} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Llegada temprana (a esta hora o antes)" type="time" value={early} onChange={(e) => setEarly(e.target.value)} />
          <TextField label="Minutos que puedes salir antes" type="number" inputMode="numeric" min={0} value={earlyMin} onChange={(e) => setEarlyMin(e.target.value)} />
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Hora de salida por día <span className="font-normal text-ink-3">(opcional; para calcular tu salida anticipada)</span></legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {N.map((name, i) => (
              <label key={name} className="grid gap-1 text-xs text-ink-2">
                <span className="capitalize">{name}</span>
                <input type="time" className="field" value={exits[String(i + 1)] ?? ''} onChange={(e) => setExits({ ...exits, [String(i + 1)]: e.target.value })} />
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Días presenciales</legend>
          <div className="flex flex-wrap gap-1.5">
            {L.map((l, i) => {
              const d = i + 1
              const on = days.includes(d)
              return (
                <button key={d} type="button" aria-pressed={on} aria-label={N[i]} onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d])} className={cn('size-11 rounded-xl border text-sm font-semibold', on ? 'border-ink-2 bg-surface-2' : 'border-line-strong text-ink-3')}>
                  {l}
                </button>
              )
            })}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Inicio del periodo de evaluación" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <TextField label="Fin del periodo" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <Switch checked={confirmed} onChange={setConfirmed} label="Reglas confirmadas por la empresa" description="Mientras no lo estén, la app no muestra dinero acumulado ni elegibilidad." />
        <TextArea label="Reglas" optional rows={3} value={rules} onChange={(e) => setRules(e.target.value)} placeholder="Cómo se acumula, cuándo se paga, qué pasa con un retardo…" />
        <TextArea label="Nota sobre bonos" optional rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  )
}

function StageModal({ stage, onClose }: { stage: BonusStage | null; onClose: () => void }) {
  const { attendanceSettings: cfg } = useData()
  const save = useSaveAttendanceSettings()
  const [s, setS] = useState<BonusStage | null>(stage)
  const [amount, setAmount] = useState('')
  const [paid, setPaid] = useState('')
  useEffect(() => {
    setS(stage)
    setAmount(stage?.confirmedAmount !== undefined ? String(stage.confirmedAmount) : '')
    setPaid(stage?.paidAmount !== undefined ? String(stage.paidAmount) : '')
  }, [stage])
  if (!stage || !s) return null
  return (
    <Modal
      open={!!stage}
      onOpenChange={(o) => !o && onClose()}
      title={`Etapa de ${stage.months} meses`}
      description="Registra solo lo que la empresa haya confirmado."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const next: BonusStage = { ...s, confirmedAmount: parseMoney(amount), paidAmount: parseMoney(paid) }
              const stages = [3, 6, 12].map((m) => (m === stage.months ? next : (cfg.stages.find((x) => x.months === m) ?? { months: m as 3 | 6 | 12 })))
              if (await save({ stages })) onClose()
            }}
          >
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <TextField label="Importe confirmado (MXN)" optional inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Vacío = Por confirmar" />
        <TextArea label="Reglas de esta etapa" optional rows={3} value={s.rules ?? ''} onChange={(e) => setS({ ...s, rules: e.target.value || undefined })} />
        <TextField label="Fecha prevista de pago" optional type="date" value={s.expectedPayDate ?? ''} onChange={(e) => setS({ ...s, expectedPayDate: e.target.value || undefined })} />
        <Switch checked={!!s.paymentReceived} onChange={(v) => setS({ ...s, paymentReceived: v || undefined })} label="Pago recibido" />
        {s.paymentReceived && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Fecha del pago" optional type="date" value={s.paidDate ?? ''} onChange={(e) => setS({ ...s, paidDate: e.target.value || undefined })} />
            <TextField label="Importe recibido (MXN)" optional inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} />
          </div>
        )}
        <TextArea label="Notas" optional rows={2} value={s.notes ?? ''} onChange={(e) => setS({ ...s, notes: e.target.value || undefined })} />
        <p className="text-xs text-ink-3">La app no suma importes, no asigna el bono de $5,000 a ninguna etapa y no supone que las etapas sean acumulables.</p>
      </div>
    </Modal>
  )
}

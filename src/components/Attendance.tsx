import { useEffect, useRef, useState } from 'react'
import { CalendarOff, ChevronDown, CircleCheck, CircleDashed, Clock3, FileText, House, MapPin, TreePalm, WifiOff } from 'lucide-react'
import type { Attendance, AttendanceKind, Stored } from '../db/types'
import { storageErrorMessage } from '../db/database'
import { ATTENDANCE_KINDS } from '../lib/constants'
import { classifyRecord, cutoffLabel, earlyLeave, statusText, type DayStatus } from '../lib/attendance'
import { formatDate, formatInstant, formatTime, instantToTime, normalizeTime, nowTimeHMS, todayISO } from '../lib/dates'
import { cn } from '../lib/cn'
import { useData } from '../app/data'
import { useWorkspace } from '../app/session'
import { Badge, Button } from './ui/ui'
import { Menu, MenuItem, MenuSeparator, Modal, useConfirm } from './ui/overlay'
import { useToast } from './ui/toast'

export const STATUS_ICON: Record<DayStatus, typeof CircleCheck> = {
  antes: CircleCheck,
  despues: Clock3,
  presencial_sin_hora: MapPin,
  home_office: House,
  permiso: FileText,
  vacaciones: TreePalm,
  no_laborable: CalendarOff,
  sin_registro: CircleDashed,
  hoy_pendiente: CircleDashed,
  no_aplica: CircleDashed,
  futuro: CircleDashed,
  fuera_periodo: CircleDashed,
}

export function statusTone(st: DayStatus): 'ok' | 'neutral' | 'warn' | 'outline' {
  if (st === 'antes') return 'ok'
  if (st === 'sin_registro') return 'outline'
  return 'neutral'
}

/** Franja de llegada en "Hoy". No registra nada al abrir la app: solo al pulsar. */
export function AttendanceStrip() {
  const { attendance, attendanceSettings: cfg, today } = useData()
  const { repo, mode } = useWorkspace()
  const toast = useToast()
  const rec = attendance.find((a) => a.id === today)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [editor, setEditor] = useState<{ date: string; kind?: AttendanceKind } | null>(null)

  const arrive = async () => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    const now = new Date()
    const date = todayISO(now)
    const time = nowTimeHMS(now)
    const offline = !navigator.onLine
    try {
      const r = await repo.registerArrival(date, time, now.toISOString(), offline)
      if (r === 'exists') toast({ tone: 'info', message: 'Ya tenías una llegada registrada hoy. Puedes corregirla.' })
      else {
        const st = classifyRecord({ id: date, kind: 'presencial', time, source: 'boton', createdAt: '', updatedAt: '' }, cfg.cutoff)
        toast({ tone: 'ok', message: `Llegada registrada: ${formatTime(time)} · ${statusText(st, cfg.cutoff)}${offline && mode === 'account' ? ' · sin conexión, se sincronizará' : ''}` })
      }
    } catch (e) {
      toast({ tone: 'error', message: storageErrorMessage(e) })
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const st = rec ? classifyRecord(rec, cfg.cutoff) : null
  const Icon = st ? STATUS_ICON[st] : MapPin
  const early = earlyLeave(rec, cfg)

  return (
    <section aria-label="Llegada de hoy" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line bg-surface px-3.5 py-2.5">
      <Icon className={cn('size-5 shrink-0', st === 'antes' ? 'text-ok' : 'text-ink-3')} aria-hidden />
      <div className="min-w-0 flex-1">
        {rec ? (
          <p className="text-sm text-ink">
            {rec.kind === 'presencial' && rec.time ? (
              <>
                Llegaste a las <strong className="font-semibold">{formatTime(rec.time)}</strong>{' '}
              </>
            ) : null}
            <Badge tone={statusTone(st!)} className="ml-0.5 align-middle">
              {statusText(st!, cfg.cutoff)}
            </Badge>
            {rec.source === 'manual' && <span className="ml-1.5 text-xs text-ink-3">· manual</span>}
            {rec.offline && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-ink-3">
                <WifiOff className="size-3" aria-hidden /> sin conexión
              </span>
            )}
            {early.eligible && (
              <span className="mt-0.5 block text-xs text-ok">
                {early.leaveAt
                  ? `Llegaste temprano: puedes salir a las ${formatTime(early.leaveAt)} (${early.minutes} min antes de tu salida de las ${formatTime(early.exit!)}).`
                  : `Llegaste temprano: puedes salir ${early.minutes} min antes de tu hora de salida de hoy.`}
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-ink-2">
            <span className="font-medium text-ink">Llegada</span> · sin registrar
          </p>
        )}
      </div>
      {rec ? (
        <Button size="sm" variant="ghost" onClick={() => setEditor({ date: today })}>
          Corregir
        </Button>
      ) : (
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline-accent" onClick={() => void arrive()} loading={busy} data-testid="arrived">
            Ya llegué
          </Button>
          <Menu
            trigger={
              <Button size="icon-sm" variant="ghost" aria-label="Otro estado de asistencia">
                <ChevronDown className="size-4" />
              </Button>
            }
          >
            {ATTENDANCE_KINDS.filter((k) => k.id !== 'presencial').map((k) => (
              <MenuItem key={k.id} onSelect={() => setEditor({ date: today, kind: k.id })}>
                {k.label}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem onSelect={() => setEditor({ date: today, kind: 'presencial' })}>Registrar hora manualmente</MenuItem>
          </Menu>
        </div>
      )}
      <AttendanceEditor state={editor} onClose={() => setEditor(null)} />
    </section>
  )
}

/** Alta o corrección manual de un día (uno por fecha). */
export function AttendanceEditor({ state, onClose }: { state: { date: string; kind?: AttendanceKind } | null; onClose: () => void }) {
  const { attendance, attendanceSettings: cfg, today } = useData()
  const { repo, mode } = useWorkspace()
  const toast = useToast()
  const { ask, node } = useConfirm()
  const rec = state ? (attendance.find((a) => a.id === state.date) as Stored<Attendance> | undefined) : undefined
  const [kind, setKind] = useState<AttendanceKind>('presencial')
  const [time, setTime] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!state) return
    setKind(state.kind ?? rec?.kind ?? 'presencial')
    setTime(rec?.time ? rec.time.slice(0, 5) : '')
    setNote(rec?.note ?? '')
    setErr(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.date, state?.kind])

  if (!state) return null
  const save = async () => {
    const t = kind === 'presencial' ? normalizeTime(time) : null
    if (kind === 'presencial' && time && !t) return setErr('Hora inválida.')
    if (state.date > today) return setErr('No se puede registrar un día futuro.')
    setSaving(true)
    try {
      const keepSeconds = t && rec?.time && rec.time.slice(0, 5) === t.slice(0, 5) ? rec.time : t
      await repo.setAttendance({
        id: state.date,
        kind,
        time: kind === 'presencial' ? keepSeconds ?? undefined : undefined,
        note: note.trim() || undefined,
        source: 'manual',
        offline: rec?.offline,
        createdAt: rec?.createdAt ?? '',
        updatedAt: '',
      })
      toast({ tone: 'ok', message: 'Asistencia guardada.' })
      onClose()
    } catch (e) {
      setErr(storageErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  const remove = async () => {
    if (!rec) return
    const ok = await ask({ title: '¿Eliminar el registro de este día?', body: 'El día quedará “sin registro”.', confirm: 'Eliminar', tone: 'danger' })
    if (!ok) return
    try {
      const prev = await repo.remove('attendance', rec.id)
      onClose()
      if (prev)
        toast({
          tone: 'info',
          message: 'Registro de asistencia eliminado.',
          action: { label: 'Deshacer', onClick: () => void repo.restore('attendance', prev) },
        })
    } catch (e) {
      toast({ tone: 'error', message: storageErrorMessage(e) })
    }
  }

  const preview = kind === 'presencial' && normalizeTime(time) ? classifyRecord({ id: '', kind, time: normalizeTime(time)!, source: 'manual', createdAt: '', updatedAt: '' }, cfg.cutoff) : null

  return (
    <>
      <Modal
        open={!!state}
        onOpenChange={(o) => !o && onClose()}
        title={`Asistencia · ${formatDate(state.date, 'weekdayDay')}`}
        description="Registro personal; no sustituye el control oficial de asistencia."
        footer={
          <>
            {rec && (
              <Button variant="danger" onClick={() => void remove()} className="mr-auto">
                Eliminar
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => void save()} loading={saving}>
              Guardar
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Estado</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ATTENDANCE_KINDS.map((k) => (
                <label key={k.id} className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm', kind === k.id ? 'border-ink-2 bg-surface-2 font-semibold' : 'border-line-strong')}>
                  <input type="radio" name="att-kind" className="accent-[var(--accent-ink)]" checked={kind === k.id} onChange={() => setKind(k.id)} />
                  {k.label}
                </label>
              ))}
            </div>
          </fieldset>
          {kind === 'presencial' && (
            <div className="grid gap-1.5">
              <label htmlFor="att-time" className="text-sm font-medium">
                Hora de llegada (Ciudad de México)
              </label>
              <input id="att-time" type="time" className="field w-40" value={time} onChange={(e) => setTime(e.target.value)} />
              {preview && <p className="text-sm text-ink-2">Quedará como: <strong>{statusText(preview, cfg.cutoff)}</strong> (retardo desde las {cutoffLabel(cfg.cutoff)} exactas).</p>}
              {!time && <p className="text-xs text-ink-3">Sin hora, el día cuenta como presencial pero no entra en el porcentaje.</p>}
            </div>
          )}
          <div className="grid gap-1.5">
            <label htmlFor="att-note" className="text-sm font-medium">
              Nota <span className="font-normal text-ink-3">(opcional)</span>
            </label>
            <input id="att-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </div>
          {rec && (
            <div className="rounded-xl bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-2">
              {rec.declaredAt && <p>Hora declarada al pulsar “Ya llegué”: {formatTime(instantToTime(rec.declaredAt))} (reloj del dispositivo)</p>}
              {mode === 'account' && <p>{rec._srvCreated ? `Recibido por el servidor: ${formatInstant(rec._srvCreated)}` : 'Aún no recibido por el servidor (pendiente de sincronizar).'}</p>}
              {rec.offline && <p>Registrado sin conexión.</p>}
              {rec.correctedFrom && (
                <p>
                  Corregido manualmente. Antes: {ATTENDANCE_KINDS.find((k) => k.id === rec.correctedFrom!.kind)?.label}
                  {rec.correctedFrom.time ? ` a las ${formatTime(rec.correctedFrom.time)}` : ''} ({rec.correctedFrom.source === 'boton' ? 'botón' : 'manual'}).
                </p>
              )}
            </div>
          )}
          {err && (
            <p role="alert" className="text-sm font-medium text-danger">
              {err}
            </p>
          )}
        </div>
      </Modal>
      {node}
    </>
  )
}

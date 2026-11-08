import { useMemo, useState } from 'react'
import { Info, Table2 } from 'lucide-react'
import { CATEGORIES, CATEGORY_BY_ID, PRIMARY_PRIORITY } from '../lib/constants'
import { addDays, formatDate, minDate, startOfWeek } from '../lib/dates'
import { countable, distribution, lowData, periodSummary, skillsOverTime, weeklyActivity, type CatKey, type WeekBucket } from '../lib/metrics'
import { plural } from '../lib/text'
import { cn } from '../lib/cn'
import { useData } from '../app/data'
import { useEntryUi } from '../app/entry-ui'
import { CategoryIcon } from '../components/bits'
import { Button, EmptyState, SectionTitle } from '../components/ui/ui'
import { GoalsSection, ReflectionSection } from '../components/progress/Goals'
import { PunctualitySection } from '../components/progress/Punctuality'

type Range = '8' | '12' | 'all'

export function ProgressScreen() {
  const { entries, projects, profile, today } = useData()
  const [range, setRange] = useState<Range>('12')
  const firstEntry = useMemo(() => countable(entries).reduce((m, e) => (e.date < m ? e.date : m), today), [entries, today])
  const from = range === 'all' ? minDate(profile.startDate, firstEntry) : addDays(startOfWeek(today), -7 * (Number(range) - 1))
  const weeks = useMemo(() => weeklyActivity(entries, from, today), [entries, from, today])
  const summary = periodSummary(entries, projects, from, today)
  const low = lowData(weeks)

  return (
    <div className="mx-auto max-w-[1160px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[2.3rem] leading-none sm:text-5xl">Progreso</h1>
          <p className="mt-2 max-w-xl text-sm text-ink-3">Lo que has registrado, no un puntaje. Un registro no equivale a una entrega; practicar no es dominar.</p>
        </div>
        <div role="group" aria-label="Periodo" className="inline-flex rounded-full border border-line-strong bg-surface p-1">
          {(
            [
              ['8', '8 semanas'],
              ['12', '12 semanas'],
              ['all', 'Desde mi ingreso'],
            ] as [Range, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={range === id}
              onClick={() => setRange(id)}
              className={cn('h-9 rounded-full px-3.5 text-sm font-medium', range === id ? 'bg-[var(--btn-primary)] text-[var(--btn-primary-fg)]' : 'text-ink-2 hover:text-ink')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <nav aria-label="Ir a" className="no-scrollbar mt-5 flex gap-2 overflow-x-auto pb-1">
        {[
          ['#pg-actividad', 'Actividad'],
          ['#pg-objetivos', 'Objetivos'],
          ['#pg-semana', 'Revisión semanal'],
          ['#pg-puntualidad', 'Puntualidad'],
        ].map(([href, label]) => (
          <a key={href} href={href} onClick={(e) => { e.preventDefault(); document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }} className="shrink-0 rounded-full border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2">
            {label}
          </a>
        ))}
      </nav>

      <p className="mt-5 text-[15px] text-ink-2" aria-live="polite">
        {summary.total ? (
          <>
            En este periodo: <strong className="text-ink">{plural(summary.total, 'registro', 'registros')}</strong> en {plural(summary.days, 'día', 'días')}
            {summary.projects ? `, ${plural(summary.projects, 'proyecto', 'proyectos')}` : ''}
            {summary.evidence ? `, ${summary.evidence} marcados como evidencia` : ''}
            {summary.withDelivery ? `; ${plural(summary.withDelivery, 'registro', 'registros')} con categoría Entrega` : ''}.
          </>
        ) : (
          'Aún no hay registros confirmados en este periodo.'
        )}
      </p>
      {low && low !== 'none' && (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {low === 'few'
            ? 'Hay pocos registros: las gráficas todavía no muestran tendencias.'
            : 'Más de la mitad de las semanas no tienen registros. Eso no significa que no hayas trabajado: solo que no se registró.'}
        </p>
      )}

      <section id="pg-actividad" className="mt-8 grid scroll-mt-20 items-start gap-6 xl:grid-cols-2" aria-label="Actividad">
        <div className="card p-5 sm:p-6 xl:col-span-2">
          <WeeklyChart weeks={weeks} />
        </div>
        <div className="card p-5 sm:p-6">
          <DistributionChart from={from} to={today} />
        </div>
        <div className="card p-5 sm:p-6">
          <SkillsGrid from={from} to={today} weeks={weeks} />
        </div>
      </section>

      <div id="pg-objetivos" className="mt-12 scroll-mt-20">
        <GoalsSection />
      </div>
      <div id="pg-semana" className="mt-12 scroll-mt-20">
        <ReflectionSection />
      </div>
      <div id="pg-puntualidad" className="mt-12 scroll-mt-20">
        <PunctualitySection />
      </div>
    </div>
  )
}

function niceMax(n: number): { max: number; step: number } {
  if (n <= 4) return { max: 4, step: 1 }
  if (n <= 10) return { max: Math.ceil(n / 2) * 2, step: 2 }
  if (n <= 25) return { max: Math.ceil(n / 5) * 5, step: 5 }
  return { max: Math.ceil(n / 10) * 10, step: 10 }
}

const STACK: CatKey[] = [...CATEGORIES.map((c) => c.id), 'sin']
const catColor = (k: CatKey) => (k === 'sin' ? 'var(--cat-sin)' : CATEGORY_BY_ID[k].color)
const catLabel = (k: CatKey) => (k === 'sin' ? 'Sin categoría' : CATEGORY_BY_ID[k].label)

function WeeklyChart({ weeks }: { weeks: WeekBucket[] }) {
  const { today } = useData()
  const ui = useEntryUi()
  const [sel, setSel] = useState<string | null>(null)
  const [table, setTable] = useState(false)
  const maxTotal = Math.max(0, ...weeks.map((w) => w.total))
  const { max, step } = niceMax(maxTotal)
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step)
  const H = 200
  const every = weeks.length <= 8 ? 1 : weeks.length <= 16 ? 2 : Math.ceil(weeks.length / 8)
  const present = STACK.filter((k) => weeks.some((w) => w.byCat[k] > 0))
  const thisWeek = startOfWeek(today)
  const selected = weeks.find((w) => w.weekStart === sel)
  const total = weeks.reduce((s, w) => s + w.total, 0)
  const withData = weeks.filter((w) => w.total > 0).length

  return (
    <figure>
      <SectionTitle
        sub={`${plural(total, 'registro', 'registros')} · ${withData} de ${plural(weeks.length, 'semana', 'semanas')} con registros`}
        aside={
          <Button size="sm" variant="ghost" aria-pressed={table} onClick={() => setTable((t) => !t)}>
            <Table2 className="size-4" /> {table ? 'Ver gráfica' : 'Ver tabla'}
          </Button>
        }
      >
        Actividad registrada por semana
      </SectionTitle>
      {total === 0 ? (
        <EmptyState title="Sin registros en este periodo">Cuando registres tu trabajo, aquí verás cuántos registros hiciste cada semana y de qué tipo.</EmptyState>
      ) : table ? (
        <div className="overflow-x-auto">
          <table className="tabular w-full min-w-[520px] text-sm">
            <caption className="sr-only">Registros por semana y categoría principal</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Semana
                </th>
                {present.map((k) => (
                  <th key={k} scope="col" className="px-2 py-2 text-right font-medium">
                    {catLabel(k)}
                  </th>
                ))}
                <th scope="col" className="py-2 pl-2 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.weekStart} className="border-b border-line/60">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    {formatDate(w.weekStart, 'dayMonth')}–{formatDate(w.weekEnd, 'dayMonth')}
                  </th>
                  {present.map((k) => (
                    <td key={k} className="px-2 py-1.5 text-right">
                      {w.byCat[k] || '·'}
                    </td>
                  ))}
                  <td className="py-1.5 pl-2 text-right font-semibold">{w.total || 'sin registros'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Leyenda">
            {present.map((k) => (
              <li key={k} className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                <span className="size-2.5 rounded-[3px]" style={{ background: catColor(k) }} aria-hidden />
                <CategoryIcon id={k} className="size-3.5" colored={false} />
                {catLabel(k)}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <div className="relative w-6 shrink-0 text-right text-[11px] text-ink-3 tabular" style={{ height: H }} aria-hidden>
              {ticks.map((t) => (
                <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / max) * H }}>
                  {t}
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div className="relative" style={{ height: H }}>
                {ticks.map((t) => (
                  <span key={t} aria-hidden className={cn('absolute inset-x-0 h-px', t === 0 ? 'bg-line-strong' : 'bg-[var(--grid)]')} style={{ top: H - (t / max) * H }} />
                ))}
                <ol className="absolute inset-0 flex items-end gap-px" aria-label="Semanas">
                  {weeks.map((w) => {
                    const label = `Semana del ${formatDate(w.weekStart, 'dayMonth')} al ${formatDate(w.weekEnd, 'dayMonth')}: ${
                      w.total ? `${plural(w.total, 'registro', 'registros')} (${present.filter((k) => w.byCat[k]).map((k) => `${catLabel(k)} ${w.byCat[k]}`).join(', ')})` : 'sin registros'
                    }`
                    return (
                      <li key={w.weekStart} className="flex h-full min-w-0 flex-1">
                        <button
                          type="button"
                          aria-label={label}
                          aria-pressed={sel === w.weekStart}
                          title={label}
                          onClick={() => setSel(sel === w.weekStart ? null : w.weekStart)}
                          className={cn('group flex h-full w-full flex-col items-center justify-end rounded-md', sel === w.weekStart && 'bg-surface-2')}
                        >
                          {w.total ? (
                            <span className="flex w-[70%] max-w-6 flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px]" style={{ height: (w.total / max) * H }}>
                              {STACK.filter((k) => w.byCat[k]).map((k) => (
                                <span key={k} className="w-full shrink-0" style={{ flexGrow: w.byCat[k], flexBasis: 0, background: catColor(k) }} />
                              ))}
                            </span>
                          ) : (
                            <span className="mb-[-1px] h-[3px] w-[45%] max-w-4 rounded-full bg-line-strong" />
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </div>
              <ol className="mt-1.5 flex gap-px" aria-hidden>
                {weeks.map((w, i) => (
                  <li key={w.weekStart} className="min-w-0 flex-1 text-center text-[10.5px] leading-tight text-ink-3">
                    {w.weekStart === thisWeek ? <span className="font-semibold text-ink-2">Esta</span> : (weeks.length - 1 - i) % every === 0 ? formatDate(w.weekStart, 'dayMonth') : ''}
                  </li>
                ))}
              </ol>
            </div>
          </div>
          {selected ? (
            <div className="anim-fade mt-4 rounded-2xl bg-surface-2 p-4">
              <p className="text-sm font-semibold">
                Semana del {formatDate(selected.weekStart, 'dayMonth')} al {formatDate(selected.weekEnd, 'medium')}
              </p>
              {selected.total ? (
                <>
                  <p className="mt-1 text-sm text-ink-2">
                    {plural(selected.total, 'registro', 'registros')} en {plural(selected.days, 'día', 'días')}
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {STACK.filter((k) => selected.byCat[k]).map((k) => (
                      <li key={k} className="inline-flex items-center gap-1.5 text-sm">
                        <CategoryIcon id={k} /> {catLabel(k)}: <strong className="tabular">{selected.byCat[k]}</strong>
                      </li>
                    ))}
                  </ul>
                  <Button size="sm" className="mt-3" onClick={() => ui.openList(`Semana del ${formatDate(selected.weekStart, 'dayMonth')}`, selected.entryIds)}>
                    Ver los registros
                  </Button>
                </>
              ) : (
                <p className="mt-1 text-sm text-ink-3">Sin registros esta semana. No significa que no hayas trabajado.</p>
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-3">Toca una semana para ver el detalle y sus registros.</p>
          )}
        </>
      )}
      <figcaption className="mt-4 text-xs leading-relaxed text-ink-3">
        Cada registro cuenta una vez, en su categoría principal ({PRIMARY_PRIORITY.map((c) => CATEGORY_BY_ID[c].label).join(' › ')}). Los borradores “Por confirmar” no cuentan. Un registro no equivale a una entrega.
      </figcaption>
    </figure>
  )
}

function DistributionChart({ from, to }: { from: string; to: string }) {
  const { entries, projects, brands } = useData()
  const ui = useEntryUi()
  const [by, setBy] = useState<'project' | 'brand'>('project')
  const rows = distribution(entries, projects, brands, by, from, to)
  const max = Math.max(1, ...rows.map((r) => r.count))
  const total = rows.reduce((s, r) => s + r.count, 0)
  return (
    <figure>
      <SectionTitle
        sub={total ? `${plural(total, 'registro', 'registros')} · cada uno cuenta una vez` : undefined}
        aside={
          <div role="group" aria-label="Agrupar por" className="inline-flex rounded-full border border-line-strong p-0.5">
            {(
              [
                ['project', 'Proyecto'],
                ['brand', 'Marca'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={by === id} onClick={() => setBy(id)} className={cn('h-8 rounded-full px-3 text-sm', by === id ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2')}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        Registros por {by === 'project' ? 'proyecto' : 'marca'}
      </SectionTitle>
      {rows.length ? (
        <ol className="grid gap-1">
          {rows.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => ui.openList(r.label, r.entryIds)}
                className="grid w-full grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 rounded-lg px-1 py-2 text-left hover:bg-surface-2"
                aria-label={`${r.label}: ${plural(r.count, 'registro', 'registros')}. Ver registros`}
              >
                <span className={cn('truncate text-sm', r.kind === 'item' ? 'text-ink' : 'text-ink-3 italic')}>{r.label}</span>
                <span className="h-3">
                  <span
                    className={cn('block h-full rounded-r-[4px]', r.kind === 'unconfirmed' && 'border border-dashed border-ink-3')}
                    style={{ width: `${Math.max(2, (r.count / max) * 100)}%`, background: r.kind === 'item' ? 'var(--ink-2)' : 'var(--cat-sin)' }}
                  />
                </span>
                <span className="tabular w-8 text-right text-sm font-semibold">{r.count}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-ink-3">Sin registros en este periodo.</p>
      )}
      <figcaption className="mt-3 text-xs text-ink-3">Toca una barra para ver los registros que la forman.</figcaption>
    </figure>
  )
}

function SkillsGrid({ from, to, weeks }: { from: string; to: string; weeks: WeekBucket[] }) {
  const { entries } = useData()
  const ui = useEntryUi()
  const rows = skillsOverTime(entries, from, to).slice(0, 8)
  const cols = weeks.slice(-12)
  const truncated = weeks.length > cols.length
  return (
    <figure>
      <SectionTitle sub="Cada punto enlaza a registros reales">Habilidades practicadas</SectionTitle>
      {rows.length ? (
        <div className="grid gap-1.5">
          {rows.map((s) => (
            <div key={s.key} className="grid grid-cols-[minmax(0,8.5rem)_1fr] items-center gap-3">
              <button type="button" onClick={() => ui.openList(s.label, s.entryIds, 'habilidad practicada')} className="min-w-0 rounded-md px-1 py-1 text-left hover:bg-surface-2">
                <span className="block truncate text-sm text-ink">{s.label}</span>
                <span className="block text-[11px] text-ink-3">{plural(s.total, 'registro', 'registros')}</span>
              </button>
              <ol className="flex items-center" aria-label={`${s.label} por semana`}>
                {cols.map((w) => {
                  const ids = s.weeks[w.weekStart] ?? []
                  const n = ids.length
                  const size = n >= 3 ? 16 : n === 2 ? 12 : 8
                  return (
                    <li key={w.weekStart} className="flex h-8 min-w-0 flex-1 items-center justify-center">
                      {n ? (
                        <button
                          type="button"
                          onClick={() => ui.openList(`${s.label} · semana del ${formatDate(w.weekStart, 'dayMonth')}`, ids)}
                          aria-label={`${s.label}, semana del ${formatDate(w.weekStart, 'dayMonth')}: ${plural(n, 'registro', 'registros')}`}
                          className="flex size-7 items-center justify-center rounded-full hover:bg-surface-2"
                        >
                          <span className="rounded-full ring-2 ring-[var(--surface)]" style={{ width: size, height: size, background: 'var(--ink-2)' }} />
                        </button>
                      ) : (
                        <span className="size-1 rounded-full bg-line-strong" aria-hidden />
                      )}
                    </li>
                  )
                })}
              </ol>
            </div>
          ))}
          <p className="mt-1 pl-[9.25rem] text-[11px] text-ink-3" aria-hidden>
            {cols.length ? `${formatDate(cols[0].weekStart, 'dayMonth')} → ${formatDate(cols[cols.length - 1].weekStart, 'dayMonth')}` : ''}
          </p>
        </div>
      ) : (
        <EmptyState title="Aún no hay habilidades registradas">En “Agregar detalles”, anota la habilidad que practicaste. Aquí verás cuándo la practicaste y en qué registros.</EmptyState>
      )}
      <figcaption className="mt-3 text-xs text-ink-3">
        Tamaño del punto = registros en la semana (1, 2, 3+). Practicar una habilidad no demuestra dominarla.{truncated ? ' Se muestran las últimas 12 semanas.' : ''}
      </figcaption>
    </figure>
  )
}

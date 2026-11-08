import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { cn } from '../../lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'subtle' | 'danger' | 'outline-accent'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-[var(--btn-primary)] text-[var(--btn-primary-fg)] hover:bg-[var(--btn-primary-hover)] shadow-[0_1px_0_rgb(0_0_0/0.08)] disabled:opacity-55',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2 disabled:opacity-55',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50',
  subtle: 'bg-surface-2 text-ink hover:bg-surface-3 disabled:opacity-55',
  danger: 'bg-surface text-danger border border-[color-mix(in_oklab,var(--danger)_45%,transparent)] hover:bg-danger-soft disabled:opacity-55',
  'outline-accent': 'bg-surface text-accent-ink border border-[color-mix(in_oklab,var(--accent)_55%,transparent)] hover:bg-accent-soft disabled:opacity-55',
}
const SIZE: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-[10px]',
  md: 'h-11 px-4 text-[15px] gap-2 rounded-xl',
  lg: 'h-12 px-5 text-base gap-2 rounded-xl',
  icon: 'h-11 w-11 rounded-xl',
  'icon-sm': 'h-9 w-9 rounded-[10px]',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background-color,color,border-color,transform] duration-150 select-none active:translate-y-px',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading && <LoaderCircle className="spin size-4" aria-hidden />}
      {children}
    </button>
  )
})

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn('spin size-4', className)} aria-hidden />
}

/** Chip conmutable. El estado se comunica con check + aria-pressed, no solo con color. */
export function Chip({
  pressed,
  onPressedChange,
  color,
  icon,
  children,
  className,
  title,
}: {
  pressed: boolean
  onPressedChange: (v: boolean) => void
  color?: string
  icon?: ReactNode
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
        pressed ? 'font-semibold text-ink' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-2',
        className,
      )}
      style={
        pressed && color
          ? { borderColor: color, background: `color-mix(in oklab, ${color} 14%, var(--surface))` }
          : pressed
            ? { borderColor: 'var(--ink-2)', background: 'var(--surface-2)' }
            : undefined
      }
    >
      {pressed ? <Check className="size-4" aria-hidden strokeWidth={2.5} /> : icon}
      {children}
    </button>
  )
}

export function Badge({ children, tone = 'neutral', className, title }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'outline'; className?: string; title?: string }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-2',
    accent: 'bg-accent-soft text-accent-ink',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    danger: 'bg-danger-soft text-danger',
    outline: 'border border-line-strong text-ink-2',
  }
  return (
    <span title={title} className={cn('inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>
      {children}
    </span>
  )
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ background: color }} />
}

interface FieldShellProps {
  label: ReactNode
  hint?: ReactNode
  error?: string
  children: (id: string, describedBy?: string) => ReactNode
  className?: string
  optional?: boolean
}
export function FieldShell({ label, hint, error, children, className, optional }: FieldShellProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const described = [hintId, errId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {optional && <span className="ml-1 font-normal text-ink-3">(opcional)</span>}
      </label>
      {children(id, described)}
      {hint && (
        <p id={hintId} className="text-xs text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function TextField({ label, hint, error, optional, className, ...rest }: { label: ReactNode; hint?: ReactNode; error?: string; optional?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} hint={hint} error={error} optional={optional} className={className}>
      {(id, d) => <input id={id} aria-describedby={d} aria-invalid={error ? true : undefined} className="field" {...rest} />}
    </FieldShell>
  )
}

export function TextArea({ label, hint, error, optional, className, rows = 3, ...rest }: { label: ReactNode; hint?: ReactNode; error?: string; optional?: boolean } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} hint={hint} error={error} optional={optional} className={className}>
      {(id, d) => <textarea id={id} rows={rows} aria-describedby={d} className="field resize-y leading-relaxed" {...rest} />}
    </FieldShell>
  )
}

export function SelectField({ label, hint, optional, className, children, ...rest }: { label: ReactNode; hint?: ReactNode; optional?: boolean } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldShell label={label} hint={hint} optional={optional} className={className}>
      {(id, d) => (
        <select id={id} aria-describedby={d} className="field appearance-auto pr-8" {...rest}>
          {children}
        </select>
      )}
    </FieldShell>
  )
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="block text-xs text-ink-3">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors',
          checked ? 'border-transparent bg-[var(--btn-primary)]' : 'border-field bg-surface-2',
        )}
      >
        <span className={cn('inline-block size-5 rounded-full bg-surface shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
        <span className="sr-only">{checked ? 'Activado' : 'Desactivado'}</span>
      </button>
    </div>
  )
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface/60 p-5 sm:p-6">
      {icon && <div className="text-ink-3">{icon}</div>}
      <div>
        <p className="display text-xl text-ink">{title}</p>
        {children && <div className="mt-1 max-w-prose text-sm text-ink-2">{children}</div>}
      </div>
      {action}
    </div>
  )
}

export function SectionTitle({ children, aside, id, sub }: { children: ReactNode; aside?: ReactNode; id?: string; sub?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 id={id} className="display text-[1.4rem] leading-tight text-ink sm:text-2xl">
          {children}
        </h2>
        {sub && <p className="mt-0.5 text-sm text-ink-3">{sub}</p>}
      </div>
      {aside}
    </div>
  )
}

/** Pequeña celebración (se desactiva con reduced motion). */
export function Burst({ show, color = 'var(--accent)' }: { show: boolean; color?: string }) {
  if (!show) return null
  const dots = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2
    return { dx: `${Math.cos(a) * 26}px`, dy: `${Math.sin(a) * 26}px` }
  })
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {dots.map((d, i) => (
        <span key={i} className="burst-dot" style={{ background: i % 2 ? color : 'var(--cat-logro)', ['--dx' as string]: d.dx, ['--dy' as string]: d.dy }} />
      ))}
    </span>
  )
}

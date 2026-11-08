import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { CircleCheck, Info, OctagonExclamationPoint, X } from 'lucide-react'
import { cn, uid } from '../../lib/cn'

export interface ToastOptions {
  message: ReactNode
  tone?: 'ok' | 'info' | 'error'
  action?: { label: string; onClick: () => void }
  duration?: number
}
interface ToastItem extends ToastOptions {
  id: string
}

const Ctx = createContext<(t: ToastOptions) => void>(() => {})

export function useToast() {
  return useContext(Ctx)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((t: ToastOptions) => {
    setItems((prev) => [...prev.slice(-2), { ...t, id: uid() }])
  }, [])
  const dismiss = (id: string) => setItems((p) => p.filter((t) => t.id !== id))
  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        className="no-print pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-3 bottom-[calc(76px+env(safe-area-inset-bottom))] lg:right-6 lg:bottom-6 lg:left-auto lg:items-end"
        aria-live="polite"
        role="region"
        aria-label="Avisos"
      >
        {items.map((t) => (
          <Toast key={t.id} item={t} onDone={() => dismiss(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  )
}

function Toast({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  const [paused, setPaused] = useState(false)
  const remaining = useRef(item.duration ?? (item.action ? 7000 : 4000))
  useEffect(() => {
    if (paused) return
    const start = Date.now()
    const t = window.setTimeout(onDone, remaining.current)
    return () => {
      window.clearTimeout(t)
      remaining.current -= Date.now() - start
    }
  }, [paused, onDone])
  const Icon = item.tone === 'error' ? OctagonExclamationPoint : item.tone === 'ok' ? CircleCheck : Info
  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        'anim-sheet pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-2xl px-4 py-3 text-[15px] shadow-lift',
        'bg-[#202124] text-[#f6f3ee] dark:bg-[#efebe5] dark:text-[#202124]',
      )}
    >
      <Icon className={cn('size-5 shrink-0', item.tone === 'error' ? 'text-[#ff8f86] dark:text-[#b42318]' : 'opacity-80')} aria-hidden />
      <div className="min-w-0 flex-1">{item.message}</div>
      {item.action && (
        <button
          type="button"
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-semibold underline-offset-4 hover:underline"
          onClick={() => {
            item.action!.onClick()
            onDone()
          }}
        >
          {item.action.label}
        </button>
      )}
      <button type="button" onClick={onDone} className="shrink-0 rounded-lg p-1 opacity-70 hover:opacity-100" aria-label="Cerrar aviso">
        <X className="size-4" />
      </button>
    </div>
  )
}

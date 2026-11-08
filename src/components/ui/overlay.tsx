import { useState, type ReactNode } from 'react'
import { Dialog, DropdownMenu } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { Button } from './ui'

/**
 * Hoja de detalle: en móvil sube desde abajo (alcanzable con una mano);
 * en escritorio aparece a la derecha sin perder el contexto.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
  guard,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  /** Evita cerrar con un toque fuera (p. ej. mientras editas). */
  guard?: boolean
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-40 bg-[rgb(20_18_16/0.42)] backdrop-blur-[2px]" />
        <Dialog.Content
          onPointerDownOutside={guard ? (e) => e.preventDefault() : undefined}
          onInteractOutside={guard ? (e) => e.preventDefault() : undefined}
          className={cn(
            'fixed z-50 flex flex-col bg-surface shadow-lift outline-none',
            'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-[22px] anim-sheet',
            'lg:inset-y-0 lg:right-0 lg:left-auto lg:bottom-auto lg:h-dvh lg:max-h-none lg:rounded-none lg:rounded-l-[22px] lg:anim-side',
            wide ? 'lg:w-[min(720px,92vw)]' : 'lg:w-[min(560px,92vw)]',
          )}
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong lg:hidden" aria-hidden />
          <header className="flex items-start gap-3 border-b border-line px-5 pt-3 pb-3 lg:pt-5">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="display text-xl leading-snug text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-sm text-ink-3">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">Detalle</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Cerrar">
                <X className="size-5" />
              </Button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
          {footer && <footer className="safe-bottom border-t border-line bg-surface px-5 py-3">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-40 bg-[rgb(20_18_16/0.42)] backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'anim-sheet fixed inset-x-3 bottom-3 z-50 flex max-h-[88dvh] flex-col rounded-[20px] bg-surface shadow-lift outline-none',
            'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2',
            size === 'sm' ? 'sm:w-[420px]' : size === 'lg' ? 'sm:w-[min(760px,94vw)]' : 'sm:w-[540px]',
          )}
        >
          <div className="flex items-start gap-3 px-5 pt-5">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="display text-xl leading-snug text-ink">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-1 text-sm text-ink-2">{description}</Dialog.Description> : <Dialog.Description className="sr-only">Diálogo</Dialog.Description>}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Cerrar">
                <X className="size-5" />
              </Button>
            </Dialog.Close>
          </div>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex flex-wrap justify-end gap-2 px-5 pt-1 pb-5">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Confirmación explícita para acciones destructivas o difíciles de deshacer. */
export function useConfirm() {
  const [state, setState] = useState<{
    title: string
    body?: ReactNode
    confirm: string
    tone?: 'danger' | 'primary'
    resolve: (v: boolean) => void
  } | null>(null)
  const ask = (opts: { title: string; body?: ReactNode; confirm?: string; tone?: 'danger' | 'primary' }) =>
    new Promise<boolean>((resolve) => setState({ confirm: 'Confirmar', ...opts, resolve }))
  const close = (v: boolean) => {
    state?.resolve(v)
    setState(null)
  }
  const node = (
    <Modal
      open={!!state}
      onOpenChange={(o) => !o && close(false)}
      title={state?.title ?? ''}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button variant={state?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)}>
            {state?.confirm}
          </Button>
        </>
      }
    >
      {state?.body && <div className="text-sm text-ink-2">{state.body}</div>}
    </Modal>
  )
  return { ask, node }
}

export function Menu({ trigger, children, align = 'end' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="anim-fade z-50 min-w-[220px] rounded-2xl border border-line bg-surface p-1.5 shadow-lift"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function MenuItem({ children, onSelect, danger, icon, disabled }: { children: ReactNode; onSelect: () => void; danger?: boolean; icon?: ReactNode; disabled?: boolean }) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-[15px] outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      {icon && <span className="text-ink-3 [&>svg]:size-4">{icon}</span>}
      {children}
    </DropdownMenu.Item>
  )
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-line" />
}

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Construction, ImageOff, MessageSquareQuote, PackageCheck, Sprout, TrendingUp, Trophy, CircleDashed } from 'lucide-react'
import type { Attachment, Brand, CategoryId, Entry, Project } from '../db/types'
import { CATEGORY_BY_ID } from '../lib/constants'
import { cn } from '../lib/cn'
import { useWorkspace } from '../app/session'
import { Spinner } from './ui/ui'

export const CATEGORY_ICON: Record<CategoryId | 'sin', typeof PackageCheck> = {
  entrega: PackageCheck,
  avance: TrendingUp,
  aprendizaje: Sprout,
  logro: Trophy,
  feedback: MessageSquareQuote,
  bloqueo: Construction,
  sin: CircleDashed,
}

export function CategoryIcon({ id, className, colored = true }: { id: CategoryId | 'sin'; className?: string; colored?: boolean }) {
  const Icon = CATEGORY_ICON[id]
  const color = id === 'sin' ? 'var(--cat-sin)' : CATEGORY_BY_ID[id].color
  return <Icon aria-hidden className={cn('size-4 shrink-0', className)} style={colored ? { color } : undefined} strokeWidth={2.2} />
}

/** Marcas de categoría: icono + etiqueta (nunca solo color). */
export function CategoryTags({ ids, compact }: { ids: CategoryId[]; compact?: boolean }) {
  if (!ids.length) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {ids.map((id) => (
        <span key={id} className="inline-flex items-center gap-1 text-xs font-medium text-ink-2">
          <CategoryIcon id={id} className="size-3.5" />
          {!compact && CATEGORY_BY_ID[id].label}
          {compact && <span className="sr-only">{CATEGORY_BY_ID[id].label}</span>}
        </span>
      ))}
    </span>
  )
}

export function projectAndBrand(e: Pick<Entry, 'projectId' | 'brandId'>, projects: Project[], brands: Brand[]) {
  const project = e.projectId ? projects.find((p) => p.id === e.projectId) : undefined
  const brandId = e.brandId ?? (project && !project.brandUnconfirmed ? project.brandId : undefined)
  const brand = brandId ? brands.find((b) => b.id === brandId) : undefined
  return { project, brand }
}

/**
 * Imagen de un adjunto. Usa la copia local si existe; si no, la descarga del
 * almacenamiento privado con tu sesión (sin enlaces públicos) y la guarda en caché.
 */
export function useAttachmentUrl(att: Pick<Attachment, 'id'> | undefined) {
  const { db, engine } = useWorkspace()
  // undefined = consultando; null = no está en este dispositivo
  const row = useLiveQuery(async () => (att ? ((await db.blobs.get(att.id)) ?? null) : null), [db, att?.id])
  const [state, setState] = useState<{ url?: string; error?: string; loading: boolean }>({ loading: true })
  const attId = att?.id
  useEffect(() => {
    if (!attId || row === undefined) return
    if (row?.blob) {
      const url = URL.createObjectURL(row.blob)
      setState({ url, loading: false })
      return () => URL.revokeObjectURL(url)
    }
    if (!engine) {
      setState({ loading: false, error: 'No disponible' })
      return
    }
    if (!navigator.onLine) {
      setState({ loading: false, error: 'Disponible al conectarte' })
      return
    }
    let cancelled = false
    setState({ loading: true })
    engine.fetchBlob(attId).catch((e: Error) => {
      if (!cancelled) setState({ loading: false, error: /not.?found|404|400/i.test(e.message) ? 'Aún se está subiendo' : 'No se pudo cargar' })
    })
    return () => {
      cancelled = true
    }
  }, [attId, row, engine])
  return state
}

export function AttachmentThumb({ att, onOpen, className }: { att: Attachment; onOpen?: () => void; className?: string }) {
  const { url, error, loading } = useAttachmentUrl(att)
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!url}
      className={cn('relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2', className)}
      aria-label={`Ver captura ${att.name}`}
    >
      {url ? (
        <img src={url} alt="" className="size-full object-cover" draggable={false} />
      ) : loading ? (
        <Spinner className="text-ink-3" />
      ) : (
        <span className="flex flex-col items-center gap-1 px-1 text-center text-[10px] leading-tight text-ink-3">
          <ImageOff className="size-4" aria-hidden />
          {error}
        </span>
      )}
    </button>
  )
}

export function FullImage({ att }: { att: Attachment }) {
  const { url, error } = useAttachmentUrl(att)
  if (!url) return <p className="text-sm text-ink-3">{error ?? 'Cargando…'}</p>
  return <img src={url} alt={att.name} className="mx-auto max-h-[70dvh] w-auto rounded-xl" />
}

import { LIMITS } from './constants'

export interface CompressedImage {
  blob: Blob
  mime: string
  width: number
  height: number
  name: string
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
    } catch {
      /* se intenta con <img> */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('No se pudo leer la imagen. Prueba con PNG, JPG o WebP.')
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob((b) => res(b), type, q))
}

/** Reduce capturas y fotos a ≤1600 px y ≤1.5 MB (WebP o JPEG). */
export async function compressImage(file: File): Promise<CompressedImage> {
  if (!file.type.startsWith('image/')) throw new Error('Solo se aceptan imágenes (capturas o fotos).')
  if (file.size > LIMITS.maxInputBytes) throw new Error('La imagen supera 25 MB.')
  const img = await decode(file)
  try {
    let scale = Math.min(1, LIMITS.maxImageSide / Math.max(img.width, img.height))
    const base = file.name.replace(/\.[^.]+$/, '') || 'captura'
    for (let attempt = 0; attempt < 5; attempt++) {
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Este navegador no puede procesar imágenes.')
      ctx.drawImage(img.source, 0, 0, w, h)
      const q = attempt < 2 ? 0.82 - attempt * 0.12 : 0.7
      let blob = await toBlob(canvas, 'image/webp', q)
      if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', q)
      if (!blob) throw new Error('No se pudo comprimir la imagen.')
      if (blob.size <= LIMITS.maxStoredBytes) {
        const keepOriginal =
          scale === 1 && file.size <= blob.size && file.size <= LIMITS.maxStoredBytes && ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
        const out = keepOriginal ? file : blob
        const ext = out.type === 'image/webp' ? 'webp' : out.type === 'image/png' ? 'png' : 'jpg'
        return { blob: out, mime: out.type, width: w, height: h, name: `${base}.${ext}` }
      }
      if (attempt >= 1) scale *= 0.75
    }
    throw new Error('La imagen sigue siendo demasiado grande después de comprimirla.')
  } finally {
    img.close()
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

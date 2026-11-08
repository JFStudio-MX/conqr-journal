import { useEffect, useState } from 'react'

export type RouteName = 'hoy' | 'diario' | 'progreso' | 'revision' | 'ajustes'
const ROUTES: RouteName[] = ['hoy', 'diario', 'progreso', 'revision', 'ajustes']

export interface Route {
  name: RouteName
  params: URLSearchParams
}

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '')
  const [path, query = ''] = h.split('?')
  const name = (ROUTES.includes(path as RouteName) ? path : 'hoy') as RouteName
  return { name, params: new URLSearchParams(query) }
}

export function navigate(name: RouteName, params?: Record<string, string | undefined>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) if (v) q.set(k, v)
  const qs = q.toString()
  const next = `#/${name}${qs ? `?${qs}` : ''}`
  if (location.hash !== next) location.hash = next
}

export function useRoute(): Route {
  const [r, setR] = useState(() => parseHash(location.hash))
  useEffect(() => {
    const on = () => {
      setR(parseHash(location.hash))
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return r
}

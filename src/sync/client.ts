import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const SUPABASE_URL = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '').replace(/\/$/, '')
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? ''
export const backendConfigured = !!(SUPABASE_URL && SUPABASE_KEY)
export const BUCKET = 'attachments'
export const AUTH_STORAGE_KEY = 'conqr-auth'

let client: SupabaseClient | null = null

/** Cliente con la clave PUBLICABLE (segura en el navegador; la protección es RLS). */
export function supabase(): SupabaseClient {
  if (!backendConfigured) throw new Error('Supabase no está configurado en este despliegue.')
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY },
    })
  }
  return client
}

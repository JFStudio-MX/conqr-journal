/**
 * Motor de sincronización local-first.
 *
 * - La caché local (IndexedDB) es la fuente para la interfaz; la cola persistente
 *   son los registros con _dirty = 1 (sobreviven a cerrar la app).
 * - Ciclo: traer cambios del servidor → subir capturas → enviar cambios locales.
 * - Cada cambio viaja con base_version y mutation_id: el servidor solo lo aplica si
 *   la versión coincide (si no, hay conflicto) y reconoce reintentos (idempotente).
 * - Los borrados son lápidas: un registro borrado no reaparece al reconectar.
 * - Se sincroniza al guardar, al volver a la app, al recuperar internet y cada 30 s
 *   con la app visible. No hay sincronización en segundo plano.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { uid, nowISO } from '../lib/cn'
import { sameContent, stripMeta } from '../lib/backup'
import type { JournalDB } from '../db/database'
import { COLLECTIONS, type CollectionName, type ConflictRow, type Entry, type Stored, type SyncMeta } from '../db/types'
import { BUCKET } from './client'

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error'
export interface SyncState {
  phase: SyncPhase
  pending: number
  conflicts: number
  lastSyncedAt?: string
  lastError?: string
}

export interface RemoteRow {
  collection: CollectionName
  id: string
  version: number
  data: Record<string, unknown>
  deleted: boolean
  mutation_id: string
  client_updated_at?: string | null
  server_created_at: string
  server_updated_at: string
  server_seq: number
}

interface PushResult {
  collection: CollectionName
  id: string
  status: 'applied' | 'conflict'
  row: RemoteRow
}

type AnyStored = Stored<{ id: string; updatedAt?: string; path?: string }>

const BATCH = 50
const PAGE = 500
const SEQ_KEY = 'sync:lastSeq'
const COLS_SELECT = 'collection,id,version,data,deleted,mutation_id,client_updated_at,server_created_at,server_updated_at,server_seq'

export function describeError(err: unknown): string {
  const e = err as { message?: string; error_description?: string; code?: string; status?: number }
  if (!navigator.onLine) return 'Sin conexión.'
  const msg = e?.message || e?.error_description || String(err)
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(msg)) return 'No se pudo contactar al servidor.'
  if (/JWT|token|401|not authenticated|No autenticado/i.test(msg)) return 'La sesión expiró. Vuelve a entrar.'
  return msg.slice(0, 200)
}

export function isAuthError(err: unknown): boolean {
  const e = err as { message?: string; code?: string; status?: number }
  return e?.status === 401 || e?.code === 'PGRST301' || e?.code === 'PGRST303' || /JWT expired|invalid JWT|No autenticado/i.test(e?.message ?? '')
}

export class SyncEngine {
  private state: SyncState = { phase: 'idle', pending: 0, conflicts: 0 }
  private listeners = new Set<() => void>()
  private running = false
  private again = false
  private stopped = true
  private timer: number | undefined
  private interval: number | undefined
  private backoff = 0

  constructor(
    private db: JournalDB,
    private client: SupabaseClient,
    private onAuthError: () => void,
  ) {}

  // --- estado observable (useSyncExternalStore) ---
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getState = () => this.state
  private set(p: Partial<SyncState>) {
    this.state = { ...this.state, ...p }
    for (const l of this.listeners) l()
  }

  private onOnline = () => this.schedule(0)
  private onOffline = () => this.set({ phase: 'offline' })
  private onVisible = () => {
    if (document.visibilityState === 'visible') this.schedule(0)
  }

  start() {
    if (!this.stopped) return
    this.stopped = false
    window.addEventListener('online', this.onOnline)
    window.addEventListener('offline', this.onOffline)
    window.addEventListener('focus', this.onVisible)
    document.addEventListener('visibilitychange', this.onVisible)
    this.interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') this.schedule(0)
    }, 30_000)
    void this.refreshCounts()
    this.schedule(0)
  }

  stop() {
    this.stopped = true
    window.removeEventListener('online', this.onOnline)
    window.removeEventListener('offline', this.onOffline)
    window.removeEventListener('focus', this.onVisible)
    document.removeEventListener('visibilitychange', this.onVisible)
    window.clearInterval(this.interval)
    window.clearTimeout(this.timer)
  }

  schedule(delay = 400) {
    if (this.stopped) return
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.run(), delay)
  }

  /** Ejecuta un ciclo completo y espera a que termine. */
  async syncNow(): Promise<SyncState> {
    window.clearTimeout(this.timer)
    await this.run()
    while (this.running) await new Promise((r) => setTimeout(r, 50))
    return this.state
  }

  async refreshCounts() {
    let pending = 0
    for (const c of COLLECTIONS) {
      pending += await this.db.coll(c).where('_dirty').equals(1).filter((r) => !r._conflict).count()
    }
    const conflicts = await this.db.conflicts.count()
    this.set({ pending, conflicts })
    return { pending, conflicts }
  }

  private async run() {
    if (this.stopped) return
    if (this.running) {
      this.again = true
      return
    }
    if (!navigator.onLine) {
      this.set({ phase: 'offline' })
      await this.refreshCounts()
      return
    }
    this.running = true
    this.set({ phase: 'syncing' })
    try {
      await this.pull()
      await this.uploadFiles()
      await this.push()
      this.backoff = 0
      await this.refreshCounts()
      this.set({ phase: 'idle', lastSyncedAt: nowISO(), lastError: undefined })
    } catch (err) {
      await this.refreshCounts().catch(() => {})
      if (isAuthError(err)) this.onAuthError()
      this.set({ phase: navigator.onLine ? 'error' : 'offline', lastError: describeError(err) })
      this.backoff = Math.min(this.backoff ? this.backoff * 2 : 3000, 60_000)
      this.schedule(this.backoff)
    } finally {
      this.running = false
      if (this.again && !this.stopped) {
        this.again = false
        this.schedule(150)
      }
    }
  }

  // ------------------------------------------------------------------ pull
  private async pull() {
    const since = Number((await this.db.local.get(SEQ_KEY))?.value ?? 0)
    // Pequeño solape: cubre confirmaciones concurrentes fuera de orden. Aplicar dos veces es inocuo.
    let from = Math.max(0, since - 100)
    let maxSeq = since
    for (let page = 0; page < 200; page++) {
      const { data, error } = await this.client.from('records').select(COLS_SELECT).gt('server_seq', from).order('server_seq', { ascending: true }).limit(PAGE)
      if (error) throw error
      const rows = (data ?? []) as RemoteRow[]
      if (!rows.length) break
      await this.applyRemote(rows)
      from = Number(rows[rows.length - 1].server_seq)
      maxSeq = Math.max(maxSeq, from)
      if (rows.length < PAGE) break
    }
    await this.db.local.put({ key: SEQ_KEY, value: maxSeq })
  }

  private clean(row: RemoteRow): AnyStored {
    return {
      ...(row.data as object),
      id: row.id,
      _v: row.version,
      _dirty: 0,
      _deleted: 0,
      _conflict: 0,
      _mid: undefined,
      _srvCreated: row.server_created_at,
      _srvUpdated: row.server_updated_at,
    } as AnyStored
  }

  private async applyRemote(rows: RemoteRow[]) {
    const { db } = this
    await db.transaction('rw', [...COLLECTIONS.map((c) => db.coll(c)), db.conflicts, db.blobs], async () => {
      for (const row of rows) {
        if (!COLLECTIONS.includes(row.collection)) continue
        const t = db.coll(row.collection)
        const local = (await t.get(row.id)) as AnyStored | undefined
        if (local && local._v >= row.version) continue
        if (!local || !local._dirty) {
          if (row.deleted) {
            if (local) await t.delete(row.id)
            if (row.collection === 'attachments') await db.blobs.delete(row.id)
            await db.conflicts.delete(`${row.collection}:${row.id}`)
          } else {
            await t.put(this.clean(row) as never)
          }
          continue
        }
        // Hay cambios locales pendientes y el servidor tiene una versión más nueva.
        if (local._mid && local._mid === row.mutation_id) {
          // Era nuestro propio cambio (respuesta perdida): ya está aplicado.
          if (local._deleted) await t.delete(row.id)
          else await t.put({ ...local, _v: row.version, _dirty: 0, _srvCreated: row.server_created_at, _srvUpdated: row.server_updated_at } as never)
          continue
        }
        await this.resolveOrRecord(row.collection, local, row)
      }
    })
  }

  /** Igualdad ⇒ se adopta en silencio. Adjuntos: gana el borrado. Si no, conflicto visible. */
  private async resolveOrRecord(c: CollectionName, local: AnyStored, row: RemoteRow) {
    const t = this.db.coll(c)
    const localDeleted = !!local._deleted
    if (localDeleted === row.deleted && (row.deleted || sameContent(local, row.data))) {
      if (localDeleted) await t.delete(row.id)
      else await t.put({ ...local, _v: row.version, _dirty: 0, _mid: undefined, _srvCreated: row.server_created_at, _srvUpdated: row.server_updated_at } as never)
      return
    }
    if (c === 'attachments') {
      if (row.deleted) {
        await t.delete(row.id)
        await this.db.blobs.delete(row.id)
      } else {
        await t.put({ ...local, _v: row.version, _dirty: 1, _mid: uid() } as never)
      }
      return
    }
    const conflict: ConflictRow = {
      key: `${c}:${row.id}`,
      collection: c,
      id: row.id,
      local: localDeleted ? null : (stripMeta(local) as unknown as Record<string, unknown>),
      localDeleted,
      remote: row.deleted ? null : row.data,
      remoteDeleted: row.deleted,
      remoteVersion: row.version,
      remoteUpdatedAt: row.server_updated_at,
      remoteCreatedAt: row.server_created_at,
      detectedAt: nowISO(),
    }
    await this.db.conflicts.put(conflict)
    await t.put({ ...local, _conflict: 1 } as never)
  }

  // ------------------------------------------------------------------ archivos
  private async uploadFiles() {
    const pending = await this.db.blobs.where('uploaded').equals(0).toArray()
    for (const b of pending) {
      const att = await this.db.attachments.get(b.id)
      if (!att || att._deleted || !att.path) continue
      const { error } = await this.client.storage.from(BUCKET).upload(att.path, b.blob, { upsert: true, contentType: att.mime, cacheControl: '0' })
      if (error) throw error
      await this.db.blobs.update(b.id, { uploaded: 1 })
    }
  }

  /** Descarga privada (con tu sesión) de una captura que no está en este dispositivo. */
  async fetchBlob(attId: string): Promise<Blob | null> {
    const att = await this.db.attachments.get(attId)
    if (!att?.path) return null
    const { data, error } = await this.client.storage.from(BUCKET).download(att.path)
    if (error) throw error
    if (data) await this.db.blobs.put({ id: attId, blob: data, uploaded: 1, cachedAt: nowISO() })
    return data
  }

  // ------------------------------------------------------------------ push
  private async collectBatch(): Promise<{ c: CollectionName; rec: AnyStored }[]> {
    const batch: { c: CollectionName; rec: AnyStored }[] = []
    for (const c of COLLECTIONS) {
      const dirty = (await this.db.coll(c).where('_dirty').equals(1).toArray()) as AnyStored[]
      for (const r of dirty) {
        if (r._conflict) continue
        if (c === 'attachments' && !r._deleted) {
          const b = await this.db.blobs.get(r.id)
          if (b && !b.uploaded) continue // primero el archivo, luego sus metadatos
        }
        batch.push({ c, rec: r })
        if (batch.length >= BATCH) return batch
      }
    }
    return batch
  }

  private async push() {
    for (let round = 0; round < 40; round++) {
      const batch = await this.collectBatch()
      if (!batch.length) return
      const delPaths = batch.filter((b) => b.c === 'attachments' && b.rec._deleted && b.rec.path).map((b) => b.rec.path as string)
      if (delPaths.length) {
        const { error } = await this.client.storage.from(BUCKET).remove(delPaths)
        if (error) throw error
      }
      const changes = batch.map(({ c, rec }) => ({
        collection: c,
        id: rec.id,
        base_version: rec._v,
        mutation_id: rec._mid ?? uid(),
        deleted: !!rec._deleted,
        // Una lápida no conserva el contenido en el servidor.
        data: rec._deleted ? {} : stripMeta(rec),
        client_updated_at: rec.updatedAt ?? nowISO(),
      }))
      const { data, error } = await this.client.rpc('push_changes', { changes })
      if (error) throw error
      await this.applyPushResults(batch, (data ?? []) as PushResult[])
      if (batch.length < BATCH) return
    }
  }

  private async applyPushResults(batch: { c: CollectionName; rec: AnyStored }[], results: PushResult[]) {
    const { db } = this
    await db.transaction('rw', [...COLLECTIONS.map((c) => db.coll(c)), db.conflicts, db.blobs], async () => {
      for (const res of results) {
        const sent = batch.find((b) => b.c === res.collection && b.rec.id === res.id)?.rec
        const t = db.coll(res.collection)
        const local = (await t.get(res.id)) as AnyStored | undefined
        if (!sent || !local) continue
        const row = res.row
        if (res.status === 'applied') {
          if (local._mid === sent._mid) {
            if (local._deleted) await t.delete(res.id)
            else await t.put({ ...local, _v: row.version, _dirty: 0, _srvCreated: row.server_created_at, _srvUpdated: row.server_updated_at } as never)
          } else {
            // Lo editaste mientras se enviaba: queda pendiente sobre la nueva versión.
            await t.put({ ...local, _v: row.version, _srvCreated: row.server_created_at, _srvUpdated: row.server_updated_at } as never)
          }
        } else {
          await this.resolveOrRecord(res.collection, local, row)
        }
      }
    })
  }

  // ------------------------------------------------------------------ conflictos
  /** Conserva la versión de este dispositivo (se sube sobre la del servidor). */
  async keepLocal(conf: ConflictRow) {
    const t = this.db.coll(conf.collection)
    await this.db.transaction('rw', t, this.db.conflicts, async () => {
      const local = (await t.get(conf.id)) as AnyStored | undefined
      const base = local ?? ({ ...(conf.local ?? { id: conf.id }), _deleted: conf.localDeleted ? 1 : 0 } as AnyStored)
      await t.put({ ...base, _v: conf.remoteVersion, _dirty: 1, _mid: uid(), _conflict: 0 } as never)
      await this.db.conflicts.delete(conf.key)
    })
    await this.refreshCounts()
    this.schedule(0)
  }

  /** Acepta la versión del otro dispositivo (o su borrado). */
  async keepRemote(conf: ConflictRow) {
    const t = this.db.coll(conf.collection)
    await this.db.transaction('rw', t, this.db.conflicts, async () => {
      if (conf.remoteDeleted || !conf.remote) await t.delete(conf.id)
      else
        await t.put({
          ...conf.remote,
          id: conf.id,
          _v: conf.remoteVersion,
          _dirty: 0,
          _deleted: 0,
          _conflict: 0,
          _srvCreated: conf.remoteCreatedAt,
          _srvUpdated: conf.remoteUpdatedAt,
        } as never)
      await this.db.conflicts.delete(conf.key)
    })
    await this.refreshCounts()
    this.schedule(0)
  }

  /** Solo registros del diario: conserva ambas (la del otro dispositivo + una copia nueva con la mía). */
  async keepBoth(conf: ConflictRow) {
    if (conf.collection !== 'entries' || !conf.local || !conf.remote) return this.keepLocal(conf)
    const local = ((await this.db.entries.get(conf.id)) ?? conf.local) as Stored<Entry>
    const now = nowISO()
    const copy: Stored<Entry> = {
      ...(stripMeta(local) as Entry),
      id: uid(),
      attachmentIds: [],
      createdAt: now,
      updatedAt: now,
      _v: 0,
      _dirty: 1,
      _mid: uid(),
      _deleted: 0,
      _conflict: 0,
    } as Stored<Entry> & SyncMeta
    await this.keepRemote(conf)
    await this.db.entries.put(copy)
    await this.refreshCounts()
    this.schedule(0)
  }
}

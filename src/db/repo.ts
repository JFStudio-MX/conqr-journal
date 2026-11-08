/**
 * Escrituras locales. Toda escritura:
 *  1. ocurre dentro de una transacción de IndexedDB (todo o nada);
 *  2. marca el registro como pendiente (_dirty = 1) con un id de mutación nuevo,
 *     que la sincronización usa para ser idempotente;
 *  3. avisa al motor de sincronización.
 * Los borrados en modo cuenta son "lápidas" (_deleted = 1) para que se propaguen
 * y el registro no reaparezca desde otro dispositivo.
 */
import { uid, nowISO } from '../lib/cn'
import { sameContent, stripMeta, type BackupData } from '../lib/backup'
import type { Proposal } from '../lib/meetings'
import type {
  ActionItem,
  ChangeRequest,
  Meeting,
  MeetingItem,
  Transcript,
  Attachment,
  Attendance,
  AnySettings,
  BlobRow,
  CollectionMap,
  CollectionName,
  Entry,
  QuickDraft,
  Stored,
  SyncMeta,
} from './types'
import { COLLECTIONS } from './types'
import type { JournalDB, WorkspaceMode } from './database'

export interface DraftFile {
  id: string
  blob: Blob
  name: string
  mime: string
  width?: number
  height?: number
}

export interface EntrySnapshot {
  entry: Stored<Entry>
  attachments: Stored<Attachment>[]
  blobs: BlobRow[]
}

export interface ImportCounts {
  added: number
  updated: number
  unchanged: number
  keptLocal: number
  removed: number
}

const EXT: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' }

export class Repo {
  constructor(
    readonly db: JournalDB,
    readonly mode: WorkspaceMode,
    readonly userId: string | undefined,
    private changed: () => void = () => {},
  ) {}

  setOnChange(fn: () => void) {
    this.changed = fn
  }

  private stamp<T extends object>(rec: T, prev?: Partial<SyncMeta>): Stored<T> {
    const clean = stripMeta(rec) as T
    return {
      ...clean,
      _v: prev?._v ?? 0,
      _dirty: 1,
      _mid: uid(),
      _deleted: 0,
      _conflict: prev?._conflict ?? 0,
      _srvCreated: prev?._srvCreated,
      _srvUpdated: prev?._srvUpdated,
    }
  }

  attachmentPath(id: string, mime: string): string | undefined {
    if (this.mode !== 'account' || !this.userId) return undefined
    return `${this.userId}/${id}.${EXT[mime] ?? 'bin'}`
  }

  // ---------- genérico ----------
  async get<C extends CollectionName>(c: C, id: string): Promise<Stored<CollectionMap[C]> | undefined> {
    const r = await this.db.coll(c).get(id)
    return r && !r._deleted ? r : undefined
  }

  async put<C extends CollectionName>(c: C, rec: CollectionMap[C], touch = true): Promise<void> {
    await this.db.transaction('rw', this.db.coll(c), async () => {
      const prev = await this.db.coll(c).get(rec.id)
      const next = touch ? { ...rec, updatedAt: nowISO() } : rec
      await this.db.coll(c).put(this.stamp(next, prev) as Stored<CollectionMap[C]>)
    })
    this.changed()
  }

  /** Inserta solo si no existe (protege contra dobles envíos). */
  async addOnce<C extends CollectionName>(c: C, rec: CollectionMap[C]): Promise<'saved' | 'exists'> {
    const res = await this.db.transaction('rw', this.db.coll(c), async () => {
      const prev = await this.db.coll(c).get(rec.id)
      if (prev && !prev._deleted) return 'exists' as const
      await this.db.coll(c).put(this.stamp(rec, prev) as Stored<CollectionMap[C]>)
      return 'saved' as const
    })
    if (res === 'saved') this.changed()
    return res
  }

  private async tombstone<C extends CollectionName>(c: C, id: string) {
    const t = this.db.coll(c)
    const prev = await t.get(id)
    if (!prev) return undefined
    if (this.mode !== 'account' || !prev._v) {
      await t.delete(id)
    } else {
      await t.put({ ...prev, _deleted: 1, _dirty: 1, _mid: uid() })
    }
    return prev
  }

  async remove<C extends CollectionName>(c: C, id: string): Promise<Stored<CollectionMap[C]> | undefined> {
    const prev = await this.db.transaction('rw', this.db.coll(c), () => this.tombstone(c, id))
    this.changed()
    return prev
  }

  /** Deshace un borrado reciente. */
  async restore<C extends CollectionName>(c: C, prev: Stored<CollectionMap[C]>) {
    await this.db.transaction('rw', this.db.coll(c), async () => {
      const cur = await this.db.coll(c).get(prev.id)
      await this.db.coll(c).put(this.stamp(stripMeta(prev), cur ?? prev) as Stored<CollectionMap[C]>)
    })
    this.changed()
  }

  /** Agrega varios registros solo si no existen (datos iniciales), en una transacción. */
  async addMissing(items: { c: CollectionName; rec: CollectionMap[CollectionName] }[], blobs: BlobRow[] = []): Promise<number> {
    const { db } = this
    const tables = [...new Set(items.map((i) => i.c))].map((c) => db.coll(c))
    let n = 0
    await db.transaction('rw', [...tables, db.blobs], async () => {
      for (const { c, rec } of items) {
        const prev = await db.coll(c).get(rec.id)
        if (prev) continue
        await db.coll(c).put(this.stamp(rec) as never)
        n++
      }
      for (const b of blobs) await db.blobs.put(b)
    })
    if (n) this.changed()
    return n
  }

  // ---------- entradas ----------
  private makeAttachments(entryId: string, files: DraftFile[], now: string) {
    const atts: Attachment[] = []
    const blobs: BlobRow[] = []
    for (const f of files) {
      atts.push({
        id: f.id,
        entryId,
        name: f.name,
        mime: f.mime,
        size: f.blob.size,
        width: f.width,
        height: f.height,
        path: this.attachmentPath(f.id, f.mime),
        createdAt: now,
        updatedAt: now,
      })
      blobs.push({ id: f.id, blob: f.blob, uploaded: 0, cachedAt: now })
    }
    return { atts, blobs }
  }

  /**
   * Guarda un registro nuevo con sus capturas en UNA transacción.
   * El id viene del borrador: un segundo envío del mismo borrador no duplica.
   */
  async saveNewEntry(entry: Entry, files: DraftFile[]): Promise<'saved' | 'duplicate'> {
    const { db } = this
    const res = await db.transaction('rw', db.entries, db.attachments, db.blobs, async () => {
      const prev = await db.entries.get(entry.id)
      if (prev && !prev._deleted) return 'duplicate' as const
      const { atts, blobs } = this.makeAttachments(entry.id, files, entry.createdAt)
      for (const a of atts) await db.attachments.put(this.stamp(a))
      for (const b of blobs) await db.blobs.put(b)
      await db.entries.put(this.stamp({ ...entry, attachmentIds: atts.map((a) => a.id) }, prev))
      return 'saved' as const
    })
    if (res === 'saved') this.changed()
    return res
  }

  async updateEntry(entry: Entry, newFiles: DraftFile[] = [], removedAttachmentIds: string[] = []): Promise<void> {
    const { db } = this
    await db.transaction('rw', db.entries, db.attachments, db.blobs, async () => {
      const prev = await db.entries.get(entry.id)
      const now = nowISO()
      for (const id of removedAttachmentIds) {
        await this.tombstone('attachments', id)
        await db.blobs.delete(id)
      }
      const { atts, blobs } = this.makeAttachments(entry.id, newFiles, now)
      for (const a of atts) await db.attachments.put(this.stamp(a))
      for (const b of blobs) await db.blobs.put(b)
      const ids = [...entry.attachmentIds.filter((id) => !removedAttachmentIds.includes(id)), ...atts.map((a) => a.id)]
      await db.entries.put(this.stamp({ ...entry, attachmentIds: ids, updatedAt: now }, prev))
    })
    this.changed()
  }

  async patchEntry(id: string, patch: Partial<Entry>): Promise<void> {
    const { db } = this
    await db.transaction('rw', db.entries, async () => {
      const prev = await db.entries.get(id)
      if (!prev || prev._deleted) throw new Error('El registro ya no existe.')
      await db.entries.put(this.stamp({ ...stripMeta(prev), ...patch, updatedAt: nowISO() }, prev))
    })
    this.changed()
  }

  async deleteEntry(id: string): Promise<EntrySnapshot | undefined> {
    const { db } = this
    const snap = await db.transaction('rw', db.entries, db.attachments, db.blobs, async () => {
      const entry = await db.entries.get(id)
      if (!entry) return undefined
      const attachments = (await db.attachments.where('entryId').equals(id).toArray()).filter((a) => !a._deleted)
      const blobs = (await db.blobs.bulkGet(attachments.map((a) => a.id))).filter(Boolean) as BlobRow[]
      for (const a of attachments) {
        await this.tombstone('attachments', a.id)
        await db.blobs.delete(a.id)
      }
      await this.tombstone('entries', id)
      return { entry, attachments, blobs }
    })
    this.changed()
    return snap
  }

  async restoreEntry(snap: EntrySnapshot): Promise<void> {
    const { db } = this
    await db.transaction('rw', db.entries, db.attachments, db.blobs, async () => {
      for (const a of snap.attachments) {
        const cur = await db.attachments.get(a.id)
        await db.attachments.put(this.stamp(stripMeta(a), cur ?? a))
      }
      for (const b of snap.blobs) await db.blobs.put(b)
      const cur = await db.entries.get(snap.entry.id)
      await db.entries.put(this.stamp(stripMeta(snap.entry), cur ?? snap.entry))
    })
    this.changed()
  }

  // ---------- juntas y cambios ----------
  /** Guarda (crea o actualiza) un cambio con su captura de referencia. */
  async saveChange(change: ChangeRequest, newFiles: DraftFile[] = [], removedAttachmentIds: string[] = []): Promise<void> {
    const { db } = this
    await db.transaction('rw', db.changes, db.attachments, db.blobs, async () => {
      const prev = await db.changes.get(change.id)
      const now = nowISO()
      for (const id of removedAttachmentIds) {
        await this.tombstone('attachments', id)
        await db.blobs.delete(id)
      }
      const { atts, blobs } = this.makeAttachments(change.id, newFiles, now)
      for (const a of atts) await db.attachments.put(this.stamp(a))
      for (const b of blobs) await db.blobs.put(b)
      const ids = [...change.attachmentIds.filter((id) => !removedAttachmentIds.includes(id)), ...atts.map((a) => a.id)]
      await db.changes.put(this.stamp({ ...change, attachmentIds: ids, updatedAt: now }, prev))
    })
    this.changed()
  }

  async deleteChange(id: string): Promise<void> {
    const { db } = this
    await db.transaction('rw', db.changes, db.attachments, db.blobs, async () => {
      const atts = (await db.attachments.where('entryId').equals(id).toArray()).filter((a) => !a._deleted)
      for (const a of atts) {
        await this.tombstone('attachments', a.id)
        await db.blobs.delete(a.id)
      }
      await this.tombstone('changes', id)
    })
    this.changed()
  }

  /** Guarda el texto original; si ya se importó el mismo contenido en esta junta, no lo duplica. */
  async addTranscript(t: Transcript): Promise<'saved' | 'duplicate'> {
    const { db } = this
    const res = await db.transaction('rw', db.transcripts, async () => {
      const same = (await db.transcripts.where('meetingId').equals(t.meetingId).toArray()).find((x) => !x._deleted && x.hash === t.hash)
      if (same) return 'duplicate' as const
      await db.transcripts.put(this.stamp(t))
      return 'saved' as const
    })
    if (res === 'saved') this.changed()
    return res
  }

  /**
   * Agrega propuestas "por revisar" a la junta. Usa la clave estable de cada propuesta:
   * importar dos veces el mismo resumen no duplica decisiones, acciones ni cambios.
   */
  async applyProposals(meetingId: string, proposals: Proposal[]): Promise<{ added: number; skipped: number }> {
    const { db } = this
    let added = 0
    let skipped = 0
    await db.transaction('rw', db.meetings, db.actions, db.changes, async () => {
      const prev = await db.meetings.get(meetingId)
      if (!prev || prev._deleted) throw new Error('La junta no existe.')
      const m = stripMeta(prev) as Meeting
      const now = nowISO()
      const keys = new Set<string>()
      for (const list of [m.decisions, m.ideas, m.questions, m.materials]) for (const i of list) if (i.key) keys.add(i.key)
      for (const a of await db.actions.where('meetingId').equals(meetingId).toArray()) if (a.key) keys.add(a.key)
      for (const c of await db.changes.where('meetingId').equals(meetingId).toArray()) if (c.key) keys.add(c.key)
      const listFor = { decision: m.decisions, idea: m.ideas, question: m.questions, material: m.materials } as const
      for (const p of proposals) {
        if (keys.has(p.key)) {
          skipped++
          continue
        }
        keys.add(p.key)
        added++
        const source = p.timestamp ? `[${p.timestamp}] ${p.source}` : p.source
        if (p.kind === 'objective') {
          if (m.objective?.trim()) {
            added--
            skipped++
            continue
          }
          m.objective = p.text
          m.objectiveReview = 'por_revisar'
        } else if (p.kind === 'action') {
          const a: ActionItem = { id: uid(), meetingId, projectId: m.projectId, text: p.text, owner: p.owner, dueDate: p.dueDate, status: 'por_revisar', source, key: p.key, createdAt: now, updatedAt: now }
          await db.actions.put(this.stamp(a))
        } else if (p.kind === 'change') {
          const c: ChangeRequest = {
            id: uid(),
            meetingId,
            projectId: m.projectId,
            request: p.text,
            assignee: p.owner,
            source: { fragment: p.source, timestamp: p.timestamp },
            status: 'por_aclarar',
            review: 'por_revisar',
            attachmentIds: [],
            key: p.key,
            createdAt: now,
            updatedAt: now,
          }
          await db.changes.put(this.stamp(c))
        } else {
          listFor[p.kind].push({ id: uid(), text: p.text, review: 'por_revisar', source, key: p.key })
        }
      }
      await db.meetings.put(this.stamp({ ...m, updatedAt: now }, prev))
    })
    this.changed()
    return { added, skipped }
  }

  /**
   * Elimina el texto original de una junta. Conserva tus notas, lo ya revisado
   * y las propuestas que elijas; descarta el resto de propuestas sin revisar.
   */
  async deleteTranscripts(meetingId: string, keepIds: Set<string>): Promise<void> {
    const { db } = this
    await db.transaction('rw', db.meetings, db.transcripts, db.actions, db.changes, async () => {
      for (const t of await db.transcripts.where('meetingId').equals(meetingId).toArray()) if (!t._deleted) await this.tombstone('transcripts', t.id)
      const prev = await db.meetings.get(meetingId)
      if (prev && !prev._deleted) {
        const m = stripMeta(prev) as Meeting
        const keep = (i: MeetingItem) => i.review === 'revisado' || keepIds.has(i.id)
        const next: Meeting = { ...m, decisions: m.decisions.filter(keep), ideas: m.ideas.filter(keep), questions: m.questions.filter(keep), materials: m.materials.filter(keep), updatedAt: nowISO() }
        if (m.objectiveReview === 'por_revisar' && !keepIds.has('objective')) {
          next.objective = undefined
          next.objectiveReview = undefined
        }
        await db.meetings.put(this.stamp(next, prev))
      }
      for (const a of await db.actions.where('meetingId').equals(meetingId).toArray()) {
        if (!a._deleted && a.status === 'por_revisar' && !keepIds.has(a.id)) await this.tombstone('actions', a.id)
      }
      for (const c of await db.changes.where('meetingId').equals(meetingId).toArray()) {
        if (!c._deleted && c.review === 'por_revisar' && !keepIds.has(c.id)) await this.tombstone('changes', c.id)
      }
    })
    this.changed()
  }

  /** Si cambias el proyecto de una junta, sus acciones y cambios la siguen. */
  async reassignMeetingProject(meetingId: string, projectId: string | undefined): Promise<void> {
    const { db } = this
    await db.transaction('rw', db.actions, db.changes, async () => {
      const now = nowISO()
      for (const a of await db.actions.where('meetingId').equals(meetingId).toArray())
        if (!a._deleted && a.projectId !== projectId) await db.actions.put(this.stamp({ ...stripMeta(a), projectId, updatedAt: now }, a))
      for (const c of await db.changes.where('meetingId').equals(meetingId).toArray())
        if (!c._deleted && c.projectId !== projectId) await db.changes.put(this.stamp({ ...stripMeta(c), projectId, updatedAt: now }, c))
    })
    this.changed()
  }

  async deleteMeeting(id: string): Promise<void> {
    const { db } = this
    await db.transaction('rw', db.meetings, db.transcripts, async () => {
      for (const t of await db.transcripts.where('meetingId').equals(id).toArray()) if (!t._deleted) await this.tombstone('transcripts', t.id)
      await this.tombstone('meetings', id)
    })
    this.changed()
  }

  // ---------- asistencia ----------
  /** "Ya llegué": un solo registro por día (el id es la fecha). */
  async registerArrival(date: string, time: string, declaredAt: string, offline: boolean): Promise<'saved' | 'exists'> {
    const now = nowISO()
    const rec: Attendance = { id: date, kind: 'presencial', time, declaredAt, source: 'boton', offline: offline || undefined, createdAt: now, updatedAt: now }
    return this.addOnce('attendance', rec)
  }

  async setAttendance(next: Attendance): Promise<void> {
    const { db } = this
    await db.transaction('rw', db.attendance, async () => {
      const prev = await db.attendance.get(next.id)
      const live = prev && !prev._deleted ? prev : undefined
      const correctedFrom = live
        ? live.correctedFrom ?? { kind: live.kind, time: live.time, source: live.source }
        : undefined
      const rec: Attendance = {
        ...next,
        source: 'manual',
        declaredAt: live?.declaredAt,
        correctedFrom,
        createdAt: live?.createdAt ?? nowISO(),
        updatedAt: nowISO(),
      }
      await db.attendance.put(this.stamp(rec, prev))
    })
    this.changed()
  }

  // ---------- ajustes ----------
  async putSettings(rec: AnySettings) {
    return this.put('settings', rec)
  }

  // ---------- borrador local (solo este dispositivo) ----------
  async getLocal<T>(key: string): Promise<T | undefined> {
    return (await this.db.local.get(key))?.value as T | undefined
  }
  async setLocal(key: string, value: unknown) {
    await this.db.local.put({ key, value })
  }
  async delLocal(key: string) {
    await this.db.local.delete(key)
  }
  async saveDraft(d: QuickDraft & { files?: DraftFile[] }) {
    await this.setLocal('draft:quick', d)
  }

  // ---------- respaldo ----------
  async exportData(): Promise<{ data: BackupData; missingFiles: Stored<Attachment>[] }> {
    const { db } = this
    const data = { files: [] } as unknown as Record<string, unknown[]>
    for (const c of COLLECTIONS) data[c] = (await db.coll(c).toArray()).filter((r) => !r._deleted).map((r) => stripMeta(r))
    const atts = (await db.attachments.toArray()).filter((a) => !a._deleted)
    const blobs = await db.blobs.bulkGet(atts.map((a) => a.id))
    const missingFiles = atts.filter((_, i) => !blobs[i])
    return { data: data as unknown as BackupData, missingFiles }
  }

  /** Vista previa: qué haría la importación, sin escribir nada. */
  async planImport(data: BackupData, strategy: 'merge' | 'replace'): Promise<ImportCounts> {
    const counts: ImportCounts = { added: 0, updated: 0, unchanged: 0, keptLocal: 0, removed: 0 }
    for (const c of COLLECTIONS) {
      const incoming = (data as unknown as Record<string, { id: string; updatedAt: string }[]>)[c]
      const existing = new Map((await this.db.coll(c).toArray()).filter((r) => !r._deleted).map((r) => [r.id, r]))
      const inIds = new Set(incoming.map((r) => r.id))
      for (const r of incoming) {
        const cur = existing.get(r.id)
        if (!cur) counts.added++
        else if (sameContent(cur, r)) counts.unchanged++
        else if (strategy === 'replace' || r.updatedAt > (cur as { updatedAt: string }).updatedAt) counts.updated++
        else counts.keptLocal++
      }
      if (strategy === 'replace') for (const id of existing.keys()) if (!inIds.has(id)) counts.removed++
    }
    return counts
  }

  /**
   * Restaura en UNA transacción sobre todas las tablas: si algo falla, IndexedDB
   * revierte todo y tus datos actuales quedan intactos.
   */
  async importBackup(data: BackupData, strategy: 'merge' | 'replace', files: Map<string, Blob>, opts: { simulateFailure?: boolean } = {}): Promise<ImportCounts> {
    const { db } = this
    const counts: ImportCounts = { added: 0, updated: 0, unchanged: 0, keptLocal: 0, removed: 0 }
    const tables = [...COLLECTIONS.map((c) => db.coll(c)), db.blobs]
    await db.transaction('rw', tables, async () => {
      for (const c of COLLECTIONS) {
        const t = db.coll(c)
        const incoming = (data as unknown as Record<string, CollectionMap[CollectionName][]>)[c]
        const all = await t.toArray()
        const existing = new Map(all.map((r) => [r.id, r]))
        const inIds = new Set(incoming.map((r) => r.id))
        if (strategy === 'replace') {
          for (const r of all) if (!r._deleted && !inIds.has(r.id)) {
            await this.tombstone(c, r.id)
            if (c === 'attachments') await db.blobs.delete(r.id)
            counts.removed++
          }
        }
        for (const raw of incoming) {
          const rec = c === 'attachments' ? { ...(raw as Attachment), path: this.attachmentPath(raw.id, (raw as Attachment).mime) } : raw
          const cur = existing.get(rec.id)
          const live = cur && !cur._deleted ? cur : undefined
          if (live && sameContent(live, rec)) {
            counts.unchanged++
            continue
          }
          if (live && strategy === 'merge' && (rec as { updatedAt: string }).updatedAt <= (live as { updatedAt: string }).updatedAt) {
            counts.keptLocal++
            continue
          }
          await t.put(this.stamp(rec, cur) as never)
          if (live) counts.updated++
          else counts.added++
          if (c === 'attachments') {
            const blob = files.get(rec.id)
            if (blob) await db.blobs.put({ id: rec.id, blob, uploaded: 0, cachedAt: nowISO() })
          }
        }
      }
      if (opts.simulateFailure) throw new Error('Fallo simulado durante la importación (prueba).')
    })
    this.changed()
    return counts
  }
}

import { useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { PrivateSettings } from '../db/types'
import { buildBackup, bytesToBase64, type BackupFileEntry } from '../lib/backup'
import { todayISO, nowTimeHMS } from '../lib/dates'
import { nowISO } from '../lib/cn'
import { useWorkspace } from './session'

export const APP_VERSION = '0.2.0'
export const LAST_BACKUP_KEY = 'backup:lastExportAt'

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function useLastBackup(): string | null | undefined {
  const { db } = useWorkspace()
  return useLiveQuery(async () => ((await db.local.get(LAST_BACKUP_KEY))?.value as string | undefined) ?? null, [db])
}

/** Respaldo completo y versionado, con las capturas incluidas (no solo sus nombres). */
export function useExportBackup() {
  const ws = useWorkspace()
  return useCallback(async (): Promise<{ filename: string; missing: number; entries: number; files: number }> => {
    const { data, missingFiles } = await ws.repo.exportData()
    let missing = 0
    for (const a of missingFiles) {
      try {
        if (ws.engine && navigator.onLine) await ws.engine.fetchBlob(a.id)
        else missing++
      } catch {
        missing++
      }
    }
    const files: BackupFileEntry[] = []
    for (const a of data.attachments) {
      const row = await ws.db.blobs.get(a.id)
      if (row) files.push({ id: a.id, mime: a.mime, base64: bytesToBase64(new Uint8Array(await row.blob.arrayBuffer())) })
    }
    data.files = files
    const withFile = new Set(files.map((f) => f.id))
    data.attachments = data.attachments.filter((a) => withFile.has(a.id))
    const localPriv = await ws.repo.getLocal<PrivateSettings>('private')
    if (localPriv && !data.settings.some((s) => s.id === 'private')) data.settings.push(localPriv)
    const file = await buildBackup(data, ws.mode === 'account' ? 'cuenta' : ws.mode, APP_VERSION, nowISO())
    const stamp = `${todayISO()}-${nowTimeHMS().slice(0, 5).replace(':', '')}`
    const filename = `conqr-journal-${ws.mode === 'demo' ? 'DEMO-' : ''}respaldo-${stamp}.json`
    downloadBlob(new Blob([JSON.stringify(file)], { type: 'application/json' }), filename)
    if (ws.mode !== 'demo') await ws.repo.setLocal(LAST_BACKUP_KEY, nowISO())
    return { filename, missing, entries: data.entries.length, files: files.length }
  }, [ws])
}

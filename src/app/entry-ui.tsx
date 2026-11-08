import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { Entry, QuickDraft, Stored } from '../db/types'
import { storageErrorMessage } from '../db/database'
import { nowISO, uid } from '../lib/cn'
import { stripMeta } from '../lib/backup'
import { EntriesSheet, EntrySheet } from '../components/EntrySheet'
import { useToast } from '../components/ui/toast'
import { useConfirm } from '../components/ui/overlay'
import { useData } from './data'
import { useWorkspace } from './session'
import { navigate } from './router'

interface EntryUi {
  openEntry: (id: string, edit?: boolean) => void
  newEntry: (date?: string, template?: Partial<Entry>, onCreated?: (id: string) => void) => void
  openList: (title: string, ids: string[], note?: string) => void
  toggleEvidence: (e: Stored<Entry>) => Promise<void>
  confirmPending: (e: Stored<Entry>) => Promise<void>
  duplicateAsDraft: (e: Stored<Entry>) => Promise<void>
  removeEntry: (e: Stored<Entry>) => Promise<boolean>
  confirm: ReturnType<typeof useConfirm>['ask']
}

const Ctx = createContext<EntryUi | null>(null)
export function useEntryUi() {
  const v = useContext(Ctx)
  if (!v) throw new Error('EntryUiProvider ausente')
  return v
}

export const DRAFT_EVENT = 'conqr:draft-replaced'

export function EntryUiProvider({ children }: { children: ReactNode }) {
  const { repo } = useWorkspace()
  const { today } = useData()
  const toast = useToast()
  const { ask, node } = useConfirm()
  const [sheet, setSheet] = useState<{ id: string; edit: boolean; isNew?: boolean; date?: string; template?: Partial<Entry>; onCreated?: (id: string) => void } | null>(null)
  const [list, setList] = useState<{ title: string; ids: string[]; note?: string } | null>(null)

  const openEntry = useCallback((id: string, edit = false) => setSheet({ id, edit }), [])
  const newEntry = useCallback(
    (date?: string, template?: Partial<Entry>, onCreated?: (id: string) => void) => setSheet({ id: uid(), edit: true, isNew: true, date, template, onCreated }),
    [],
  )
  const openList = useCallback((title: string, ids: string[], note?: string) => setList({ title, ids, note }), [])

  const toggleEvidence = useCallback(
    async (e: Stored<Entry>) => {
      try {
        await repo.patchEntry(e.id, { evidence: e.evidence ? undefined : true })
        toast({ tone: 'ok', message: e.evidence ? 'Quitado de evidencia.' : 'Marcado como evidencia para revisión.' })
      } catch (err) {
        toast({ tone: 'error', message: storageErrorMessage(err) })
      }
    },
    [repo, toast],
  )

  const confirmPending = useCallback(
    async (e: Stored<Entry>) => {
      try {
        await repo.patchEntry(e.id, { pending: undefined, pendingNote: undefined })
        toast({ tone: 'ok', message: 'Registro confirmado. Ya cuenta en tus métricas.' })
      } catch (err) {
        toast({ tone: 'error', message: storageErrorMessage(err) })
      }
    },
    [repo, toast],
  )

  const duplicateAsDraft = useCallback(
    async (e: Stored<Entry>) => {
      const current = await repo.getLocal<QuickDraft>('draft:quick')
      if (current?.text?.trim()) {
        const ok = await ask({ title: '¿Reemplazar tu borrador actual?', body: 'En “Hoy” tienes un borrador sin guardar. La copia lo reemplazará.', confirm: 'Reemplazar', tone: 'danger' })
        if (!ok) return
      }
      const src = stripMeta(e)
      const draft: QuickDraft = {
        entryId: uid(),
        date: today,
        text: src.text,
        categories: [...src.categories],
        projectId: src.projectId,
        brandId: src.brandId,
        details: {
          outcome: src.outcome,
          status: src.status,
          contribution: src.contribution,
          collaborators: src.collaborators,
          skills: [...src.skills],
          timeSpentMin: src.timeSpentMin,
          links: [...src.links],
          nextStep: src.nextStep,
        },
        files: [],
        savedAt: nowISO(),
      }
      await repo.saveDraft(draft)
      window.dispatchEvent(new CustomEvent(DRAFT_EVENT))
      setSheet(null)
      navigate('hoy')
      toast({ tone: 'info', message: 'Copia lista como borrador en Hoy (sin capturas). Revisa la fecha y guarda.' })
    },
    [repo, today, ask, toast],
  )

  const removeEntry = useCallback(
    async (e: Stored<Entry>) => {
      try {
        const snap = await repo.deleteEntry(e.id)
        setSheet((s) => (s?.id === e.id ? null : s))
        if (!snap) return false
        toast({
          tone: 'info',
          message: 'Registro eliminado.',
          action: {
            label: 'Deshacer',
            onClick: () => {
              repo.restoreEntry(snap).then(
                () => toast({ tone: 'ok', message: 'Registro restaurado.' }),
                (err) => toast({ tone: 'error', message: storageErrorMessage(err) }),
              )
            },
          },
        })
        return true
      } catch (err) {
        toast({ tone: 'error', message: storageErrorMessage(err) })
        return false
      }
    },
    [repo, toast],
  )

  const api: EntryUi = { openEntry, newEntry, openList, toggleEvidence, confirmPending, duplicateAsDraft, removeEntry, confirm: ask }
  return (
    <Ctx.Provider value={api}>
      {children}
      <EntrySheet
        state={sheet}
        onClose={() => setSheet(null)}
        onEdit={(edit) => setSheet((s) => (s ? { ...s, edit, isNew: edit ? s.isNew : false } : s))}
        onCreated={(id) => {
          sheet?.onCreated?.(id)
          setSheet((s) => (s ? { ...s, edit: false, isNew: false, onCreated: undefined } : s))
        }}
      />
      <EntriesSheet state={list} onClose={() => setList(null)} />
      {node}
    </Ctx.Provider>
  )
}

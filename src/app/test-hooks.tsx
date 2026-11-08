import { useEffect } from 'react'
import { useWorkspace } from './session'

/**
 * Ganchos SOLO para pruebas automatizadas (build con VITE_E2E=1).
 * En el build normal esta función no hace nada y Vite elimina el código.
 */
export function TestHooks() {
  const ws = useWorkspace()
  useEffect(() => {
    if (import.meta.env.VITE_E2E !== '1') return
    const w = window as unknown as Record<string, unknown>
    w.__conqr = {
      mode: ws.mode,
      userId: ws.user?.id,
      dbName: ws.db.name,
      syncNow: () => ws.engine?.syncNow(),
      counts: () => ws.engine?.refreshCounts(),
      importWithFailure: async (data: unknown) => {
        // Importación que falla a mitad de la transacción: debe revertirse por completo.
        await ws.repo.importBackup(data as never, 'replace', new Map(), { simulateFailure: true })
      },
      entryCount: async () => (await ws.db.entries.toArray()).filter((e) => !e._deleted).length,
    }
  }, [ws])
  return null
}

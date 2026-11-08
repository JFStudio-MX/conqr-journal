import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { MeetingSheet } from '../components/meetings/MeetingSheet'
import { ProjectDetailSheet } from '../components/meetings/ProjectDetail'
import { ChangeEditorSheet, type ChangeEditorState } from '../components/meetings/parts'

interface MeetingUi {
  openMeeting: (id: string) => void
  newMeeting: (opts?: { projectId?: string; date?: string }) => void
  openProject: (id: string) => void
  editChange: (state: ChangeEditorState) => void
}

const Ctx = createContext<MeetingUi | null>(null)
export function useMeetingUi() {
  const v = useContext(Ctx)
  if (!v) throw new Error('MeetingUiProvider ausente')
  return v
}

export function MeetingUiProvider({ children }: { children: ReactNode }) {
  const [meeting, setMeeting] = useState<{ id?: string; projectId?: string; date?: string } | null>(null)
  const [project, setProject] = useState<string | null>(null)
  const [change, setChange] = useState<ChangeEditorState | null>(null)
  const openMeeting = useCallback((id: string) => setMeeting({ id }), [])
  const newMeeting = useCallback((opts?: { projectId?: string; date?: string }) => setMeeting({ ...opts }), [])
  const openProject = useCallback((id: string) => setProject(id), [])
  const editChange = useCallback((s: ChangeEditorState) => setChange(s), [])
  return (
    <Ctx.Provider value={{ openMeeting, newMeeting, openProject, editChange }}>
      {children}
      <ProjectDetailSheet projectId={project} onClose={() => setProject(null)} />
      <MeetingSheet state={meeting} onClose={() => setMeeting(null)} onCreated={(id) => setMeeting({ id })} />
      <ChangeEditorSheet state={change} onClose={() => setChange(null)} />
    </Ctx.Provider>
  )
}

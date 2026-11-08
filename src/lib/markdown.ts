import type { Entry, PrivateSettings, ProfileSettings, Project, ReviewDoc } from '../db/types'
import { REVIEW_TITLE } from './constants'
import { formatDate } from './dates'
import { uniqueSources } from './review'
import { excerpt } from './text'

export interface MarkdownOptions {
  doc: ReviewDoc
  profile?: ProfileSettings
  entries: Entry[]
  projects: Project[]
  privateData?: PrivateSettings
}

const esc = (s: string) => s.replace(/([\\`*_[\]#<>|])/g, '\\$1')

export function sourceLabel(e: Entry, projects: Project[]): string {
  const p = e.projectId ? projects.find((x) => x.id === e.projectId) : undefined
  return `${formatDate(e.date, 'medium')}${p ? ` · ${p.name}` : ''} — “${excerpt(e.text, 60)}”`
}

export function reviewToMarkdown({ doc, profile, entries, projects, privateData }: MarkdownOptions): string {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const lines: string[] = []
  const who = profile?.fullName || profile?.name || ''
  lines.push(`# ${esc(doc.title || 'Revisión profesional')}`)
  lines.push('')
  if (who || profile?.company) {
    lines.push(`**${esc([who, profile?.company].filter(Boolean).join(' · '))}**${profile?.area ? ` — ${esc(profile.area)}, equipo ${esc(profile.team)}` : ''}  `)
  }
  const n = uniqueSources(doc).length
  lines.push(`Periodo: ${formatDate(doc.periodStart, 'long')} – ${formatDate(doc.periodEnd, 'long')} · Basado en ${n} ${n === 1 ? 'registro' : 'registros'} del diario`)
  lines.push('')
  for (const sec of doc.sections) {
    if (sec.key === 'asistencia' && !doc.includeAttendance) continue
    if (sec.key === 'juntas' && !doc.includeMeetings) continue
    if (!sec.items.length) continue
    lines.push(`## ${REVIEW_TITLE[sec.key]}`)
    lines.push('')
    for (const it of sec.items) {
      if (!it.text.trim()) continue
      lines.push(`- ${esc(it.text.trim())}`)
      if (doc.includeSources) {
        const src = it.sources.map((id) => byId.get(id)).filter(Boolean) as Entry[]
        if (src.length) lines.push(`  - Fuentes: ${src.slice(0, 6).map((e) => esc(sourceLabel(e, projects))).join('; ')}${src.length > 6 ? ` (+${src.length - 6})` : ''}`)
      }
    }
    lines.push('')
  }
  if (doc.includeSalary && privateData) {
    const rows = [
      privateData.currentSalary && `- Sueldo actual: ${esc(privateData.currentSalary)}`,
      privateData.targetSalary && `- Objetivo salarial: ${esc(privateData.targetSalary)}`,
      privateData.nextReviewDate && `- Próxima revisión: ${formatDate(privateData.nextReviewDate, 'long')}`,
    ].filter(Boolean) as string[]
    if (rows.length) {
      lines.push('## Compensación (privado)')
      lines.push('')
      lines.push(...rows)
      lines.push('')
    }
  }
  lines.push('---')
  lines.push('')
  lines.push('_Elaborado a partir de mis registros personales. Los conteos son de registros, no de entregas; practicar una habilidad no implica dominarla._')
  lines.push('')
  return lines.join('\n')
}

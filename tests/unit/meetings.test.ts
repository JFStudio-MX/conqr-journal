import { describe, expect, it } from 'vitest'
import { buildMinutes, closingDraft, contentHash, detectFormat, extractProposals, findDate, findOwner, parseSubtitles } from '../../src/lib/meetings'
import type { Meeting } from '../../src/db/types'

const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Ana>Hola, revisamos el video.</v>

00:01:10.500 --> 00:01:13.000
<v Cliente>Cambio: quitar el logo del segundo 12.</v>
`
const SRT = `1
00:00:01,000 --> 00:00:03,000
Buenos días

2
00:00:05,000 --> 00:00:07,000
Acción: enviar versión 2 @Luis para el 12/11
`
const SUMMARY = `## Objetivo
Revisar la versión 2 del video

**Decisiones:**
- Se mantiene la paleta coral
- Usar la tipografía nueva

Próximos pasos
- Ajustar el cierre del video (Responsable: Ana) para el 14 de noviembre
- Mandar storyboard

Preguntas pendientes
- ¿Quién aprueba el copy final?

Ideas
- Probar una versión vertical

Materiales del cliente
- Logos en vector
`

describe('transcripciones', () => {
  it('lee VTT y SRT conservando marcas de tiempo y personas', () => {
    expect(detectFormat('junta.vtt', VTT)).toBe('vtt')
    expect(detectFormat('junta.srt', SRT)).toBe('srt')
    expect(detectFormat('notas.txt', 'hola')).toBe('txt')
    const v = parseSubtitles(VTT)
    expect(v).toContain('[00:00:01] Ana: Hola, revisamos el video.')
    expect(v).toContain('[00:01:10] Cliente: Cambio: quitar el logo del segundo 12.')
    expect(parseSubtitles(SRT)).toContain('[00:00:05] Acción: enviar versión 2 @Luis para el 12/11')
  })
})

describe('extracción por reglas (todo “por revisar”)', () => {
  const props = extractProposals(SUMMARY, 'm1', '2026-11-10')
  it('detecta solo secciones explícitas', () => {
    const kinds = props.map((p) => p.kind)
    expect(kinds.filter((k) => k === 'decision')).toHaveLength(2)
    expect(kinds.filter((k) => k === 'action')).toHaveLength(2)
    expect(kinds).toContain('objective')
    expect(kinds).toContain('question')
    expect(kinds).toContain('idea')
    expect(kinds).toContain('material')
  })
  it('responsable y fecha solo si se mencionan; nunca Joshua por defecto', () => {
    const a = props.filter((p) => p.kind === 'action')
    expect(a[0]).toMatchObject({ owner: 'Ana', dueDate: '2026-11-14' })
    expect(a[1].owner).toBeUndefined()
    expect(a[1].dueDate).toBeUndefined()
  })
  it('las claves son estables: importar dos veces no duplica', () => {
    const again = extractProposals(SUMMARY, 'm1', '2026-11-10')
    expect(again.map((p) => p.key)).toEqual(props.map((p) => p.key))
    expect(new Set(props.map((p) => p.key)).size).toBe(props.length)
    expect(contentHash(SUMMARY)).toBe(contentHash(SUMMARY.replace(/\n/g, '\r\n')))
  })
  it('prefijos en línea dentro de transcripciones', () => {
    const p = extractProposals(parseSubtitles(VTT), 'm2', '2026-11-10')
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ kind: 'change', text: 'quitar el logo del segundo 12.', timestamp: '00:01:10' })
  })
  it('fechas y responsables explícitos', () => {
    expect(findDate('para el 12/11', '2026-11-10')).toBe('2026-11-12')
    expect(findDate('antes del 3 de enero', '2026-11-10')).toBe('2027-01-03')
    expect(findDate('el viernes', '2026-11-10')).toBeUndefined()
    expect(findOwner('Enviar archivos @Luis')).toBe('Luis')
    expect(findOwner('mandar el storyboard')).toBeUndefined()
  })
})

describe('minuta y cierre solo con lo revisado', () => {
  const m: Meeting = {
    id: 'm1',
    title: 'Revisión video',
    date: '2026-11-10',
    decisions: [
      { id: 'd1', text: 'Mantener coral', review: 'revisado' },
      { id: 'd2', text: 'Sugerencia no confirmada', review: 'por_revisar' },
    ],
    ideas: [],
    questions: [{ id: 'q1', text: '¿Quién aprueba el copy?', review: 'revisado' }],
    materials: [],
    entryIds: [],
    createdAt: '',
    updatedAt: '',
  }
  const actions = [{ id: 'a1', meetingId: 'm1', text: 'Ajustar cierre', owner: 'Ana', status: 'confirmada' as const, createdAt: '', updatedAt: '' }]
  const changes = [{ id: 'c1', meetingId: 'm1', request: 'Quitar logo', status: 'por_aclarar' as const, review: 'revisado' as const, attachmentIds: [], createdAt: '', updatedAt: '' }]
  it('la minuta excluye propuestas sin revisar y no inventa fechas', () => {
    const txt = buildMinutes({ meeting: m, actions, changes })
    expect(txt).toContain('Mantener coral')
    expect(txt).not.toContain('Sugerencia no confirmada')
    expect(txt).toContain('Responsable: Ana — Fecha: sin fecha')
    expect(txt).toContain('Fecha acordada por el equipo: sin fecha acordada')
    expect(txt).toContain('1 propuesta(s) sin revisar no se incluyen')
  })
  it('cierre prellenado', () => {
    const c = closingDraft({ meeting: m, actions, changes })
    expect(c.approved).toBe('Mantener coral')
    expect(c.who).toBe('Ana: Ajustar cierre')
    expect(c.pending).toContain('¿Quién aprueba el copy?')
  })
})

import { describe, expect, it } from 'vitest'
import { addMonths, formatDate, nowTimeHMS, startOfWeek, todayISO, isISODate } from '../../src/lib/dates'
import { distribution, lowData, primaryCategory, skillsOverTime, timeSavingResult, uniqueCount, weeklyActivity } from '../../src/lib/metrics'
import { attendanceStats, classifyRecord, defaultAttendanceSettings, earlyLeave, isBeforeCutoff, stageReferenceDate } from '../../src/lib/attendance'
import { generateSections, refreshSections, uniqueSources } from '../../src/lib/review'
import { buildBackup, sameContent, validateBackup, validateBackupText, type BackupData } from '../../src/lib/backup'
import { safeUrl } from '../../src/lib/text'
import type { Attendance, Entry, Project } from '../../src/db/types'
import { initialItems } from '../../src/db/seed'

let n = 0
const E = (p: Partial<Entry> & Pick<Entry, 'date'>): Entry => ({
  id: `e${++n}`,
  text: `registro ${n}`,
  categories: [],
  skills: [],
  links: [],
  attachmentIds: [],
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  ...p,
})

describe('fechas en America/Mexico_City', () => {
  it('“hoy” no depende de la zona del dispositivo', () => {
    // 05:30 UTC del 8 nov = 23:30 del 7 nov en CDMX
    expect(todayISO(new Date('2026-11-08T05:30:00Z'))).toBe('2026-11-07')
    expect(todayISO(new Date('2026-11-08T06:00:00Z'))).toBe('2026-11-08')
    expect(nowTimeHMS(new Date('2026-11-09T14:59:59Z'))).toBe('08:59:59')
  })
  it('formatea fechas civiles sin desplazamientos', () => {
    expect(formatDate('2026-11-05', 'long')).toBe('5 de noviembre de 2026')
    expect(formatDate('2026-01-01', 'dayMonth')).toMatch(/^1 ene/)
  })
  it('semana de lunes a domingo y meses con fin de mes', () => {
    expect(startOfWeek('2026-11-07')).toBe('2026-11-02') // sábado → lunes
    expect(startOfWeek('2026-11-08')).toBe('2026-11-02') // domingo → lunes anterior
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28')
    expect(isISODate('2026-02-30')).toBe(false)
  })
})

describe('métricas honestas', () => {
  const entries = [
    E({ date: '2026-11-02', categories: ['avance', 'entrega'], projectId: 'p1', skills: ['Figma'] }),
    E({ date: '2026-11-02', categories: ['aprendizaje'], projectId: 'p1', skills: ['figma ', 'After Effects'] }),
    E({ date: '2026-11-04', categories: [], projectId: 'p2' }),
    E({ date: '2026-11-10', categories: ['logro', 'feedback'], evidence: true }),
    E({ date: '2026-11-10', categories: ['entrega'], pending: true }), // por confirmar: no cuenta
  ]
  it('cada registro cuenta una vez en su categoría principal y se excluyen borradores', () => {
    const w = weeklyActivity(entries, '2026-11-02', '2026-11-15')
    expect(w).toHaveLength(2)
    expect(w[0]).toMatchObject({ weekStart: '2026-11-02', total: 3, days: 2 })
    expect(w[0].byCat).toMatchObject({ entrega: 1, aprendizaje: 1, sin: 1, avance: 0 })
    expect(w[1].total).toBe(1)
    expect(w[1].byCat.logro).toBe(1)
    const sum = w.reduce((s, x) => s + Object.values(x.byCat).reduce((a, b) => a + b, 0), 0)
    expect(sum).toBe(4) // nunca cuenta dos veces
    expect(primaryCategory(entries[0])).toBe('entrega')
  })
  it('distribución por proyecto y marca por confirmar', () => {
    const projects: Project[] = [
      { id: 'p1', name: 'RCO', brandUnconfirmed: true, status: 'activo', createdAt: '', updatedAt: '' },
      { id: 'p2', name: 'Landing', brandId: 'b1', status: 'activo', createdAt: '', updatedAt: '' },
    ]
    const brands = [{ id: 'b1', name: 'ECCO', createdAt: '', updatedAt: '' }]
    const byP = distribution(entries, projects, brands, 'project', '2026-11-01', '2026-11-30')
    expect(byP.map((r) => [r.label, r.count])).toEqual([['RCO', 2], ['Landing', 1], ['Sin proyecto', 1]])
    const byB = distribution(entries, projects, brands, 'brand', '2026-11-01', '2026-11-30')
    expect(byB.find((r) => r.kind === 'unconfirmed')?.count).toBe(2)
    expect(byB.reduce((s, r) => s + r.count, 0)).toBe(4)
  })
  it('habilidades vinculadas a registros reales, sin duplicar variantes', () => {
    const s = skillsOverTime(entries, '2026-11-01', '2026-11-30')
    expect(s[0]).toMatchObject({ label: 'Figma', total: 2 })
    expect(s[0].entryIds).toEqual([entries[0].id, entries[1].id])
  })
  it('periodos con pocos datos y totales únicos', () => {
    expect(lowData(weeklyActivity([], '2026-11-02', '2026-11-30'))).toBe('none')
    expect(lowData(weeklyActivity(entries, '2026-11-02', '2026-11-15'))).toBe('few')
    expect(uniqueCount(['a', 'b'], ['b', 'c'])).toBe(3)
  })
  it('ahorro de tiempo solo con datos suficientes y sin dinero', () => {
    expect(timeSavingResult({ baselineMin: 120, newMin: 30 }).ok).toBe(false)
    const r = timeSavingResult({ baselineMin: 120, newMin: 30, scope: 'lote de 30 fotos', certainty: 'estimado' })
    expect(r).toEqual({ ok: true, diffMin: 90, pct: 75, certainty: 'estimado' })
  })
})

describe('puntualidad', () => {
  const cfg = defaultAttendanceSettings('2026-11-05', '')
  const A = (id: string, p: Partial<Attendance>): Attendance => ({ id, kind: 'presencial', source: 'boton', createdAt: '', updatedAt: '', ...p })
  it('retardo a partir de las 9:30 exactas', () => {
    expect(cfg.cutoff).toBe('09:30')
    expect(classifyRecord(A('2026-11-09', { time: '09:00:00' }), cfg.cutoff)).toBe('antes')
    expect(classifyRecord(A('2026-11-09', { time: '09:29:59' }), cfg.cutoff)).toBe('antes')
    expect(classifyRecord(A('2026-11-09', { time: '09:30:00' }), cfg.cutoff)).toBe('despues')
    expect(isBeforeCutoff('09:30', '09:30')).toBe(false)
  })
  it('llegar 8:30 o antes permite salir 30 min antes de la salida de ese día', () => {
    const c = { ...cfg, exitTimes: { '1': '18:00', '5': '15:00' } }
    expect(earlyLeave(A('2026-11-09', { time: '08:30:40' }), c)).toMatchObject({ eligible: true, leaveAt: '17:30:00' }) // lunes
    expect(earlyLeave(A('2026-11-13', { time: '08:10:00' }), c)).toMatchObject({ eligible: true, leaveAt: '14:30:00' }) // viernes
    expect(earlyLeave(A('2026-11-10', { time: '08:20:00' }), c)).toEqual({ eligible: true, minutes: 30 }) // martes sin salida configurada
    expect(earlyLeave(A('2026-11-09', { time: '08:31:00' }), c).eligible).toBe(false)
    expect(earlyLeave(A('2026-11-09', { kind: 'home_office' }), c).eligible).toBe(false)
  })
  it('porcentaje solo sobre días presenciales con hora; días sin registro aparte', () => {
    const recs = [
      A('2026-11-05', { time: '08:40:00' }),
      A('2026-11-06', { time: '09:35:00' }),
      A('2026-11-09', { kind: 'home_office' }),
      A('2026-11-10', {}), // presencial sin hora
    ]
    const s = attendanceStats(recs, cfg, '2026-11-12')
    expect(s).toMatchObject({ antes: 1, despues: 1, homeOffice: 1, presencialSinHora: 1, base: 2, sinRegistro: 1, todayPending: true })
    expect(s.pct).toBe(0.5)
  })
  it('aniversarios de referencia desde el ingreso', () => {
    expect(stageReferenceDate('2026-11-05', 3)).toBe('2027-02-05')
    expect(stageReferenceDate('2026-11-05', 6)).toBe('2027-05-05')
    expect(stageReferenceDate('2026-11-05', 12)).toBe('2027-11-05')
    expect(cfg.stages.every((s) => s.confirmedAmount === undefined)).toBe(true)
    expect(cfg.bonusNote).toContain('$5,000')
  })
})

describe('revisión trazable', () => {
  const entries = [
    E({ date: '2026-11-10', text: 'Entregué la demo', categories: ['entrega'], projectId: 'p1', outcome: 'Demo funcional', contribution: 'Programé la app', status: 'entregado', skills: ['React'] }),
    E({ date: '2026-11-11', text: 'Feedback de mi jefa', categories: ['feedback'], feedback: { quote: 'Se ve muy bien', person: 'Jefa', interpretation: 'Le gustó la dirección' } }),
    E({ date: '2026-11-12', text: 'Automaticé recortes', timeSaving: { baselineMin: 60, newMin: 20, scope: 'lote', certainty: 'medido' } }),
    E({ date: '2026-11-12', text: 'Borrador', pending: true, contribution: 'no debe salir' }),
    E({ date: '2026-12-20', text: 'Fuera del periodo', contribution: 'tampoco' }),
  ]
  const projects: Project[] = [{ id: 'p1', name: 'RCO', status: 'activo', createdAt: '', updatedAt: '' }]
  const sections = generateSections({
    allEntries: entries,
    projects,
    brands: [],
    goals: [],
    attendance: [],
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    today: '2026-11-30',
    includeAttendance: false,
    makeId: () => `i${++n}`,
  })
  const valid = new Set(entries.slice(0, 3).map((e) => e.id))
  it('cada afirmación generada apunta solo a registros confirmados del periodo', () => {
    for (const s of sections) for (const it of s.items) for (const id of it.sources) expect(valid.has(id)).toBe(true)
    expect(uniqueSources({ sections }).length).toBe(3)
    expect(JSON.stringify(sections)).not.toContain('no debe salir')
    expect(sections.find((s) => s.key === 'asistencia')).toBeUndefined()
  })
  it('separa cita textual de interpretación y conserva “medido”', () => {
    const fb = sections.find((s) => s.key === 'feedback')!.items[0].text
    expect(fb).toContain('«Se ve muy bien» — Jefa')
    expect(fb).toContain('Mi interpretación: Le gustó la dirección')
    const res = sections.find((s) => s.key === 'resultados')!.items[0].text
    expect(res).toContain('40 min menos')
    expect(res).toContain('medido')
    expect(res).not.toMatch(/\$|MXN|pesos/)
  })
  it('actualizar conserva lo editado a mano', () => {
    const edited = sections.map((s) => (s.key === 'contribucion' ? { ...s, items: s.items.map((i) => ({ ...i, text: i.text + ' (editado)' })) } : s))
    const merged = refreshSections(edited, sections)
    expect(merged.find((s) => s.key === 'contribucion')!.items.some((i) => i.text.endsWith('(editado)'))).toBe(true)
  })
})

describe('respaldo', () => {
  const base = (): BackupData => ({
    settings: initialItems('2026-11-07T00:00:00Z').filter((i) => i.c === 'settings').map((i) => i.rec) as BackupData['settings'],
    brands: [],
    projects: [],
    entries: [E({ date: '2026-11-07', links: ['https://figma.com/x', 'javascript:alert(1)'] })],
    attachments: [{ id: 'a1', entryId: 'e1', name: 'c.png', mime: 'image/png', size: 3, createdAt: '', updatedAt: '' }],
    goals: [],
    reflections: [],
    reviews: [],
    attendance: [],
    meetings: [],
    transcripts: [],
    actions: [],
    changes: [],
    files: [{ id: 'a1', mime: 'image/png', base64: 'AAEC' }],
  })
  it('ida y vuelta con adjuntos incluidos', async () => {
    const file = await buildBackup(base(), 'cuenta', 'test', '2026-11-07T00:00:00Z')
    const r = await validateBackup(JSON.parse(JSON.stringify(file)), '2026-11-07T00:00:00Z')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.files[0].base64).toBe('AAEC')
    expect(r.data.entries[0].links).toEqual(['https://figma.com/x']) // el enlace javascript: se descarta
    expect(r.summary.counts.entries).toBe(1)
  })
  it('rechaza archivos alterados, inválidos o de una versión futura', async () => {
    const file = await buildBackup(base(), 'cuenta', 'test', '2026-11-07T00:00:00Z')
    const tampered = JSON.parse(JSON.stringify(file))
    tampered.data.entries[0].text = 'cambiado'
    expect((await validateBackup(tampered, '')).ok).toBe(false)
    expect((await validateBackupText('{no es json', '')).ok).toBe(false)
    expect((await validateBackup({ format: 'otra-app' }, '')).ok).toBe(false)
    expect((await validateBackup({ ...file, version: 99 }, '')).ok).toBe(false)
    const bad = await buildBackup({ ...base(), entries: [{ ...E({ date: '2026-13-45' }) }] }, 'cuenta', 't', '')
    expect((await validateBackup(JSON.parse(JSON.stringify(bad)), '')).ok).toBe(false)
  })
  it('comparación de contenido ignora metadatos de sincronización', () => {
    expect(sameContent({ id: 'x', a: 1, _v: 3, _dirty: 1 }, { a: 1, id: 'x' })).toBe(true)
  })
  it('enlaces: solo http(s)', () => {
    expect(safeUrl('figma.com/file/1')).toBe('https://figma.com/file/1')
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('data:text/html,hi')).toBeNull()
  })
})

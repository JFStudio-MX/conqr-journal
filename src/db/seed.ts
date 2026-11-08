/**
 * Datos iniciales reales (mínimos) y datos de DEMO (ficticios, en otra base de datos).
 * Los ids son fijos para que dos dispositivos no creen duplicados.
 */
import { nowISO } from '../lib/cn'
import { DEFAULT_BRANDS } from '../lib/constants'
import { addDays, isoWeekday, startOfWeek } from '../lib/dates'
import { defaultAttendanceSettings } from '../lib/attendance'
import type {
  Attendance,
  Brand,
  CategoryId,
  CollectionMap,
  CollectionName,
  Entry,
  Goal,
  ProfileSettings,
  Project,
  Reflection,
} from './types'
import type { Repo } from './repo'

export const START_DATE = '2026-11-05'
export const RCO_PROJECT_ID = 'project-rco'

const brandId = (name: string) =>
  'brand-' +
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

type Item = { c: CollectionName; rec: CollectionMap[CollectionName] }

function profile(now: string, startDate = START_DATE): ProfileSettings {
  return {
    id: 'profile',
    name: 'Joshua',
    nickname: 'Josh',
    fullName: 'Joshua Flores',
    company: 'Conqr',
    team: 'ROJO',
    area: 'Arte Digital',
    startDate,
    locale: 'es-MX',
    timezone: 'America/Mexico_City',
    weekStartsOn: 1,
    createdAt: now,
    updatedAt: now,
  }
}

function brands(now: string): Brand[] {
  return DEFAULT_BRANDS.map((name) => ({ id: brandId(name), name, createdAt: now, updatedAt: now }))
}

function blankEntry(now: string, p: Partial<Entry> & Pick<Entry, 'id' | 'date' | 'text'>): Entry {
  return { categories: [], skills: [], links: [], attachmentIds: [], createdAt: now, updatedAt: now, ...p }
}

/**
 * Fecha fija: si dos dispositivos crean los datos iniciales al mismo tiempo, el contenido
 * es idéntico y la sincronización lo reconoce sin generar un conflicto.
 */
export const SEED_TIME = '2026-11-07T12:00:00.000Z'

export function initialItems(now = SEED_TIME): Item[] {
  const rco: Project = {
    id: RCO_PROJECT_ID,
    name: 'RCO',
    brandUnconfirmed: true,
    description: 'App que permite tomar o elegir una foto y generar una imagen de perfil de WhatsApp con distintivo de marca.',
    status: 'activo',
    createdAt: now,
    updatedAt: now,
  }
  const entries: Entry[] = [
    blankEntry(now, {
      id: 'seed-2026-11-05-ingreso',
      date: '2026-11-05',
      text: 'Ingreso a Conqr: Arte Digital, equipo ROJO.',
      pending: true,
      pendingNote: 'Borrador precargado. Revísalo, ajústalo si hace falta y confírmalo.',
    }),
    blankEntry(now, {
      id: 'seed-2026-11-07-demo-rco',
      date: '2026-11-07',
      text: 'Mostré la demo de la app RCO (tomar o elegir una foto y generar una imagen de perfil de WhatsApp con distintivo de marca). Mi jefa y mis compañeros reaccionaron de forma positiva.',
      categories: ['feedback'],
      projectId: RCO_PROJECT_ID,
      pending: true,
      pendingNote:
        'La fecha (7 nov) es la del relato de la reacción; corrígela si la demo fue otro día. No implica aprobación del cliente, publicación ni uso en producción.',
      feedback: { person: 'Mi jefa y compañeros', interpretation: 'Reacción positiva a la demo.' },
    }),
  ]
  return [
    { c: 'settings', rec: profile(now) },
    { c: 'settings', rec: defaultAttendanceSettings(START_DATE, now) },
    ...brands(now).map((rec) => ({ c: 'brands' as const, rec })),
    { c: 'projects', rec: rco },
    ...entries.map((rec) => ({ c: 'entries' as const, rec })),
  ]
}

export async function seedInitial(repo: Repo): Promise<boolean> {
  if (await repo.db.settings.get('profile')) return false
  await repo.addMissing(initialItems())
  return true
}

// ----------------------------- DEMO -----------------------------

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const DEMO_LINES: { text: string; cats: CategoryId[]; skills: string[]; proj: number }[] = [
  { text: 'Ajusté la animación del logo para la campaña de invierno y la mandé a revisión.', cats: ['avance'], skills: ['After Effects'], proj: 0 },
  { text: 'Entregué los 6 banners de redes con las correcciones de copy.', cats: ['entrega'], skills: ['Figma'], proj: 1 },
  { text: 'Aprendí a usar referencias de estilo para mantener consistencia en imágenes generadas.', cats: ['aprendizaje'], skills: ['Prompting IA'], proj: 3 },
  { text: 'Propuse una dirección visual alternativa para el carrusel; la eligieron para producción interna.', cats: ['logro'], skills: ['Dirección de arte'], proj: 1 },
  { text: 'Esperando assets del cliente para cerrar las piezas de la landing.', cats: ['bloqueo'], skills: [], proj: 2 },
  { text: 'Armé un prototipo interactivo para el filtro de foto de perfil.', cats: ['avance'], skills: ['Three.js', 'Prototipado'], proj: 3 },
  { text: 'Revisión con mi líder sobre la composición de las piezas.', cats: ['feedback'], skills: ['Dirección de arte'], proj: 0 },
  { text: 'Automaticé el recorte de fotos de producto con una acción; antes lo hacía a mano.', cats: ['logro', 'avance'], skills: ['Photoshop', 'Automatización'], proj: 1 },
  { text: 'Corregí el problema de exportación de video que bloqueaba la entrega.', cats: ['bloqueo', 'entrega'], skills: ['After Effects'], proj: 0 },
  { text: 'Documenté el proceso para generar variantes con IA y lo compartí con el equipo.', cats: ['aprendizaje', 'entrega'], skills: ['Prompting IA'], proj: 3 },
]

const DEMO_PROJECTS = [
  { id: 'demo-p-ecco', name: 'Campaña invierno', brand: 'ECCO' },
  { id: 'demo-p-kb', name: 'Social media mensual', brand: 'KleenBebé' },
  { id: 'demo-p-rocka', name: 'Landing de servicios', brand: 'ROCKA Solutions' },
  { id: 'demo-p-rco', name: 'RCO', brand: '' },
]

export async function seedDemo(repo: Repo, today: string): Promise<void> {
  if (await repo.db.settings.get('profile')) return
  const now = nowISO()
  const start = addDays(startOfWeek(today), -49)
  const r = rng(42)
  const items: Item[] = []
  items.push({ c: 'settings', rec: { ...profile(now, start), name: 'Joshua', fullName: 'Joshua Flores (demo)' } })
  items.push({ c: 'settings', rec: defaultAttendanceSettings(start, now) })
  for (const b of brands(now)) items.push({ c: 'brands', rec: b })
  for (const p of DEMO_PROJECTS) {
    items.push({
      c: 'projects',
      rec: {
        id: p.id,
        name: p.name,
        brandId: p.brand ? brandId(p.brand) : undefined,
        brandUnconfirmed: !p.brand || undefined,
        status: 'activo',
        createdAt: now,
        updatedAt: now,
      } as Project,
    })
  }
  const entryIds: string[] = []
  let n = 0
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const wd = isoWeekday(d)
    if (wd > 5) continue
    // semanas con huecos para mostrar estados honestos
    if (d >= addDays(start, 21) && d < addDays(start, 28)) continue
    const count = r() < 0.35 ? 0 : r() < 0.7 ? 1 : 2
    for (let i = 0; i < count; i++) {
      const line = DEMO_LINES[Math.floor(r() * DEMO_LINES.length)]
      const proj = DEMO_PROJECTS[line.proj]
      const id = `demo-e-${n++}`
      entryIds.push(id)
      const e = blankEntry(now, { id, date: d, text: line.text, categories: line.cats, skills: line.skills, projectId: proj.id })
      if (line.cats.includes('entrega')) {
        e.outcome = 'Piezas finales entregadas'
        e.status = r() < 0.5 ? 'entregado' : 'aprobado'
      }
      if (line.cats.includes('feedback')) {
        e.feedback = { quote: 'La jerarquía se lee mucho mejor ahora.', person: 'Líder de arte (ficticio)', date: d, interpretation: 'Mi propuesta de composición funciona; seguir por ahí.' }
      }
      if (line.cats.includes('logro') && line.skills.includes('Automatización')) {
        e.timeSaving = { baselineMin: 120, baselineSource: 'Lo que me tomaba recortar 30 fotos a mano', newMin: 35, scope: 'Lote de 30 fotos de producto', certainty: 'estimado' }
        e.contribution = 'Creé la acción y probé con el lote completo.'
        e.evidence = true
      }
      if (line.cats.includes('logro') && !e.evidence) e.evidence = r() < 0.5 || undefined
      items.push({ c: 'entries', rec: e })
    }
    // asistencia de ejemplo (algunos días sin registro a propósito)
    if (d < today && r() < 0.85) {
      const kind: Attendance['kind'] = r() < 0.12 ? 'home_office' : 'presencial'
      const mins = 8 * 60 + 30 + Math.floor(r() * 45)
      const time = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:00`
      const a: Attendance = { id: d, kind, time: kind === 'presencial' ? time : undefined, source: 'boton', createdAt: now, updatedAt: now }
      items.push({ c: 'attendance', rec: a })
    }
  }
  const goals: Goal[] = [
    { id: 'demo-g-1', title: 'Liderar la dirección de arte de una campaña completa', criterion: 'Presentar y defender la propuesta visual ante el equipo', status: 'activo', evidenceIds: entryIds.slice(2, 4), createdAt: now, updatedAt: now, dueDate: addDays(today, 60) },
    { id: 'demo-g-2', title: 'Integrar IA creativa en un flujo real', criterion: 'Un proceso documentado y usado por el equipo', status: 'activo', evidenceIds: entryIds.slice(5, 7), createdAt: now, updatedAt: now },
  ]
  for (const g of goals) items.push({ c: 'goals', rec: g })
  const lastWeek = addDays(startOfWeek(today), -7)
  const refl: Reflection = { id: lastWeek, wentWell: 'Entregas a tiempo y buena recepción del carrusel.', learned: 'Referencias de estilo en IA.', improve: 'Pedir assets antes para no bloquearme.', createdAt: now, updatedAt: now }
  items.push({ c: 'reflections', rec: refl })
  await repo.addMissing(items)
}

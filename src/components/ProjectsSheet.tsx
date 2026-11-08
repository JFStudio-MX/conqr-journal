import { useState } from 'react'
import { Archive, ArrowUpRight, Pencil, Plus } from 'lucide-react'
import type { Brand, Project, ProjectStatus } from '../db/types'
import { storageErrorMessage } from '../db/database'
import { plural } from '../lib/text'
import { nowISO, uid } from '../lib/cn'
import { useData } from '../app/data'
import { useWorkspace } from '../app/session'
import { navigate } from '../app/router'
import { Badge, Button, SelectField, TextArea, TextField } from './ui/ui'
import { Sheet } from './ui/overlay'
import { useToast } from './ui/toast'

const STATUS: { id: ProjectStatus; label: string }[] = [
  { id: 'activo', label: 'Activo' },
  { id: 'pausado', label: 'Pausado' },
  { id: 'cerrado', label: 'Cerrado' },
]

export function ProjectsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { projects, brands, entries } = useData()
  const [editing, setEditing] = useState<Project | 'new' | null>(null)
  const [brandEdit, setBrandEdit] = useState<Brand | 'new' | null>(null)
  const count = (pid: string) => entries.filter((e) => e.projectId === pid && !e.pending).length
  const bcount = (bid: string) =>
    entries.filter((e) => !e.pending && (e.brandId === bid || (!e.brandId && projects.find((p) => p.id === e.projectId && !p.brandUnconfirmed)?.brandId === bid))).length

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Proyectos y marcas" description="Agrupa tus registros. No es un gestor de tareas." wide>
      <div className="grid gap-8 pb-6">
        <section aria-labelledby="pj-title">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 id="pj-title" className="display text-lg">
              Proyectos
            </h3>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="size-4" /> Nuevo proyecto
            </Button>
          </div>
          {editing && <ProjectForm key={editing === 'new' ? 'new' : editing.id} project={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
          <ul className="grid gap-2">
            {projects.map((p) => {
              const b = brands.find((x) => x.id === p.brandId)
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-line px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{p.name}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                      {p.brandUnconfirmed ? <Badge tone="warn">Marca por confirmar</Badge> : b ? b.name : 'Sin marca'}
                      <span>· {STATUS.find((s) => s.id === p.status)?.label}</span>
                      <span>· {plural(count(p.id), 'registro', 'registros')}</span>
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onOpenChange(false)
                      navigate('diario', { project: p.id })
                    }}
                  >
                    Ver registros <ArrowUpRight className="size-4" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Editar ${p.name}`} onClick={() => setEditing(p)}>
                    <Pencil className="size-4" />
                  </Button>
                </li>
              )
            })}
            {!projects.length && <li className="text-sm text-ink-3">Aún no hay proyectos.</li>}
          </ul>
        </section>

        <section aria-labelledby="br-title">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 id="br-title" className="display text-lg">
              Marcas
            </h3>
            <Button size="sm" onClick={() => setBrandEdit('new')}>
              <Plus className="size-4" /> Nueva marca
            </Button>
          </div>
          {brandEdit && <BrandForm key={brandEdit === 'new' ? 'new' : brandEdit.id} brand={brandEdit === 'new' ? undefined : brandEdit} onDone={() => setBrandEdit(null)} />}
          <ul className="grid gap-2 sm:grid-cols-2">
            {brands.map((b) => (
              <li key={b.id} className="flex items-center gap-2 rounded-2xl border border-line px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">
                    {b.name} {b.archived && <Badge>Archivada</Badge>}
                  </p>
                  <p className="text-xs text-ink-3">{plural(bcount(b.id), 'registro', 'registros')}</p>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={`Editar ${b.name}`} onClick={() => setBrandEdit(b)}>
                  <Pencil className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Sheet>
  )
}

function ProjectForm({ project, onDone }: { project?: Project; onDone: () => void }) {
  const { brands } = useData()
  const { repo } = useWorkspace()
  const toast = useToast()
  const [name, setName] = useState(project?.name ?? '')
  const [brand, setBrand] = useState(project?.brandUnconfirmed ? '__pending' : (project?.brandId ?? ''))
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'activo')
  const [description, setDescription] = useState(project?.description ?? '')
  const [err, setErr] = useState<string>()
  const save = async () => {
    if (!name.trim()) return setErr('Escribe un nombre.')
    const now = nowISO()
    const rec: Project = {
      id: project?.id ?? uid(),
      name: name.trim().slice(0, 120),
      brandId: brand && brand !== '__pending' ? brand : undefined,
      brandUnconfirmed: brand === '__pending' || undefined,
      status,
      description: description.trim() || undefined,
      createdAt: project?.createdAt ?? now,
      updatedAt: now,
    }
    try {
      await repo.put('projects', rec)
      toast({ tone: 'ok', message: project ? 'Proyecto actualizado.' : 'Proyecto creado.' })
      onDone()
    } catch (e) {
      setErr(storageErrorMessage(e))
    }
  }
  return (
    <div className="mb-4 grid gap-3 rounded-2xl bg-surface-2 p-4">
      <TextField label="Nombre" value={name} onChange={(e) => setName(e.target.value)} error={err} maxLength={120} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Marca" value={brand} onChange={(e) => setBrand(e.target.value)} hint={brand === '__pending' ? 'Se excluye de los totales por marca hasta confirmarla.' : undefined}>
          <option value="">Sin marca</option>
          <option value="__pending">Por confirmar</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Estado" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
          {STATUS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </SelectField>
      </div>
      <TextArea label="Descripción" optional rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={() => void save()}>
          Guardar
        </Button>
      </div>
    </div>
  )
}

function BrandForm({ brand, onDone }: { brand?: Brand; onDone: () => void }) {
  const { repo } = useWorkspace()
  const toast = useToast()
  const [name, setName] = useState(brand?.name ?? '')
  const [err, setErr] = useState<string>()
  const save = async (archived = brand?.archived) => {
    if (!name.trim()) return setErr('Escribe un nombre.')
    const now = nowISO()
    try {
      await repo.put('brands', { id: brand?.id ?? uid(), name: name.trim().slice(0, 120), archived: archived || undefined, createdAt: brand?.createdAt ?? now, updatedAt: now })
      toast({ tone: 'ok', message: 'Marca guardada.' })
      onDone()
    } catch (e) {
      setErr(storageErrorMessage(e))
    }
  }
  return (
    <div className="mb-4 grid gap-3 rounded-2xl bg-surface-2 p-4">
      <TextField label="Nombre de la marca" value={name} onChange={(e) => setName(e.target.value)} error={err} maxLength={120} />
      <div className="flex flex-wrap justify-end gap-2">
        {brand && (
          <Button variant="ghost" className="mr-auto" onClick={() => void save(!brand.archived)}>
            <Archive className="size-4" /> {brand.archived ? 'Desarchivar' : 'Archivar'}
          </Button>
        )}
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={() => void save()}>
          Guardar
        </Button>
      </div>
    </div>
  )
}

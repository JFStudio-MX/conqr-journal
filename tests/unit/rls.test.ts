/**
 * Prueba la migración REAL de Supabase (RLS, triggers, push_changes y políticas de storage)
 * en PGlite, actuando como los roles `authenticated` y `anon` igual que lo hace Supabase.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite, Transaction } from '@electric-sql/pglite'
import { createDb } from '../emulator/server.mjs'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
let db: PGlite

async function as<T>(uid: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`set local role ${uid ? 'authenticated' : 'anon'}`)
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' })])
    return fn(tx)
  })
}
const push = (uid: string | null, changes: unknown[]) =>
  as(uid, async (tx) => (await tx.query<{ r: { status: string; row: { version: number; deleted: boolean; data: unknown } }[] }>('select public.push_changes($1::jsonb) as r', [JSON.stringify(changes)])).rows[0].r)
const ch = (id: string, base: number, mid: string, data: object = { text: id }, deleted = false) => ({ collection: 'entries', id, base_version: base, mutation_id: mid, data, deleted, client_updated_at: new Date().toISOString() })
const M = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

beforeAll(async () => {
  db = (await createDb()) as PGlite
  await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [A, 'a@test', B, 'b@test'])
})

describe('Row Level Security', () => {
  it('cada usuario solo ve sus propios registros', async () => {
    const r = await push(A, [ch('e1', 0, M(1)), ch('e2', 0, M(2))])
    expect(r.map((x) => x.status)).toEqual(['applied', 'applied'])
    const mine = await as(A, (tx) => tx.query('select id from public.records'))
    const theirs = await as(B, (tx) => tx.query('select id from public.records'))
    expect(mine.rows).toHaveLength(2)
    expect(theirs.rows).toHaveLength(0)
  })
  it('no se puede escribir con el user_id de otra persona', async () => {
    await expect(
      as(B, (tx) => tx.query(`insert into public.records (user_id, collection, id, data, mutation_id) values ($1, 'entries', 'x', '{}', $2)`, [A, M(9)])),
    ).rejects.toThrow(/row-level security/)
    const upd = await as(B, (tx) => tx.query(`update public.records set data = '{"hack":1}' where user_id = $1`, [A]))
    expect(upd.affectedRows ?? 0).toBe(0)
  })
  it('el mismo id en otra cuenta crea una fila independiente', async () => {
    await push(B, [ch('e1', 0, M(3), { text: 'de B' })])
    const a = await as(A, (tx) => tx.query<{ data: { text: string } }>(`select data from public.records where id = 'e1'`))
    expect(a.rows[0].data.text).toBe('e1')
  })
  it('anónimo: sin acceso a datos ni a push_changes', async () => {
    await expect(as(null, (tx) => tx.query('select * from public.records'))).rejects.toThrow(/permission denied/)
    await expect(push(null, [ch('z', 0, M(4))])).rejects.toThrow(/permission denied|No autenticado/)
  })
  it('colecciones desconocidas se rechazan', async () => {
    await expect(push(A, [{ ...ch('q', 0, M(5)), collection: 'otra' }])).rejects.toThrow(/records_collection_chk/)
  })
})

describe('versiones, conflictos, idempotencia y lápidas', () => {
  it('actualiza solo sobre la versión correcta', async () => {
    const [ok] = await push(A, [ch('e1', 1, M(10), { text: 'v2' })])
    expect(ok.status).toBe('applied')
    expect(ok.row.version).toBe(2)
    const [conf] = await push(A, [ch('e1', 1, M(11), { text: 'otro dispositivo' })])
    expect(conf.status).toBe('conflict')
    expect(conf.row).toMatchObject({ version: 2, data: { text: 'v2' } }) // no se sobrescribió
  })
  it('reintentar el mismo cambio no lo aplica dos veces', async () => {
    const [again] = await push(A, [ch('e1', 1, M(10), { text: 'v2' })])
    expect(again.status).toBe('applied')
    expect(again.row.version).toBe(2)
  })
  it('el borrado es una lápida que vacía el contenido', async () => {
    const [del] = await push(A, [ch('e2', 1, M(12), { text: 'secreto' }, true)])
    expect(del.row).toMatchObject({ deleted: true, data: {}, version: 2 })
    // un dispositivo desactualizado que intente revivirlo choca con la lápida
    const [stale] = await push(A, [ch('e2', 1, M(13), { text: 'revivido' })])
    expect(stale.status).toBe('conflict')
    expect(stale.row.deleted).toBe(true)
  })
  it('el servidor asigna la versión aunque se intente falsear', async () => {
    await as(A, (tx) => tx.query(`update public.records set version = 999 where id = 'e1'`))
    const r = await as(A, (tx) => tx.query<{ version: number }>(`select version from public.records where id = 'e1'`))
    expect(r.rows[0].version).toBe(3)
  })
})

describe('almacenamiento privado', () => {
  const put = (uid: string, name: string) => as(uid, (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, auth.uid())`, [name]))
  it('solo puedes subir a tu carpeta y leer tus archivos', async () => {
    await put(A, `${A}/foto.webp`)
    await expect(put(B, `${A}/intruso.webp`)).rejects.toThrow(/row-level security/)
    const theirs = await as(B, (tx) => tx.query(`select name from storage.objects`))
    expect(theirs.rows).toHaveLength(0)
    const mine = await as(A, (tx) => tx.query(`select name from storage.objects`))
    expect(mine.rows).toHaveLength(1)
    const del = await as(B, (tx) => tx.query(`delete from storage.objects where name = $1`, [`${A}/foto.webp`]))
    expect(del.affectedRows ?? 0).toBe(0)
  })
  it('el bucket es privado', async () => {
    const r = await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'attachments'`)
    expect(r.rows[0].public).toBe(false)
  })
})

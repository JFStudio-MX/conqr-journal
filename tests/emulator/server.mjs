/**
 * Emulador local de Supabase PARA PRUEBAS (no es parte de la app).
 *
 * Ejecuta la migración real (supabase/migrations/*.sql) en PGlite (Postgres compilado a WASM)
 * y expone el subconjunto de la API HTTP que usa supabase-js en la app:
 *   - Auth (GoTrue): token con contraseña, refresh, user, logout.
 *   - REST (PostgREST): GET /rest/v1/records (filtro por server_seq) y POST /rest/v1/rpc/push_changes.
 *   - Storage: subir, descargar y borrar objetos en el bucket privado.
 * Cada petición corre con el rol `authenticated` o `anon` y los claims del JWT, así que
 * las políticas RLS reales de la migración son las que deciden el acceso.
 *
 * Uso: node tests/emulator/server.mjs [puerto]
 */
import http from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac, randomUUID, randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const PORT = Number(process.argv[2] || process.env.EMULATOR_PORT || 54399)
const SECRET = 'emulator-test-secret'

export async function createDb() {
  const db = new PGlite()
  await db.exec(readFileSync(join(here, 'supabase-stubs.sql'), 'utf8'))
  const dir = join(root, 'supabase', 'migrations')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'))
  return db
}

const b64url = (b) => Buffer.from(b).toString('base64url')
function signJwt(payload) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const p = b64url(JSON.stringify(payload))
  const s = createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')
  return `${h}.${p}.${s}`
}
function verifyJwt(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const s = createHmac('sha256', SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url')
  if (s !== parts[2]) return null
  const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  if (p.exp && p.exp < Date.now() / 1000) return null
  return p
}

export async function startEmulator(port = PORT) {
  const db = await createDb()
  const users = new Map() // email -> { id, email, password }
  const refresh = new Map() // token -> userId
  const files = new Map() // bucket/name -> { bytes, mime }
  let queue = Promise.resolve()
  const serial = (fn) => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }
  /** Ejecuta fn dentro de una transacción con el rol y los claims del solicitante. */
  const asRequester = (claims, fn) =>
    serial(() =>
      db.transaction(async (tx) => {
        await tx.query(`set local role ${claims ? 'authenticated' : 'anon'}`)
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role: 'anon' })])
        return fn(tx)
      }),
    )

  const userJson = (u) => ({
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: u.created_at,
    updated_at: u.created_at,
  })
  const session = (u) => {
    const now = Math.floor(Date.now() / 1000)
    // Vida larga en el servidor; el cliente calcula expires_at con SU reloj (las pruebas
    // de zona horaria adelantan el reloj del navegador).
    const access_token = signJwt({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 30 * 86400, session_id: randomUUID() })
    const refresh_token = randomBytes(16).toString('hex')
    refresh.set(refresh_token, u.id)
    return { access_token, token_type: 'bearer', expires_in: 3600, refresh_token, user: userJson(u) }
  }

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '*'
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': req.headers['access-control-request-headers'] || '*',
      'access-control-expose-headers': 'content-range, content-type',
    }
    const send = (status, body, headers = {}) => {
      const isBuf = Buffer.isBuffer(body)
      res.writeHead(status, { ...cors, ...(isBuf ? {} : { 'content-type': 'application/json' }), ...headers })
      res.end(isBuf ? body : body === undefined ? '' : JSON.stringify(body))
    }
    if (req.method === 'OPTIONS') return send(204)
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks)
    const url = new URL(req.url, `http://localhost:${port}`)
    const path = url.pathname
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    const claims = auth ? verifyJwt(auth) : null
    const json = () => (raw.length ? JSON.parse(raw.toString()) : {})
    const pgError = (e) => {
      const code = e.code || 'XX000'
      const status = code === '42501' ? (claims ? 403 : 401) : code === '23505' ? 409 : 400
      return send(status, { code, message: e.message, details: null, hint: null })
    }
    try {
      // ------------------------------------------------ admin (solo pruebas)
      if (path === '/__admin/users' && req.method === 'POST') {
        const { email, password } = json()
        if (users.has(email)) return send(200, { id: users.get(email).id })
        const u = { id: randomUUID(), email, password, created_at: new Date().toISOString() }
        await serial(() => db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, email]))
        users.set(email, u)
        return send(200, { id: u.id })
      }
      if (path === '/__admin/health') return send(200, { ok: true })
      // ------------------------------------------------ auth
      if (path === '/auth/v1/token' && req.method === 'POST') {
        const grant = url.searchParams.get('grant_type')
        const body = json()
        if (grant === 'password') {
          const u = users.get(body.email)
          if (!u || u.password !== body.password) return send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials', error: 'invalid_grant', error_description: 'Invalid login credentials' })
          return send(200, session(u))
        }
        if (grant === 'refresh_token') {
          const uid = refresh.get(body.refresh_token)
          const u = [...users.values()].find((x) => x.id === uid)
          if (!u) return send(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token', error: 'invalid_grant' })
          refresh.delete(body.refresh_token)
          return send(200, session(u))
        }
        return send(400, { msg: 'unsupported grant' })
      }
      if (path === '/auth/v1/user' && req.method === 'GET') {
        if (!claims) return send(401, { code: 401, msg: 'invalid JWT' })
        const u = [...users.values()].find((x) => x.id === claims.sub)
        return u ? send(200, userJson(u)) : send(404, { msg: 'User not found' })
      }
      if (path === '/auth/v1/logout') return send(204)
      // ------------------------------------------------ rest
      if (path === '/rest/v1/records' && req.method === 'GET') {
        const allowed = ['collection', 'id', 'version', 'data', 'deleted', 'mutation_id', 'client_updated_at', 'server_created_at', 'server_updated_at', 'server_seq', 'user_id']
        const cols = (url.searchParams.get('select') || '*').split(',').map((c) => c.trim())
        if (cols.some((c) => c !== '*' && !allowed.includes(c))) return send(400, { code: 'PGRST100', message: 'bad select' })
        const gt = /^gt\.(\d+)$/.exec(url.searchParams.get('server_seq') || 'gt.0')
        const limit = Math.min(1000, Number(url.searchParams.get('limit') || 1000))
        const r = await asRequester(claims, (tx) => tx.query(`select ${cols.join(',')} from public.records where server_seq > $1 order by server_seq asc limit ${limit}`, [gt ? Number(gt[1]) : 0]))
        return send(200, r.rows.map((row) => ({ ...row, server_seq: row.server_seq === undefined ? undefined : Number(row.server_seq) })))
      }
      if (path === '/rest/v1/rpc/push_changes' && req.method === 'POST') {
        const { changes } = json()
        const r = await asRequester(claims, (tx) => tx.query('select public.push_changes($1::jsonb) as r', [JSON.stringify(changes)]))
        const out = r.rows[0].r.map((x) => ({ ...x, row: { ...x.row, server_seq: Number(x.row.server_seq) } }))
        return send(200, out)
      }
      // ------------------------------------------------ storage
      const m = /^\/storage\/v1\/object\/(?:authenticated\/)?([^/]+)(?:\/(.+))?$/.exec(path)
      if (m) {
        const bucket = decodeURIComponent(m[1])
        const name = m[2] ? decodeURIComponent(m[2]) : ''
        const storageErr = (status, message) => send(status, { statusCode: String(status), error: status === 404 ? 'not_found' : 'Unauthorized', message })
        if (req.method === 'POST' && name) {
          let bytes = raw
          let mime = req.headers['content-type'] || 'application/octet-stream'
          if (/multipart\/form-data/.test(mime)) {
            const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': mime }, body: raw }).formData()
            const file = [...form.values()].find((v) => typeof v === 'object')
            if (!file) return storageErr(400, 'no file')
            bytes = Buffer.from(await file.arrayBuffer())
            mime = file.type || 'application/octet-stream'
          }
          const b = await serial(() => db.query('select file_size_limit, allowed_mime_types from storage.buckets where id = $1', [bucket]))
          const lim = b.rows[0]
          if (!lim) return storageErr(404, 'Bucket not found')
          if (lim.file_size_limit && bytes.length > Number(lim.file_size_limit)) return storageErr(413, 'The object exceeded the maximum allowed size')
          if (lim.allowed_mime_types && !lim.allowed_mime_types.includes(mime)) return storageErr(415, `mime type ${mime} is not supported`)
          const upsert = req.headers['x-upsert'] === 'true'
          try {
            await asRequester(claims, (tx) =>
              tx.query(
                upsert
                  ? `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, auth.uid(), auth.uid()::text, $3)
                     on conflict (bucket_id, name) do update set updated_at = now(), metadata = excluded.metadata`
                  : `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, auth.uid(), auth.uid()::text, $3)`,
                [bucket, name, JSON.stringify({ mimetype: mime, size: bytes.length })],
              ),
            )
          } catch (e) {
            return storageErr(e.code === '23505' ? 409 : 403, e.message)
          }
          files.set(`${bucket}/${name}`, { bytes, mime })
          return send(200, { Key: `${bucket}/${name}`, Id: randomUUID() })
        }
        if (req.method === 'GET' && name) {
          const r = await asRequester(claims, (tx) => tx.query('select name from storage.objects where bucket_id = $1 and name = $2', [bucket, name]))
          const f = files.get(`${bucket}/${name}`)
          if (!r.rows.length || !f) return storageErr(400, 'Object not found')
          return send(200, f.bytes, { 'content-type': f.mime })
        }
        if (req.method === 'DELETE' && !name) {
          const { prefixes = [] } = json()
          const r = await asRequester(claims, (tx) => tx.query('delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name', [bucket, prefixes]))
          for (const row of r.rows) files.delete(`${bucket}/${row.name}`)
          return send(200, r.rows.map((row) => ({ name: row.name })))
        }
      }
      return send(404, { message: `No route ${req.method} ${path}` })
    } catch (e) {
      return pgError(e)
    }
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return { server, db, port, close: () => new Promise((r) => server.close(r)) }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startEmulator().then(({ port }) => console.log(`Emulador Supabase listo en http://127.0.0.1:${port}`))
}

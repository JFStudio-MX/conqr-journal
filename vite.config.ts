import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'

/**
 * Genera sw.js con la lista de archivos del build (precache del "app shell")
 * e inyecta una Content-Security-Policy estricta en index.html (solo en build).
 * Sin dependencias extra: la app no hace peticiones a terceros salvo a tu Supabase.
 */
function pwaAndCsp(supabaseUrl: string): Plugin {
  return {
    name: 'conqr-pwa-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const connect = ["'self'", supabaseUrl].filter(Boolean).join(' ')
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "font-src 'self'",
        `connect-src ${connect}`,
        "worker-src 'self'",
        "manifest-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join('; ')
      return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${csp}" />`)
    },
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => {
        if (f.endsWith('.map')) return false
        // Solo los subconjuntos de fuentes que usa el español (latin y latin-ext).
        if (f.endsWith('.woff2') || f.endsWith('.woff')) return /latin/.test(f)
        return true
      })
      const statics = [
        './',
        './index.html',
        './manifest.webmanifest',
        './theme-init.js',
        './icons/icon.svg',
        './icons/icon-192.png',
        './icons/icon-512.png',
        './icons/apple-touch-icon.png',
      ]
      const assets = [...statics, ...files.filter((f) => f !== 'index.html').map((f) => './' + f)]
      const hash = createHash('sha256').update(assets.join('|') + Date.now()).digest('hex').slice(0, 10)
      const sw = SW_TEMPLATE.replace('__CACHE__', `conqr-shell-${hash}`).replace('__ASSETS__', JSON.stringify(assets))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw })
    },
  }
}

const SW_TEMPLATE = `/* CONQR Journal · service worker: solo guarda el "app shell", nunca datos del diario. */
const CACHE = '__CACHE__';
const ASSETS = __ASSETS__;
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('conqr-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase y cualquier API: siempre red, nunca caché.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(req); }
      catch { const c = await caches.open(CACHE); return (await c.match('./index.html')) || (await c.match('./')) || Response.error(); }
    })());
    return;
  }
  event.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && url.pathname.includes('/assets/')) c.put(req, res.clone());
    return res;
  })());
});
`

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const port = Number(process.env.PORT || 5180)
  return {
    base: process.env.BASE_PATH || './',
    plugins: [react(), tailwindcss(), pwaAndCsp(supabaseUrl)],
    // Puerto fijo: IndexedDB pertenece al "origen" (host + puerto). Si el puerto cambiara,
    // la caché local de este dispositivo parecería vacía.
    server: { port, strictPort: true },
    preview: { port, strictPort: true },
    build: { outDir: process.env.OUT_DIR || 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  }
})

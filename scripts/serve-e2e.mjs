// Compila la app para pruebas (apuntando al emulador local) y la sirve en :5190.
// Solo para pruebas automatizadas: el build normal no incluye estos ganchos.
import { build, preview } from 'vite'

process.env.VITE_SUPABASE_URL = process.env.E2E_SUPABASE_URL || 'http://127.0.0.1:54399'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_emulator'
process.env.VITE_E2E = '1'
process.env.OUT_DIR = 'dist-e2e'
process.env.PORT = '5190'

await build({ logLevel: 'warn' })
const server = await preview({ preview: { port: 5190, strictPort: true }, build: { outDir: 'dist-e2e' } })
server.printUrls()

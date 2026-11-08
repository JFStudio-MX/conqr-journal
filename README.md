# CONQR Journal

Diario personal de trabajo, aprendizaje y crecimiento de Joshua en Conqr (Arte Digital, equipo ROJO).
Registra tu día en un minuto desde el celular o la computadora y encuentra los mismos datos en todos tus dispositivos.

- **Hoy**: registro rápido, llegada (“Ya llegué”), nueva junta, tus pendientes, resumen de la semana y siguiente paso.
- **Diario**: registros, juntas y proyectos (con su registro de cambios), búsqueda y filtros.
- **Progreso**: actividad por semana, registros por proyecto o marca, habilidades practicadas, objetivos, revisión semanal y puntualidad con bonos por etapas.
- **Mi revisión**: borrador trazable para conversaciones de crecimiento y sueldo; Markdown e impresión a PDF.

---

## 1. Estado actual (honesto)

| Qué | Estado |
|---|---|
| App completa en este equipo | ✅ Funciona (`npm run dev` o `iniciar.bat`). Sin Supabase configurado, entra en **modo local**: los datos se guardan solo en ese navegador. La app lo indica con un aviso visible. |
| Cuenta, sincronización, adjuntos privados | ✅ Implementado y probado contra un **emulador local** que ejecuta la migración real de Supabase (Postgres + RLS) en PGlite. ⏳ **Falta tu proyecto real de Supabase** (pasos en la sección 3). |
| Dirección web con HTTPS | ⏳ Preparado (GitHub Pages + workflow), **no publicado**. Necesita tu confirmación (sección 4). |
| Safari (macOS/iOS) | ⚠️ No se pudo probar aquí: el motor WebKit de Playwright no arranca en este Windows. El código evita APIs no compatibles; falta probar en tu iPhone o Mac (lista en la sección 7). |

Hasta configurar Supabase y publicar, **el acceso multidispositivo no está activo**: el modo local no sincroniza.

---

## 2. Ejecutar en Windows

Requisitos: [Node.js](https://nodejs.org) 22.12 o superior (ya tienes la 24).

```powershell
cd "C:\Users\Joshy\Music\OTRO JOSH\conqr-journal"
npm install
npm run dev
```

Abre <http://localhost:5180>. También puedes hacer doble clic en **`iniciar.bat`** (compila y abre el navegador).

> El puerto es fijo a propósito: el navegador guarda los datos por dirección. Si abrieras la app en otro puerto, parecería vacía.

Para usar tu cuenta en local, crea `.env.local` (copia de `.env.example`) con la URL y la clave publicable de Supabase y vuelve a ejecutar.

---

## 3. Configurar la cuenta (Supabase, plan gratuito)

Verificado en noviembre de 2026: el plan Free incluye 500 MB de base de datos, 1 GB de almacenamiento y 5 GB de transferencia. **Un proyecto gratuito se pausa tras ~1 semana sin actividad.** Usándolo a diario no ocurre; si se pausa, tus datos se conservan y se reactiva desde el panel. El plan Pro (US$25/mes) no se pausa. No es necesario contratar nada.

1. Crea una cuenta en <https://supabase.com> y un proyecto nuevo (región: la más cercana, p. ej. *East US*). Guarda la contraseña de la base de datos.
2. **SQL Editor → New query**: pega el contenido de `supabase/migrations/20261107000000_conqr_journal_init.sql` y pulsa **Run**. Crea la tabla, las políticas RLS, la función de sincronización y el bucket privado `attachments`.
3. **Authentication → Users → Add user → Create new user**: tu correo y una contraseña, con *Auto Confirm User* activado.
4. **Authentication → Sign In / Providers**: desactiva **“Allow new users to sign up”**. Así nadie más puede crear cuentas.
5. **Project Settings → API Keys**: copia la **Project URL** y la **Publishable key** (`sb_publishable_…`).
   ⚠️ No copies la *secret key* ni la *service_role*: saltan RLS y nunca deben ir en la app.
6. Ponlas en `.env.local` (para uso local) y en las variables del repositorio (para publicar).

---

## 4. Publicar con HTTPS (GitHub Pages)

Tu GitHub CLI ya tiene sesión (`JFStudio-MX`). El código de la interfaz puede ser público; tus datos siguen protegidos por la sesión y RLS.

```powershell
cd "C:\Users\Joshy\Music\OTRO JOSH\conqr-journal"
git init -b main
git add .
git commit -m "CONQR Journal"
gh repo create conqr-journal --public --source . --push
gh variable set VITE_SUPABASE_URL --body "https://TU-PROYECTO.supabase.co"
gh variable set VITE_SUPABASE_PUBLISHABLE_KEY --body "sb_publishable_..."
```

Después, en GitHub: **Settings → Pages → Source: GitHub Actions**. Cada `git push` ejecuta las pruebas y publica en
`https://jfstudio-mx.github.io/conqr-journal/`.

Para instalarla: en Android (Chrome) usa el menú ⋮ → *Instalar app*; en iPhone (Safari), *Compartir → Agregar a inicio*; en Windows (Chrome o Edge), el ícono de instalar en la barra de direcciones; en Mac (Safari), *Archivo → Agregar al Dock*. También funciona sin instalar nada.

---

## 5. Respaldo y sincronización, en simple

- **Sincronización** mantiene iguales tus dispositivos. Cada cambio se guarda primero en el dispositivo (“Guardado en este dispositivo”) y luego se sube. Solo dice **“Sincronizado”** cuando el servidor lo confirma. Sin internet queda “Pendiente de sincronizar” y se sube al volver la conexión o al reabrir la app.
- **Conflictos**: si editas lo mismo en dos dispositivos, nada se sobrescribe. Verás ambas versiones y eliges una, la otra o *conservar ambas*.
- **Borrados**: se propagan, y un dispositivo desconectado no los revive al reconectarse.
- **Respaldo** es otra cosa: un archivo `.json` que descargas en **Ajustes → Respaldo**. Incluye todo: registros, juntas, asistencia, ajustes y **las capturas**. Sirve por si borras algo por error, porque la sincronización también borraría esa información en todos tus dispositivos.
- **Importar** valida el archivo, muestra una vista previa y detecta duplicados por identificador. Puedes *combinar* o *reemplazar* (esto último con confirmación). Es todo o nada: si falla, tus datos quedan como estaban.
- **Cerrar sesión** borra la copia local de ese dispositivo y te avisa antes si hay cambios sin subir.

---

## 6. Pruebas

```powershell
npm test            # 37 pruebas: fechas, métricas, asistencia, revisión, respaldo, juntas y RLS de la migración real
npm run test:e2e    # 19 pruebas en Chrome con dos sesiones (celular emulado + escritorio) contra el emulador
npm run build       # verificación de tipos + build de producción
```

`npm run test:e2e` levanta solo el emulador (`tests/emulator/server.mjs`). Este emulador ejecuta **la misma migración SQL** con RLS en PGlite y reproduce las rutas HTTP que usa supabase-js (auth, REST y storage). Las pruebas de aceptación multidispositivo pasan contra él. Aun así, conviene repetir la lista de la sección 7 en tu proyecto real.

---

## 7. Pendiente y limitaciones

- [ ] Crear el proyecto de Supabase y la cuenta (sección 3).
- [ ] Publicar (sección 4) y probar en dispositivos reales: crear un registro en el celular y verlo en la PC; editar en la PC y verlo en el celular; registrar sin conexión y reabrir; subir una captura y abrirla en otro dispositivo.
- [ ] Safari en iPhone/Mac: probar inicio de sesión, registro sin conexión, capturas (las fotos HEIC de iPhone se convierten al elegirlas) e “Agregar a inicio”. En iOS, si no abres la app en 7 días, Safari puede borrar la copia local; tu cuenta conserva lo sincronizado.
- La actualización entre dispositivos ocurre al guardar, al volver a la app, al recuperar conexión y cada 30 s con la app abierta. No hay sincronización en segundo plano ni tiempo real instantáneo.
- La extracción de juntas es **por reglas**, sin IA: detecta secciones con título (Decisiones, Acciones/Próximos pasos, Preguntas, Materiales, Ideas, Cambios, Objetivo) y prefijos (“Acción:”, “Cambio:”…). Todo entra como “Por revisar”. Una futura extracción con IA debe usar un proveedor aprobado y mostrar propuestas antes de guardar.
- Las reglas del bono de puntualidad están **por confirmar**: no se muestran montos acumulados ni elegibilidad. Es un registro personal y no sustituye el control oficial.
- Los campos de sueldo se guardan **solo en el dispositivo** salvo que actives su sincronización. No aparecen en exportaciones salvo que los marques.

---

## 8. Estructura

```
src/
  app/          sesión y modo (cuenta/local/demo), datos reactivos, rutas, respaldo, tema
  db/           modelo, IndexedDB (Dexie) con metadatos de sincronización, escrituras, datos iniciales y demo
  sync/         cliente Supabase y motor de sincronización (cola persistente, versiones, conflictos)
  lib/          lógica pura: fechas CDMX, métricas, asistencia, revisión, respaldo, juntas, imágenes
  components/   interfaz (registro rápido, hojas, juntas, progreso, sincronización)
  screens/      Hoy, Diario, Progreso, Mi revisión, Ajustes, Entrar
supabase/migrations/   esquema, RLS, push_changes y bucket privado
tests/          unit (Vitest), e2e (Playwright), emulator (PGlite)
```

Dependencias de la app: React, Dexie, supabase-js, Radix (diálogos y menús accesibles), Lucide, Tailwind y fuentes locales (Fraunces y Geist). No hay analítica, rastreo ni llamadas a servicios de IA. Las gráficas son HTML accesible propio (sin Recharts): se usan con toques y teclado y tienen vista de tabla.

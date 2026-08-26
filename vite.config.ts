import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as { version: string }

// Repo-tracked overlay library. The desktop app reaches this directory through
// the filesystem (dev: directly; packaged Linux: via electron-builder
// `extraResources` -> resources/kml-seed); the browser has no filesystem, so
// the plugin below hands it the same files over HTTP.
const KML_SOURCE_DIR = fileURLToPath(new URL('./KML-KMZ', import.meta.url))
const KML_ROUTE = '/kml-library/'
const KML_OUTPUT_DIR = 'kml-library'
const KML_MANIFEST = 'index.json'

interface BundledKmlEntry {
  name: string
  bytes: number
  modifiedAt: number
  kind: 'kml'
}

// Only plain .kml is listed: KMZ is a zip, and the browser build has no
// unzipper (App.tsx sends KMZ import down the Electron-only path). This also
// matches `seedKmlLibrary`, whose filter is .kml-only.
function listBundledKml(): BundledKmlEntry[] {
  if (!existsSync(KML_SOURCE_DIR)) return []
  return readdirSync(KML_SOURCE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.kml'))
    .map((entry) => {
      const stats = statSync(path.join(KML_SOURCE_DIR, entry.name))
      return { name: entry.name, bytes: stats.size, modifiedAt: stats.mtimeMs, kind: 'kml' as const }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Serves `KML-KMZ/` to the browser build at `kml-library/`, both from the dev
 * server and as real files copied into the build output. The renderer reads
 * `kml-library/index.json` to discover what shipped.
 *
 * The copied files are deliberately kept out of the desktop installers by the
 * `!dist/kml-library/**` negation in package.json `build.files` — bundling the
 * 23 MB overlay into every installer is what the lazy-load change removed.
 * Linux gets its copy through `linux.extraResources` instead.
 */
function bundledKmlLibrary(): Plugin {
  let outDir = fileURLToPath(new URL('./dist', import.meta.url))
  return {
    name: 'jddc-bundled-kml-library',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [requestUrl = ''] = (req.url ?? '').split('?')
        if (!requestUrl.startsWith(KML_ROUTE)) return next()
        const requested = decodeURIComponent(requestUrl.slice(KML_ROUTE.length))
        if (requested === KML_MANIFEST) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(listBundledKml()))
          return
        }
        // The route is a static file mount, so a name that is not a bare
        // filename can only be a traversal attempt.
        if (!requested || path.basename(requested) !== requested) {
          res.statusCode = 400
          res.end('Invalid overlay name')
          return
        }
        const filePath = path.join(KML_SOURCE_DIR, requested)
        if (!existsSync(filePath)) {
          res.statusCode = 404
          res.end('Overlay not found')
          return
        }
        res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8')
        createReadStream(filePath).pipe(res)
      })
    },
    closeBundle() {
      const entries = listBundledKml()
      const targetDir = path.join(outDir, KML_OUTPUT_DIR)
      mkdirSync(targetDir, { recursive: true })
      for (const entry of entries) {
        copyFileSync(path.join(KML_SOURCE_DIR, entry.name), path.join(targetDir, entry.name))
      }
      writeFileSync(path.join(targetDir, KML_MANIFEST), JSON.stringify(entries))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Electron loads the packaged renderer with file://. Relative assets keep
  // the module/CSS URLs inside app.asar/dist instead of resolving from C:/.
  base: './',
  plugins: [react(), bundledKmlLibrary()],
  // Single source of truth for the version string embedded in project
  // manifests, HTML reports, and diagnostic bundles — previously hand-typed
  // in three places in ProjectPanel.tsx and drifted from package.json.
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
})

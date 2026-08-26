// Browser-side access to the overlay library baked into the web build. The
// desktop app reads the same files off disk (Electron's persistent KML/KMZ
// library, seeded from `resources/kml-seed` on Linux); the browser has no
// filesystem, so `vite.config.ts`'s `jddc-bundled-kml-library` plugin serves
// them at `kml-library/` — from `KML-KMZ/` on the dev server, and from real
// copies in the build output for a deployed web build.
import type { KmlLibraryEntry } from '../types/desktop'

const KML_LIBRARY_ROUTE = 'kml-library/'

// React's StrictMode mounts effects twice in development, so the auto-load
// effect runs, is cancelled, and runs again — without these caches that is two
// full downloads of a 23 MB overlay. In-flight requests are shared; the text
// cache is released once it settles so the (large) string is not retained here
// on top of the copy the caller keeps in component state.
let manifestRequest: Promise<KmlLibraryEntry[]> | null = null
const textRequests = new Map<string, Promise<string>>()

// `base: './'` means the app can be served from any subdirectory, so overlay
// URLs have to resolve against the document rather than the server root.
function bundledOverlayUrl(fileName: string): string {
  return new URL(`${KML_LIBRARY_ROUTE}${encodeURIComponent(fileName)}`, document.baseURI).toString()
}

/**
 * Lists the overlays baked into this build. Returns `[]` rather than throwing
 * when no manifest shipped — a build made without the plugin, or a desktop
 * build, is a normal state, not an error.
 */
export function listBundledWebOverlays(): Promise<KmlLibraryEntry[]> {
  manifestRequest ??= fetchManifest().catch((error: unknown) => {
    manifestRequest = null
    throw error
  })
  return manifestRequest
}

export function readBundledWebOverlayText(fileName: string): Promise<string> {
  const pending = textRequests.get(fileName)
  if (pending) return pending
  const request = fetchOverlayText(fileName).finally(() => {
    textRequests.delete(fileName)
  })
  textRequests.set(fileName, request)
  return request
}

async function fetchManifest(): Promise<KmlLibraryEntry[]> {
  const response = await fetch(new URL(`${KML_LIBRARY_ROUTE}index.json`, document.baseURI).toString())
  if (!response.ok) return []
  const manifest: unknown = await response.json()
  if (!Array.isArray(manifest)) return []
  return manifest.filter(isKmlLibraryEntry)
}

async function fetchOverlayText(fileName: string): Promise<string> {
  const response = await fetch(bundledOverlayUrl(fileName))
  if (!response.ok) throw new Error(`${fileName} could not be fetched (HTTP ${response.status})`)
  return response.text()
}

function isKmlLibraryEntry(value: unknown): value is KmlLibraryEntry {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.name === 'string'
    && candidate.name.length > 0
    && typeof candidate.bytes === 'number'
    && typeof candidate.modifiedAt === 'number'
    && (candidate.kind === 'kml' || candidate.kind === 'kmz')
}

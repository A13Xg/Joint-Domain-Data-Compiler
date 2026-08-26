import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const {
  DEV_ORIGIN,
  IPC_CHANNELS,
  MAX_ARCHIVE_FILE_BYTES,
  MAX_DIAGNOSTIC_BUNDLE_BYTES,
  MAX_KML_LIBRARY_BYTES,
  diagnosticBundleText,
  ipcBytes,
  isAllowedAppUrl,
  resolveLibraryPath,
  safeArchiveName,
  safeLibraryName,
} = createRequire(import.meta.url)(resolve(process.cwd(), 'electron/security.cjs'))

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}
function rejects(fn: () => unknown): boolean {
  try { fn(); return false } catch { return true }
}

check('IPC channel names are unique', new Set(Object.values(IPC_CHANNELS)).size === Object.keys(IPC_CHANNELS).length)
check('IPC surface exposes only the expected nine operations', Object.keys(IPC_CHANNELS).sort().join(',') === 'archiveFile,list,readText,remove,reseed,reveal,revealArchive,save,saveDiagnostics')
check('Exact development origin is allowed', isAllowedAppUrl(DEV_ORIGIN, true))
check('Development origin paths are allowed', isAllowedAppUrl(`${DEV_ORIGIN}/index.html`, true))
check('Lookalike development origins are blocked', !isAllowedAppUrl(`${DEV_ORIGIN}.attacker.invalid`, true))
const packagedRendererUrl = 'file:///opt/jddc/dist/index.html'
check('Packaged renderer URL is allowed', isAllowedAppUrl(packagedRendererUrl, false, packagedRendererUrl))
check('Other packaged file URLs are blocked', !isAllowedAppUrl('file:///tmp/attacker.html', false, packagedRendererUrl))
check('Packaged web navigation is blocked', !isAllowedAppUrl('https://example.test', false))

check('Valid KML filename is preserved', safeLibraryName('Track 1.kml') === 'Track 1.kml')
check('Traversal is reduced to a basename', safeLibraryName('../../track.kmz') === 'track.kmz')
check('Unsupported library extension is rejected', rejects(() => safeLibraryName('track.txt')))
check('Non-string library filename is rejected', rejects(() => safeLibraryName({})))
const libraryDirectory = resolve(process.cwd(), '.test-build', 'jddc-library')
check('Resolved library path remains inside its directory', resolveLibraryPath(libraryDirectory, '../track.kml') === join(libraryDirectory, 'track.kml'))
check('Sibling path prefix traversal is reduced into the library', resolveLibraryPath(libraryDirectory, '../jddc-library-escape/track.kml') === join(libraryDirectory, 'track.kml'))

check('Archived filename is reduced to a sanitized basename', safeArchiveName('../../track 1.csv') === 'track 1.csv')
check('Empty archived filename falls back to a safe default', safeArchiveName('') === 'file')
check('Non-string archive filename is rejected', rejects(() => safeArchiveName({})))

const mainProcessSource = readFileSync(resolve(process.cwd(), 'electron/main.cjs'), 'utf8')
check('Desktop app removes Electron default menu bar', /Menu\.setApplicationMenu\(null\)/.test(mainProcessSource))
check('KMZ decompression has a bounded output limit', mainProcessSource.includes('inflateRawSync(payload, { maxOutputLength: MAX_KML_LIBRARY_BYTES })'))
check('Bundled seed reset has an explicit IPC handler', mainProcessSource.includes('IPC_CHANNELS.reseed') && mainProcessSource.includes('seedKmlLibrary(kmlSeedDirectory(), dir)'))
check('File archive registers its IPC handlers at startup', mainProcessSource.includes('registerFileArchiveIpc()'))
check('File archive writes are size-bounded', mainProcessSource.includes('ipcBytes(bytes, MAX_ARCHIVE_FILE_BYTES)'))
check('File archive prunes oldest entries after every write', mainProcessSource.includes('pruneFileArchiveDir(dir, MAX_ARCHIVE_TOTAL_BYTES)'))

// preload.cjs runs under webPreferences.sandbox: true (set in main.cjs), whose
// restricted module loader only resolves 'electron' and Node built-ins — a
// relative require('./security.cjs') throws "module not found" there even
// though the identical require works in the unsandboxed main process. That
// failure aborts the whole preload script, so window.jointDomainCompiler is
// never exposed and the persistent KML/KMZ library silently looks
// unavailable. Guard against reintroducing it, and against the inlined
// channel names drifting from security.cjs's copy.
const preloadSource = readFileSync(resolve(process.cwd(), 'electron/preload.cjs'), 'utf8')
check('Preload script requires only electron, not local sibling files', !/require\(['"]\.\//.test(preloadSource))
for (const [key, value] of Object.entries(IPC_CHANNELS)) {
  check(`Preload IPC channel '${key}' matches security.cjs`, new RegExp(`${key}:\\s*'${value}'`).test(preloadSource))
}

check('ArrayBuffer IPC payload is accepted', ipcBytes(new Uint8Array([1, 2, 3]).buffer).equals(Buffer.from([1, 2, 3])))
check('Typed-array view bounds are preserved', ipcBytes(new Uint8Array([9, 1, 2, 8]).subarray(1, 3)).equals(Buffer.from([1, 2])))
check('Text IPC payload is rejected', rejects(() => ipcBytes('not binary')))
check('Oversized IPC payload is rejected before writing', rejects(() => ipcBytes(new Uint8Array(MAX_KML_LIBRARY_BYTES + 1))))
check('Custom IPC payload limit is honored', rejects(() => ipcBytes(new Uint8Array(10), 5)))
check('Archive file limit sits above the largest import format budget', MAX_ARCHIVE_FILE_BYTES >= 500 * 1024 * 1024)

const validDiagnosticBundle = JSON.stringify({ schemaVersion: 1, generatedAt: 1 })
check('Valid diagnostic JSON is accepted', diagnosticBundleText(validDiagnosticBundle) === validDiagnosticBundle)
check('Non-text diagnostic payload is rejected', rejects(() => diagnosticBundleText(new Uint8Array())))
check('Malformed diagnostic JSON is rejected', rejects(() => diagnosticBundleText('{')))
check('Unsupported diagnostic schema is rejected', rejects(() => diagnosticBundleText('{"schemaVersion":2,"generatedAt":1}')))
check('Oversized diagnostic bundle is rejected', rejects(() => diagnosticBundleText(JSON.stringify({
  schemaVersion: 1,
  generatedAt: 1,
  padding: 'x'.repeat(MAX_DIAGNOSTIC_BUNDLE_BYTES),
}))))

console.log(`\n${failures === 0 ? 'ALL ELECTRON INTEGRATION CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const {
  DEV_ORIGIN,
  IPC_CHANNELS,
  MAX_DIAGNOSTIC_BUNDLE_BYTES,
  MAX_KML_LIBRARY_BYTES,
  diagnosticBundleText,
  ipcBytes,
  isAllowedAppUrl,
  resolveLibraryPath,
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
check('IPC surface exposes only the expected six operations', Object.keys(IPC_CHANNELS).sort().join(',') === 'list,readText,remove,reveal,save,saveDiagnostics')
check('Exact development origin is allowed', isAllowedAppUrl(DEV_ORIGIN, true))
check('Development origin paths are allowed', isAllowedAppUrl(`${DEV_ORIGIN}/index.html`, true))
check('Lookalike development origins are blocked', !isAllowedAppUrl(`${DEV_ORIGIN}.attacker.invalid`, true))
check('Packaged file URLs are allowed', isAllowedAppUrl('file:///opt/jddc/dist/index.html', false))
check('Packaged web navigation is blocked', !isAllowedAppUrl('https://example.test', false))

check('Valid KML filename is preserved', safeLibraryName('Track 1.kml') === 'Track 1.kml')
check('Traversal is reduced to a basename', safeLibraryName('../../track.kmz') === 'track.kmz')
check('Unsupported library extension is rejected', rejects(() => safeLibraryName('track.txt')))
check('Non-string library filename is rejected', rejects(() => safeLibraryName({})))
check('Resolved library path remains inside its directory', resolveLibraryPath('/tmp/jddc-library', '../track.kml') === '/tmp/jddc-library/track.kml')

check('ArrayBuffer IPC payload is accepted', ipcBytes(new Uint8Array([1, 2, 3]).buffer).equals(Buffer.from([1, 2, 3])))
check('Typed-array view bounds are preserved', ipcBytes(new Uint8Array([9, 1, 2, 8]).subarray(1, 3)).equals(Buffer.from([1, 2])))
check('Text IPC payload is rejected', rejects(() => ipcBytes('not binary')))
check('Oversized IPC payload is rejected before writing', rejects(() => ipcBytes(new Uint8Array(MAX_KML_LIBRARY_BYTES + 1))))

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

import { parseChecksumManifest, validateReleaseFileSet } from '../scripts/verify-release-bundle.mjs'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const completeBundle = [
  'Joint Domain Data Compiler-0.2.0-Windows-x64-Setup.exe',
  'Joint Domain Data Compiler-0.2.0-Windows-x64-Portable.exe',
  'Joint Domain Data Compiler-0.2.0-linux-x86_64.AppImage',
  'joint-domain-data-compiler_0.2.0_amd64.deb',
  'Joint Domain Data Compiler-0.2.0-mac-arm64.dmg',
  'Joint Domain Data Compiler-0.2.0-mac-arm64.zip',
  'JDDC-SBOM-Linux.cdx.json',
  'JDDC-SBOM-Windows.cdx.json',
  'JDDC-SBOM-macOS.cdx.json',
  'SHA256SUMS-Windows.txt',
]

check('Complete release file set is accepted', validateReleaseFileSet(completeBundle).length === 0)
check('Missing platform artifact is rejected', validateReleaseFileSet(completeBundle.filter((name) => !name.endsWith('.dmg'))).some((error) => error.includes('macOS disk image')))
check('Duplicate artifact is rejected', validateReleaseFileSet([...completeBundle, 'duplicate.AppImage']).some((error) => error.includes('found 2')))

const hash = 'a'.repeat(64)
const parsed = parseChecksumManifest(`${hash}  artifact.exe\n${'b'.repeat(64)} *archive.zip\n`)
check('Checksum manifest parses GNU text and binary markers', parsed.get('artifact.exe') === hash && parsed.size === 2)

let unsafeRejected = false
try { parseChecksumManifest(`${hash}  ../artifact.exe\n`) } catch { unsafeRejected = true }
check('Checksum manifest rejects path traversal', unsafeRejected)

let duplicateRejected = false
try { parseChecksumManifest(`${hash}  artifact.exe\n${hash}  artifact.exe\n`) } catch { duplicateRejected = true }
check('Checksum manifest rejects duplicate entries', duplicateRejected)

console.log(`\n${failures === 0 ? 'ALL RELEASE INTEGRITY CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

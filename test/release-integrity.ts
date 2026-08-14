import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseChecksumManifest, validateReleaseFileSet, verifyReleaseBundle } from '../scripts/verify-release-bundle.mjs'

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

const releaseWorkflow = await readFile('.github/workflows/release.yml', 'utf8')
check('Prerelease tags are published as prereleases', releaseWorkflow.includes("prerelease: ${{ contains(github.ref_name, '-') }}"))
check('Release publication requires tests and audit',
  releaseWorkflow.includes('check:unit') &&
  releaseWorkflow.includes('check:web') &&
  releaseWorkflow.includes('check:e2e') &&
  releaseWorkflow.includes('npm audit --omit=dev --audit-level=high') &&
  releaseWorkflow.includes('package'))

const fixtureDirectory = await mkdtemp(join(tmpdir(), 'jddc-release-integrity-'))
try {
  const fixtureContents = new Map(completeBundle.map((name, index) => [name, `fixture-${index}`]))
  for (const [name, content] of fixtureContents) await writeFile(join(fixtureDirectory, name), content)
  const checksums = [...fixtureContents]
    .map(([name, content]) => `${createHash('sha256').update(content).digest('hex')}  ${name}`)
    .join('\n')
  await writeFile(join(fixtureDirectory, 'SHA256SUMS.txt'), `${checksums}\n`)
  check('Complete release bundle verifies checksums against files', (await verifyReleaseBundle(fixtureDirectory)).length === 0)

  await writeFile(join(fixtureDirectory, completeBundle[0]!), 'tampered')
  check('Release bundle rejects a tampered artifact', (await verifyReleaseBundle(fixtureDirectory)).some((error) => error.includes('Checksum mismatch')))
} finally {
  await rm(fixtureDirectory, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? 'ALL RELEASE INTEGRITY CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

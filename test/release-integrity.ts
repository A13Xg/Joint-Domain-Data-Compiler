import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseChecksumManifest, validateReleaseFileSet, verifyReleaseBundle } from '../scripts/verify-release-bundle.mjs'
import { ALL_PLATFORMS, DEFAULT_PLATFORMS, buildMatrix, isFullRelease, parsePlatforms, resolveVersion } from '../scripts/resolve-release-matrix.mjs'

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

// Partial releases: a single-platform run must accept its own artifacts and
// still reject a bundle that is missing one of them.
const linuxOnly = ['Joint Domain Data Compiler-0.2.0-linux-x86_64.AppImage', 'joint-domain-data-compiler_0.2.0_amd64.deb', 'JDDC-SBOM-Linux.cdx.json']
check('Linux-only bundle is accepted for a Linux-only release', validateReleaseFileSet(linuxOnly, ['linux']).length === 0)
check('Linux-only bundle is rejected for a full release', validateReleaseFileSet(linuxOnly).some((error) => error.includes('macOS disk image')))
check('Linux-only release still requires its Debian package', validateReleaseFileSet(linuxOnly.filter((name) => !name.endsWith('.deb')), ['linux']).some((error) => error.includes('Debian package')))

let unknownPlatformRejected = false
try { validateReleaseFileSet(linuxOnly, ['solaris']) } catch { unknownPlatformRejected = true }
check('Unknown platform is rejected by the verifier', unknownPlatformRejected)

// Release matrix resolution
check('Platform tags resolve to the shared version release', resolveVersion({ requestedVersion: '', refName: 'win-v0.2.0', isTag: true, packageVersion: '9.9.9' }) === '0.2.0')
check('Plain version tags resolve identically', resolveVersion({ requestedVersion: '', refName: 'v0.2.0', isTag: true, packageVersion: '9.9.9' }) === '0.2.0')
check('macOS and Linux tag prefixes are stripped', resolveVersion({ requestedVersion: '', refName: 'mac-v1.2.3', isTag: true, packageVersion: '9.9.9' }) === '1.2.3' && resolveVersion({ requestedVersion: '', refName: 'linux-v1.2.3', isTag: true, packageVersion: '9.9.9' }) === '1.2.3')
check('Prerelease suffixes survive tag resolution', resolveVersion({ requestedVersion: '', refName: 'v0.3.0-rc1', isTag: true, packageVersion: '9.9.9' }) === '0.3.0-rc1')
check('Manual dispatch falls back to package.json', resolveVersion({ requestedVersion: '', refName: 'main', isTag: false, packageVersion: '0.4.0' }) === '0.4.0')
check('Explicit version input wins and drops a leading v', resolveVersion({ requestedVersion: 'v5.6.7', refName: 'v0.2.0', isTag: true, packageVersion: '9.9.9' }) === '5.6.7')

check('Single-platform matrix builds one entry', buildMatrix(parsePlatforms('["macos"]')).length === 1)
check('Full matrix builds every platform', buildMatrix(parsePlatforms('["linux","windows","macos"]')).length === ALL_PLATFORMS.length)
check('Platform order is canonical regardless of caller order', parsePlatforms('["macos","linux"]').join(',') === 'linux,macos')
check('Matrix entries carry the runner and build command', buildMatrix(parsePlatforms('["windows"]'))[0]!.os === 'windows-latest' && buildMatrix(parsePlatforms('["windows"]'))[0]!.build_command.includes('build:desktop:win'))

let badPlatformsRejected = false
try { parsePlatforms('["freebsd"]') } catch { badPlatformsRejected = true }
check('Unknown platform is rejected by the matrix resolver', badPlatformsRejected)

let emptyPlatformsRejected = false
try { parsePlatforms('[]') } catch { emptyPlatformsRejected = true }
check('Empty platform list is rejected', emptyPlatformsRejected)

// `is_full_release` decides whether a run writes the release's canonical
// SHA256SUMS.txt or a scoped partial manifest beside it. It tracks the
// platforms a tag actually builds, so the tagged Linux+Windows release owns
// the canonical manifest and a later macOS run cannot overwrite it.
check('macOS is not built by a plain version tag', !DEFAULT_PLATFORMS.includes('macos'))
check('The default platform set counts as a full release', isFullRelease(DEFAULT_PLATFORMS))
check('An every-platform run also counts as full', isFullRelease(ALL_PLATFORMS))
check('A macOS-only run is partial, so it keeps its manifest scoped', !isFullRelease(['macos']))
check('A Linux-only run is partial', !isFullRelease(['linux']))

// Workflow wiring
const reusableWorkflow = await readFile('.github/workflows/_release.yml', 'utf8')
check('Release publication requires tests, audit, and smoke test',
  reusableWorkflow.includes('check:unit') &&
  reusableWorkflow.includes('check:web') &&
  reusableWorkflow.includes('check:e2e') &&
  reusableWorkflow.includes('check-app-health.mjs') &&
  reusableWorkflow.includes('npm audit --omit=dev --audit-level=high'))
check('Prereleases are derived from the resolved version', reusableWorkflow.includes("prerelease: ${{ contains(needs.setup.outputs.version, '-') }}"))
check('Build artifacts are retained for one day', reusableWorkflow.includes('retention-days: 1'))
check('Every platform publishes into the shared v<version> release', reusableWorkflow.includes('tag_name: v${{ needs.setup.outputs.version }}'))

const callers = [
  ['.github/workflows/release-linux.yml', '["linux"]', 'linux-v*'],
  ['.github/workflows/release-windows.yml', '["windows"]', 'win-v*'],
  ['.github/workflows/release-macos.yml', '["macos"]', 'mac-v*'],
] as const

for (const [path, platforms, tag] of callers) {
  const workflow = await readFile(path, 'utf8')
  check(`${path} delegates to the reusable release workflow`, workflow.includes('uses: ./.github/workflows/_release.yml'))
  check(`${path} requests ${platforms}`, workflow.includes(`platforms: '${platforms}'`))
  check(`${path} triggers on the ${tag} tag and on demand`, workflow.includes(`tags: ['${tag}']`) && workflow.includes('workflow_dispatch:'))
}

// release.yml is the only caller whose platform set is conditional, so it is
// checked on its own rather than through the loop above. The point of the
// condition is cost: a mac runner bills at 10x, and a `v*` tag must never
// start one unattended. Everything below asserts that a tag cannot.
const taggedRelease = await readFile('.github/workflows/release.yml', 'utf8')
const releaseCallerFiles = ['.github/workflows/release.yml', ...callers.map(([file]) => file)]
check('release.yml delegates to the reusable release workflow', taggedRelease.includes('uses: ./.github/workflows/_release.yml'))
check('release.yml triggers on the v* tag and on demand', taggedRelease.includes("tags: ['v*']") && taggedRelease.includes('workflow_dispatch:'))
check('release.yml builds Linux and Windows by default', taggedRelease.includes('\'["linux","windows"]\''))
check('release.yml adds macOS only behind the manual include_macos input', /inputs\.include_macos\s*&&\s*'\["linux","windows","macos"\]'/.test(taggedRelease))
check('A v* tag cannot request macOS unconditionally', !/platforms:\s*'\[[^\]]*macos[^\]]*\]'/.test(taggedRelease))
check('The macOS dispatch input defaults to off', /include_macos:[\s\S]*?default: false/.test(taggedRelease))

// No workflow may upload debug artifacts; the storage quota is 500 MB.
for (const path of ['.github/workflows/ci.yml', ...releaseCallerFiles]) {
  const workflow = await readFile(path, 'utf8')
  check(`${path} uploads no debug artifacts`, !workflow.includes('playwright-report') && !workflow.includes('test-results'))
}

// Actions must be pinned to immutable commit SHAs, never moving tags.
const allWorkflows = await Promise.all(
  ['.github/workflows/ci.yml', '.github/workflows/_release.yml', ...releaseCallerFiles].map((path) => readFile(path, 'utf8')),
)
const floatingTagRefs = allWorkflows.flatMap((workflow) => [...workflow.matchAll(/uses:\s+([\w-]+\/[\w-]+)@(v[\d.]+)\s*$/gm)].map((match) => `${match[1]}@${match[2]}`))
check(`All actions are pinned to a commit SHA${floatingTagRefs.length > 0 ? ` — found ${floatingTagRefs.join(', ')}` : ''}`, floatingTagRefs.length === 0)

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

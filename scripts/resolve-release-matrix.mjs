import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

// Emits GitHub Actions step outputs describing which platforms a release run
// should build and which version it publishes under. Platform tags carry the
// version (win-v0.2.0), so every run resolves to the same `v<version>` release.

const PLATFORM_CONFIG = {
  linux: {
    platform: 'linux',
    platform_name: 'Linux',
    os: 'ubuntu-latest',
    build_command: 'npm run build:desktop:linux',
    smoke_command: 'npm run check:desktop:linux',
    artifact_glob: ['release/*.AppImage', 'release/*.deb', 'release/JDDC-SBOM-Linux.cdx.json'].join('\n'),
  },
  windows: {
    platform: 'windows',
    platform_name: 'Windows',
    os: 'windows-latest',
    build_command: 'npm run build:desktop:win',
    smoke_command: 'npm run check:desktop:win',
    artifact_glob: [
      'release/*Windows*x64*Setup.exe',
      'release/*Windows*x64*Portable.exe',
      'release/SHA256SUMS-Windows.txt',
      'release/JDDC-SBOM-Windows.cdx.json',
    ].join('\n'),
  },
  macos: {
    platform: 'macos',
    platform_name: 'macOS',
    os: 'macos-latest',
    build_command: 'npm run build:desktop',
    smoke_command: 'npm run check:desktop:mac',
    artifact_glob: ['release/*.dmg', 'release/*.zip', 'release/JDDC-SBOM-macOS.cdx.json'].join('\n'),
  },
}

export const ALL_PLATFORMS = Object.keys(PLATFORM_CONFIG)

export function parsePlatforms(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`platforms input is not valid JSON: ${raw}`)
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('platforms input must be a non-empty JSON array.')
  }
  const unknown = parsed.filter((platform) => !PLATFORM_CONFIG[platform])
  if (unknown.length > 0) throw new Error(`Unknown platform(s): ${unknown.join(', ')}.`)
  // Deduplicate while preserving the canonical order so the matrix and the
  // manifest suffix are stable regardless of how the caller ordered them.
  return ALL_PLATFORMS.filter((platform) => parsed.includes(platform))
}

export function resolveVersion({ requestedVersion, refName, isTag, packageVersion }) {
  if (requestedVersion) return requestedVersion.replace(/^v/, '')
  if (isTag && refName) return refName.replace(/^(win|mac|linux)-/, '').replace(/^v/, '')
  return packageVersion
}

export function buildMatrix(platforms) {
  return platforms.map((platform) => PLATFORM_CONFIG[platform])
}

if (process.argv[1] && basename(process.argv[1]) === 'resolve-release-matrix.mjs') {
  const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
  const platforms = parsePlatforms(process.env.REQUESTED_PLATFORMS ?? '')
  const version = resolveVersion({
    requestedVersion: process.env.REQUESTED_VERSION ?? '',
    refName: process.env.REF_NAME ?? '',
    isTag: process.env.IS_TAG === 'true',
    packageVersion,
  })

  const lines = [
    `version=${version}`,
    `matrix=${JSON.stringify(buildMatrix(platforms))}`,
    `platform_csv=${platforms.join(',')}`,
    `is_full_release=${platforms.length === ALL_PLATFORMS.length}`,
  ]
  console.log(lines.join('\n'))
}

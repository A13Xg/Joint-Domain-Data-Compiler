import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const REQUIRED_ARTIFACTS = [
  { label: 'Windows installer', pattern: /Windows-x64-Setup\.exe$/ },
  { label: 'Windows portable executable', pattern: /Windows-x64-Portable\.exe$/ },
  { label: 'Linux AppImage', pattern: /\.AppImage$/ },
  { label: 'Linux Debian package', pattern: /\.deb$/ },
  { label: 'macOS disk image', pattern: /\.dmg$/ },
  { label: 'macOS zip archive', pattern: /\.zip$/ },
  { label: 'Linux SBOM', pattern: /^JDDC-SBOM-Linux\.cdx\.json$/ },
  { label: 'Windows SBOM', pattern: /^JDDC-SBOM-Windows\.cdx\.json$/ },
  { label: 'macOS SBOM', pattern: /^JDDC-SBOM-macOS\.cdx\.json$/ },
  { label: 'Windows checksum manifest', pattern: /^SHA256SUMS-Windows\.txt$/ },
]

export function validateReleaseFileSet(fileNames) {
  const errors = []
  for (const required of REQUIRED_ARTIFACTS) {
    const matches = fileNames.filter((name) => required.pattern.test(name))
    if (matches.length !== 1) {
      errors.push(`Expected exactly one ${required.label}; found ${matches.length}.`)
    }
  }
  return errors
}

export function parseChecksumManifest(text) {
  const entries = new Map()
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const match = /^([a-fA-F0-9]{64}) [ *](.+)$/.exec(line)
    if (!match) throw new Error(`Invalid checksum manifest line ${index + 1}.`)
    const name = match[2]
    if (name !== basename(name) || name === '.' || name === '..') {
      throw new Error(`Unsafe checksum filename on line ${index + 1}.`)
    }
    if (entries.has(name)) throw new Error(`Duplicate checksum entry for ${name}.`)
    entries.set(name, match[1].toLowerCase())
  }
  if (entries.size === 0) throw new Error('Checksum manifest is empty.')
  return entries
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

export async function verifyReleaseBundle(directory) {
  const absoluteDirectory = resolve(directory)
  const fileNames = (await readdir(absoluteDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
  const errors = validateReleaseFileSet(fileNames)
  const manifestName = 'SHA256SUMS.txt'
  if (!fileNames.includes(manifestName)) {
    errors.push(`Missing ${manifestName}.`)
    return errors
  }

  let entries
  try {
    entries = parseChecksumManifest(await readFile(resolve(absoluteDirectory, manifestName), 'utf8'))
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
    return errors
  }

  const expectedFiles = fileNames.filter((name) => name !== manifestName).sort()
  for (const name of expectedFiles) {
    if (!entries.has(name)) errors.push(`Checksum manifest is missing ${name}.`)
  }
  for (const name of entries.keys()) {
    if (!expectedFiles.includes(name)) errors.push(`Checksum manifest references missing file ${name}.`)
  }
  for (const [name, expectedHash] of entries) {
    if (!expectedFiles.includes(name)) continue
    if (await sha256(resolve(absoluteDirectory, name)) !== expectedHash) {
      errors.push(`Checksum mismatch for ${name}.`)
    }
  }
  return errors
}

if (process.argv[1] && basename(process.argv[1]) === 'verify-release-bundle.mjs') {
  const errors = await verifyReleaseBundle(process.argv[2] ?? 'release')
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    process.exitCode = 1
  } else {
    console.log('Release bundle contents and SHA-256 manifest verified.')
  }
}

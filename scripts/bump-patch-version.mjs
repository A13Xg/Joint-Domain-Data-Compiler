// Pre-commit hook body: auto-increments package.json's patch version unless
// the developer already changed the version as part of this commit.
//
// "Already changed" covers both a manual bump (the minor/major release
// trigger the CI auto-tag job watches for) and a merge that carried a newer
// version in from another branch -- either way the right move is to leave it
// alone, not stack an increment on top of it.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

const PKG_PATH = 'package.json'

/** Pure so it is unit-testable without touching git or the filesystem. */
export function nextPatchVersion(currentVersion) {
  const parts = currentVersion.split('.')
  if (parts.length !== 3) throw new Error(`Cannot parse version "${currentVersion}" as major.minor.patch`)
  const [major, minor, patch] = parts.map(Number)
  if (![major, minor, patch].every(Number.isInteger)) {
    throw new Error(`Cannot parse version "${currentVersion}" as major.minor.patch`)
  }
  return `${major}.${minor}.${patch + 1}`
}

function previousCommittedVersion() {
  try {
    const raw = execFileSync('git', ['show', 'HEAD:package.json'], { encoding: 'utf8' })
    return JSON.parse(raw).version
  } catch {
    return null // No prior commit (first commit in the repo) -- nothing to compare against.
  }
}

function main() {
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'))
  const previous = previousCommittedVersion()

  if (previous !== null && previous !== pkg.version) {
    console.log(`bump-patch-version: version already changed (${previous} -> ${pkg.version}), leaving it as-is`)
    return
  }

  pkg.version = nextPatchVersion(pkg.version)
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`)
  execFileSync('git', ['add', PKG_PATH])
  console.log(`bump-patch-version: ${previous ?? '(none)'} -> ${pkg.version}`)
}

if (process.argv[1] && basename(process.argv[1]) === 'bump-patch-version.mjs') main()

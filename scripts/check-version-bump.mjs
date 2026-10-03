// Decides whether a push to `main` should be auto-tagged for release.
//
// The policy: a release is never built just because main moved. It is built
// only when asked for by hand (workflow_dispatch, or pushing a `v*`/`win-v*`/
// `mac-v*`/`linux-v*` tag directly) or when the developer deliberately bumps
// the version's major or minor component -- the "manual change by the dev"
// step in the versioning scheme described in CONTRIBUTING.md. A patch-only
// change (the auto-increment every commit gets from the pre-commit hook in
// bump-patch-version.mjs) never tags, which is what keeps CI's "Quality
// Gates" and the expensive packaging workflows separate.
import { basename } from 'node:path'
import { parseVersion } from './version-format.mjs'

/**
 * @param {string | null} previousVersion package.json's version at the parent commit, or null if
 *   there isn't one (first commit, or the parent commit predates this file existing).
 * @param {string} currentVersion package.json's version at the commit being evaluated.
 */
export function shouldTagRelease(previousVersion, currentVersion) {
  if (previousVersion === null || previousVersion === currentVersion) return false
  const previous = parseVersion(previousVersion)
  const current = parseVersion(currentVersion)
  return current.major !== previous.major || current.minor !== previous.minor
}

if (process.argv[1] && basename(process.argv[1]) === 'check-version-bump.mjs') {
  const previous = process.env.PREVIOUS_VERSION ? process.env.PREVIOUS_VERSION : null
  const current = process.env.CURRENT_VERSION ?? ''
  const shouldTag = shouldTagRelease(previous, current)
  console.log(`should_tag=${shouldTag}`)
  console.log(`tag=v${current}`)
}

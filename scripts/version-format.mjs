// Shared major.minor.patch parsing for the versioning scripts
// (bump-patch-version.mjs and check-version-bump.mjs), so the two never
// drift into accepting different version shapes.
//
// A trailing pre-release/build suffix (`-rc.1`, `+build.5`) is accepted:
// `resolveVersion` in resolve-release-matrix.mjs already treats one as part
// of a valid version elsewhere in the release pipeline, so parsing here
// stays consistent with that rather than rejecting it.
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)((?:-|\+).*)?$/

/**
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number, suffix: string }}
 */
export function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version)
  if (!match) throw new Error(`Cannot parse version "${version}" as major.minor.patch`)
  const [, major, minor, patch, suffix] = match
  return { major: Number(major), minor: Number(minor), patch: Number(patch), suffix: suffix ?? '' }
}

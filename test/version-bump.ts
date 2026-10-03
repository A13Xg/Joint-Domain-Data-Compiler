// Versioning automation: the pre-commit patch auto-increment and the CI
// auto-tag decision. See scripts/bump-patch-version.mjs, scripts/check-version-bump.mjs,
// and CONTRIBUTING.md's "Versioning" section for the policy these implement.
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nextPatchVersion } from '../scripts/bump-patch-version.mjs'
import { shouldTagRelease } from '../scripts/check-version-bump.mjs'
import { configureGitHooks } from '../scripts/setup-git-hooks.mjs'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

check('Patch increments by one', nextPatchVersion('1.2.3') === '1.2.4')
check('Patch increment leaves major/minor untouched', nextPatchVersion('0.8.0') === '0.8.1')
check('Double-digit patch increments correctly', nextPatchVersion('2.0.9') === '2.0.10')
check('Pre-release suffix is preserved across a patch bump', nextPatchVersion('0.9.0-rc.1') === '0.9.1-rc.1')
check('Build-metadata suffix is preserved across a patch bump', nextPatchVersion('1.0.0+build.5') === '1.0.1+build.5')

let rejected = false
try { nextPatchVersion('1.2') } catch { rejected = true }
check('Malformed version is rejected', rejected)

check('No prior version never tags (first commit)', shouldTagRelease(null, '0.1.0') === false)
check('Unchanged version never tags', shouldTagRelease('0.8.0', '0.8.0') === false)
check('Patch-only change never tags', shouldTagRelease('0.8.0', '0.8.1') === false)
check('Minor bump tags', shouldTagRelease('0.8.4', '0.9.0') === true)
check('Major bump tags', shouldTagRelease('0.8.4', '1.0.0') === true)
check('Patch going backwards (e.g. manual revert) does not tag', shouldTagRelease('0.8.5', '0.8.1') === false)
check('Pre-release suffix is ignored when comparing major/minor', shouldTagRelease('0.8.0', '0.8.1-rc.1') === false)

// package.json's prepare script wires the hook up on every install so a
// fresh clone does not need a manual `git config` step.
{
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { scripts?: Record<string, string> }
  check('package.json prepare script installs the git hook', pkg.scripts?.prepare === 'node scripts/setup-git-hooks.mjs')
}

{
  const hook = await readFile('githooks/pre-commit', 'utf8')
  check('pre-commit hook invokes the patch bump script', hook.includes('scripts/bump-patch-version.mjs'))
}

// setup-git-hooks.mjs: must configure a real git checkout, and must not
// throw against a plain directory that has no .git at all.
{
  const gitDir = await mkdtemp(join(tmpdir(), 'jddc-git-hooks-'))
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: gitDir })
    check('configureGitHooks configures core.hooksPath inside a git repo', configureGitHooks(gitDir) === 'configured')
    const configured = execFileSync('git', ['config', 'core.hooksPath'], { cwd: gitDir, encoding: 'utf8' }).trim()
    check('core.hooksPath is set to githooks', configured === 'githooks')
  } finally {
    await rm(gitDir, { recursive: true, force: true })
  }

  const plainDir = await mkdtemp(join(tmpdir(), 'jddc-no-git-'))
  try {
    check('configureGitHooks is a no-op outside a git repo', configureGitHooks(plainDir) === 'not-a-git-repo')
  } finally {
    await rm(plainDir, { recursive: true, force: true })
  }
}

console.log(`\n${failures === 0 ? 'ALL VERSION BUMP CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

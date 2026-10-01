#!/usr/bin/env node
// Points git at the repo's own hooks directory so `githooks/pre-commit` runs
// automatically. Runs as npm's `prepare` lifecycle step, i.e. after every
// `npm install`/`npm ci`, so a fresh clone wires this up without anyone
// having to remember a manual `git config` step.
import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

/**
 * Configures `core.hooksPath` for the git repository at `cwd`. A no-op
 * outside a git checkout (e.g. when package.json is installed as a
 * dependency, or in a packaging step that only needs node_modules) --
 * `prepare` is not worth failing a build over, so this never throws.
 *
 * @param {string} cwd
 * @returns {'configured' | 'not-a-git-repo' | 'failed'}
 */
export function configureGitHooks(cwd) {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd, stdio: 'ignore' })
  } catch {
    return 'not-a-git-repo'
  }

  try {
    execFileSync('git', ['config', 'core.hooksPath', 'githooks'], { cwd })
    return 'configured'
  } catch {
    return 'failed'
  }
}

if (process.argv[1] && basename(process.argv[1]) === 'setup-git-hooks.mjs') {
  const result = configureGitHooks(process.cwd())
  if (result === 'configured') console.log('setup-git-hooks: core.hooksPath -> githooks')
  else if (result === 'failed') console.warn('setup-git-hooks: could not configure git hooks path')
}

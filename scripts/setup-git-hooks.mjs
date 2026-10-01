#!/usr/bin/env node
// Points git at the repo's own hooks directory so `githooks/pre-commit` runs
// automatically. Runs as npm's `prepare` lifecycle step, i.e. after every
// `npm install`/`npm ci`, so a fresh clone wires this up without anyone
// having to remember a manual `git config` step.
//
// Silent no-op outside a git checkout (e.g. when package.json is installed as
// a dependency, or in a packaging step that only needs node_modules) --
// `prepare` is not worth failing a build over.
import { execFileSync } from 'node:child_process'

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' })
} catch {
  process.exit(0)
}

try {
  execFileSync('git', ['config', 'core.hooksPath', 'githooks'])
  console.log('setup-git-hooks: core.hooksPath -> githooks')
} catch (error) {
  console.warn(`setup-git-hooks: could not configure git hooks path: ${error.message}`)
}

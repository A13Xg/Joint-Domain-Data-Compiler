// Tranche 8 Task 8.1: measured benchmarks at 100k/500k/1M points, covering a
// representative subset of the pipeline (dataset construction, core
// transforms, kinematics derivation, quality-event detection, GPX export).
// Not part of `npm test` — run explicitly with `npm run bench`. Prints a
// table; does not assert pass/fail (there is no established budget yet —
// this run establishes the first one).
import { mkdirSync, rmSync } from 'node:fs'
import { buildSync } from 'esbuild'

const outfile = '.test-build/benchmarks.mjs'
rmSync('.test-build', { recursive: true, force: true })
mkdirSync('.test-build', { recursive: true })

buildSync({
  entryPoints: ['benchmarks/run.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'warning',
})

const { run } = await import(`../${outfile}`)
await run()

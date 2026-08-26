import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildSync } from 'esbuild'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const testDirectory = 'test'
const outputDirectory = '.test-build/all'
const tests = readdirSync(testDirectory)
  .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
  .sort()

rmSync(outputDirectory, { recursive: true, force: true })
mkdirSync(outputDirectory, { recursive: true })

let failures = 0
for (const testFile of tests) {
  const source = join(testDirectory, testFile)
  const output = join(outputDirectory, `${basename(testFile, extname(testFile))}.mjs`)
  console.log(`\n=== ${testFile} ===`)

  try {
    buildSync({
      entryPoints: [source],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: output,
      logLevel: 'silent',
      // Mirrors vite.config.ts's `define` so test/*.tsx files that transitively
      // import components referencing __APP_VERSION__ (e.g. ProjectPanel) bundle.
      define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
      // src/**/*.tsx components rely on the automatic JSX runtime (tsconfig.app.json
      // sets "jsx": "react-jsx", same as the Vite build), so bundling test/*.tsx files
      // that import them needs to match; esbuild's own tsconfig auto-discovery only
      // reads the root tsconfig.json (no "jsx" field), which would otherwise silently
      // fall back to the classic transform and emit unresolved `React.createElement`
      // references in components that never import React.
      jsx: 'automatic',
    })
  } catch (error) {
    console.error(error)
    failures++
    continue
  }

  const run = spawnSync(process.execPath, [output], { stdio: 'inherit' })
  if (run.status !== 0) failures++
}

if (failures > 0) {
  console.error(`\n${failures} test harness(es) failed.`)
  process.exit(1)
}

console.log(`\nAll ${tests.length} test harnesses passed.`)

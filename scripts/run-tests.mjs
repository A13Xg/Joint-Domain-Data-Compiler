import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildSync } from 'esbuild'

const testDirectory = 'test'
const outputDirectory = '.test-build/all'
const tests = readdirSync(testDirectory)
  .filter((name) => name.endsWith('.ts'))
  .sort()

rmSync(outputDirectory, { recursive: true, force: true })
mkdirSync(outputDirectory, { recursive: true })

let failures = 0
for (const testFile of tests) {
  const source = join(testDirectory, testFile)
  const output = join(outputDirectory, `${basename(testFile, '.ts')}.mjs`)
  console.log(`\n=== ${testFile} ===`)

  try {
    buildSync({
      entryPoints: [source],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: output,
      logLevel: 'silent',
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

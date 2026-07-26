import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'

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

  const build = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['esbuild', source, '--bundle', '--platform=node', '--format=esm', `--outfile=${output}`],
    { stdio: 'inherit' },
  )
  if (build.status !== 0) {
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

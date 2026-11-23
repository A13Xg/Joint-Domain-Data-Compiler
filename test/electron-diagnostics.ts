// The launch log and the rendering decision in electron/diagnostics.cjs.
//
// Both exist for launches nobody can watch: a packaged Windows build has no
// console, and a GPU that wedges before first paint leaves only a process in
// Task Manager. These are exercised against real directories on disk.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const {
  LAUNCH_STATE_FILE_NAME,
  LOG_FILE_NAME,
  MAX_LOG_BYTES,
  PREVIOUS_LOG_FILE_NAME,
  createFileLog,
  decideRendering,
  mirrorConsole,
  readLaunchState,
  writeLaunchState,
} = createRequire(import.meta.url)(resolve(process.cwd(), 'electron/diagnostics.cjs'))

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const root = resolve(process.cwd(), '.test-build', 'electron-diagnostics')
rmSync(root, { recursive: true, force: true })

// --- the log file ---
{
  const dir = join(root, 'logs')
  const log = createFileLog(dir)
  check('log directory is created on demand', existsSync(dir))
  check('log reports itself available', log.available === true)
  check('log lives at <dir>/main.log', log.path === join(dir, LOG_FILE_NAME))
  log.info('first line')
  log.warn('second\nline')
  log.error('third')
  const text = readFileSync(log.path, 'utf8')
  check('lines are written synchronously, in order', /INFO\s+first line[\s\S]*WARN\s+second[\s\S]*ERROR\s+third/.test(text))
  check('each line carries a timestamp and the pid', new RegExp(`^\\d{4}-\\d{2}-\\d{2}T[^ ]+ \\[${process.pid}\\] INFO`).test(text))
  check('continuation lines stay with their entry', /\n\s+line\n/.test(text))

  const second = createFileLog(dir)
  second.info('appended')
  check('a later launch appends rather than truncating', readFileSync(log.path, 'utf8').includes('first line') && readFileSync(log.path, 'utf8').includes('appended'))
}

{
  const dir = join(root, 'rotation')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, LOG_FILE_NAME), 'x'.repeat(MAX_LOG_BYTES + 1))
  const log = createFileLog(dir)
  log.info('fresh')
  check('an oversized log is rotated at startup', existsSync(join(dir, PREVIOUS_LOG_FILE_NAME)) && statSync(join(dir, PREVIOUS_LOG_FILE_NAME)).size > MAX_LOG_BYTES)
  check('the new log starts small', statSync(log.path).size < 1024)
}

{
  // A path that cannot be a directory: a FILE sits where the directory should be.
  const blocker = join(root, 'blocked')
  mkdirSync(root, { recursive: true })
  writeFileSync(blocker, 'not a directory')
  let threw = false
  let log: { available: boolean; info: (text: string) => void } | null = null
  try {
    log = createFileLog(join(blocker, 'logs'))
    log.info('goes nowhere')
  } catch {
    threw = true
  }
  check('an unwritable log location never throws into startup', !threw)
  check('and reports itself unavailable', log?.available === false)
}

{
  const dir = join(root, 'console')
  const log = createFileLog(dir)
  const seen: string[] = []
  const target = {
    log: (...args: unknown[]) => seen.push(`log:${args.join(' ')}`),
    info: (...args: unknown[]) => seen.push(`info:${args.join(' ')}`),
    warn: (...args: unknown[]) => seen.push(`warn:${args.join(' ')}`),
    error: (...args: unknown[]) => seen.push(`error:${args.join(' ')}`),
  }
  mirrorConsole(log, target)
  target.warn('[splash] could not load', 42)
  target.error(new Error('boom'))
  const text = readFileSync(log.path, 'utf8')
  check('mirrored console calls still reach the original console', seen[0] === 'warn:[splash] could not load 42')
  check('mirrored console calls land in the log at their level', /WARN\s+\[splash\] could not load 42/.test(text))
  check('errors are logged with their stack', /ERROR\s+Error: boom\n\s+at /.test(text))
}

// --- launch state ---
{
  const dir = join(root, 'state')
  check('no state file reads as an empty state', JSON.stringify(readLaunchState(dir)) === '{}')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, LAUNCH_STATE_FILE_NAME), '{ truncated')
  check('a corrupt state file reads as an empty state', JSON.stringify(readLaunchState(dir)) === '{}')
  writeFileSync(join(dir, LAUNCH_STATE_FILE_NAME), '[1,2]')
  check('a non-object state file reads as an empty state', JSON.stringify(readLaunchState(dir)) === '{}')
  check('state round-trips', writeLaunchState(dir, { phase: 'painted', rendering: 'hardware' }) && readLaunchState(dir).phase === 'painted')
}

// --- rendering decision ---
{
  const healthy = decideRendering({ phase: 'ready', rendering: 'hardware' }, {}, [])
  check('a healthy previous launch keeps hardware rendering', healthy.software === false && healthy.remember === false)
  check('a first launch keeps hardware rendering', decideRendering({}, {}, []).software === false)

  const neverPainted = decideRendering({ phase: 'started', rendering: 'hardware', startedAt: '2026-11-23T10:00:00Z' }, {}, [])
  check('a hardware launch that never painted triggers software rendering', neverPainted.software === true)
  check('and asks to remember it once this launch succeeds', neverPainted.remember === true)
  check('and says why', /never painted/.test(neverPainted.reason ?? ''))

  check('a launch that painted and then failed is not taken as GPU evidence',
    decideRendering({ phase: 'painted', rendering: 'hardware' }, {}, []).software === false)
  check('a software launch that never painted does not loop into "remember"',
    decideRendering({ phase: 'started', rendering: 'software' }, {}, []).remember === false)

  const remembered = decideRendering({ phase: 'ready', rendering: 'software', softwareRendering: true, softwareReason: 'GPU process crashed' }, {}, [])
  check('remembered software rendering persists across healthy launches', remembered.software === true && /GPU process crashed/.test(remembered.reason ?? ''))
  check('JDDC_GPU=on overrides a remembered fallback',
    decideRendering({ softwareRendering: true }, { JDDC_GPU: 'on' }, []).software === false)
  check('JDDC_GPU=on overrides a never-painted launch',
    decideRendering({ phase: 'started', rendering: 'hardware' }, { JDDC_GPU: 'on' }, []).software === false)
  check('JDDC_GPU=off forces software', decideRendering({}, { JDDC_GPU: 'off' }, []).software === true)
  check('--disable-gpu forces software without remembering it',
    decideRendering({}, {}, ['app.exe', '--disable-gpu']).software === true && decideRendering({}, {}, ['--disable-gpu']).remember === false)
}

rmSync(root, { recursive: true, force: true })

console.log(`\n${failures === 0 ? 'ALL ELECTRON DIAGNOSTICS CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

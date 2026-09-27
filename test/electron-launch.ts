// Does the launch splash actually become visible? Launches Electron for real.
//
// This harness exists because the rest of the Electron coverage cannot answer
// that question. test/electron-integration.ts reads electron/main.cjs as a
// STRING and regexes it — it asserts that the text `openSplash()` appears before
// the text `createWindow()`, which is true of code that never shows a window at
// all. Four successive splash fixes passed that suite and had no effect on a
// real launch. Nothing else in test/ starts the main process.
//
// So this one spawns the real binary, reads the real startup trace, and asserts
// on observed events. It SKIPS rather than fails when it cannot run (no
// Electron binary, no X display), the same way test/validate.ts skips its schema
// assertions without libxml2 — a harness that cannot run must not look like a
// passing one, and must not break a machine that legitimately has no display.
import { existsSync } from 'node:fs'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const electronBinary = resolve(process.cwd(), 'node_modules/electron/dist/electron')
const rendererBuilt = existsSync(resolve(process.cwd(), 'dist/index.html'))
const haveXvfb = spawnSync('which', ['xvfb-run'], { encoding: 'utf8' }).status === 0
const haveDisplay = Boolean(process.env.DISPLAY) || haveXvfb

if (!existsSync(electronBinary)) {
  console.log('  [SKIP] Electron binary not installed — run `npm ci` to include it.')
  process.exit(0)
}
if (!rendererBuilt) {
  // `npm run check:all` runs the unit suite BEFORE the build, so on a clean tree
  // dist/ does not exist yet and this harness would skip every single time —
  // silently reintroducing exactly the coverage gap it was written to close.
  // Build it here instead. ~3 s, and only when it is actually missing.
  console.log('  dist/index.html missing — building the renderer first…')
  const build = spawnSync('npm', ['run', 'build'], { encoding: 'utf8', timeout: 300_000 })
  if (build.status !== 0 || !existsSync(resolve(process.cwd(), 'dist/index.html'))) {
    console.log('  [SKIP] could not build the renderer, so a launch cannot be observed.')
    process.exit(0)
  }
}
if (!haveDisplay) {
  console.log('  [SKIP] no X display and no xvfb-run — cannot map a window on this machine.')
  process.exit(0)
}

// JDDC_STARTUP_TRACE makes the main process print one line per startup phase.
// JDDC_EXIT_AFTER_STARTUP makes it quit once the workbench reports in, so this
// harness does not need to kill a GUI process and race its output.
const command = haveXvfb ? 'xvfb-run' : electronBinary
const args = haveXvfb
  ? ['-a', '--server-args=-screen 0 1280x800x24', electronBinary, '.', '--no-sandbox']
  : ['.', '--no-sandbox']

// An unpackaged Electron loads the renderer from the Vite dev origin. Serve the
// built dist/ there with `vite preview` unless something already answers, so
// this harness does not depend on a `npm run dev` happening to be running --
// without one it used to fail outright on any machine with a display. (Loading
// dist/ over plain file:// is not an alternative: the dev Electron binary fails
// a random subset of the lazy chunks there with net::ERR_FAILED, while the
// packaged app, which reads them out of app.asar, loads every one.)
const DEV_ORIGIN = 'http://localhost:5173'
const originUp = async () => fetch(DEV_ORIGIN).then((response) => response.ok, () => false)
let preview: ChildProcess | null = null
if (!(await originUp())) {
  preview = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--port', '5173', '--strictPort', '--host', 'localhost'], { stdio: 'ignore', detached: true })
  for (let attempt = 0; attempt < 60 && !(await originUp()); attempt++) await new Promise((wait) => setTimeout(wait, 250))
  if (!(await originUp())) {
    try { process.kill(-preview.pid!) } catch { /* never started */ }
    console.log('  [SKIP] could not serve dist/ on port 5173 for the launch to load.')
    process.exit(0)
  }
}
const stopPreview = () => { if (preview?.pid) try { process.kill(-preview.pid) } catch { /* already gone */ } }

const run = spawnSync(command, args, {
  encoding: 'utf8',
  timeout: 90_000,
  // JDDC_SMOKE_OPEN_GUIDE: open the user guide before exiting, so its window is
  // observed too. JDDC_NO_DEVTOOLS: a detached DevTools is a window of its own.
  env: { ...process.env, JDDC_STARTUP_TRACE: '1', JDDC_EXIT_AFTER_STARTUP: '1', JDDC_SMOKE_OPEN_GUIDE: '1', JDDC_NO_DEVTOOLS: '1' },
})

stopPreview()
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
const phases = new Map<string, number>()
for (const line of output.split(/\r?\n/)) {
  const match = /^\[startup\]\s+(\d+)ms\s+(.+)$/.exec(line.trim())
  if (match) phases.set(match[2]!.trim(), Number(match[1]))
}

if (phases.size === 0) {
  console.log('  [FAIL] the startup trace produced no phases — the main process did not start.')
  console.log(output.split(/\r?\n/).filter((l) => l.trim()).slice(-12).map((l) => `        ${l}`).join('\n'))
  process.exit(1)
}

console.log('  startup trace:')
for (const [name, ms] of phases) console.log(`        ${String(ms).padStart(6)}ms  ${name}`)

/** Phase names carry a parenthesised reason, so match on the prefix. */
function phaseAt(prefix: string): number | undefined {
  for (const [name, ms] of phases) if (name === prefix || name.startsWith(`${prefix} (`)) return ms
  return undefined
}
const splashVisible = phaseAt('splash visible')
const workbenchMounted = phaseAt('workbench mounted')

// The single assertion four previous attempts never made.
check('the splash window actually became visible', splashVisible !== undefined)
check('it became visible before the workbench mounted',
  splashVisible !== undefined && workbenchMounted !== undefined && splashVisible <= workbenchMounted,
  splashVisible !== undefined && workbenchMounted !== undefined ? `splash ${splashVisible}ms, workbench ${workbenchMounted}ms` : 'a phase is missing')
// The whole point is early feedback. A splash that appears at the same time as
// the workbench has covered nothing.
check('it became visible within 2s of the main process starting',
  splashVisible !== undefined && splashVisible < 2000, `${splashVisible}ms`)
check('the workbench reported itself mounted', workbenchMounted !== undefined)
check('the splash was dismissed rather than left on screen', phaseAt('splash dismissed') !== undefined)
// Every window the process creates, and how often each is shown. "Ghost windows
// that open and close" at launch were reported; this pins what ours are: one
// splash, one workbench, and (here, because the harness asks for it) the user
// guide -- each created once and shown at most once. Anything more is a flash.
const created = [...phases.keys()].filter((name) => /^window #\d+ created$/.test(name))
const labelled = [...phases.keys()].map((name) => /^window #(\d+) is the (.+)$/.exec(name)).filter((m): m is RegExpExecArray => m !== null)
const labels = labelled.map((m) => m[2]!).sort()
check('exactly three windows are created: splash, workbench, user guide', created.length === 3 && labels.join(',') === 'splash,user guide,workbench', `${created.length} created: ${labels.join(', ')}`)
const showCounts = new Map<string, number>()
for (const line of output.split(/\r?\n/)) {
  const shown = /\]\s+\d+ms\s+(.+ window #\d+) shown$/.exec(line.trim())
  if (shown) showCounts.set(shown[1]!, (showCounts.get(shown[1]!) ?? 0) + 1)
}
check('no window is shown more than once', [...showCounts.values()].every((count) => count === 1), JSON.stringify(Object.fromEntries(showCounts)))
check('no unlabelled window appears', ![...phases.keys()].some((name) => name.startsWith('unlabelled')))
check('the user guide renders inside the app', [...phases.keys()].some((name) => /^user guide loaded \(.*User Guide\)$/.test(name)))

// Which of the three routes won is platform-dependent and not the contract; that
// one of them always does is.
const route = [...phases.keys()].find((n) => n.startsWith('splash visible ('))
if (route) console.log(`  route taken: ${route.replace('splash visible ', '')}`)

console.log(`\n${failures === 0 ? 'ALL ELECTRON LAUNCH CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

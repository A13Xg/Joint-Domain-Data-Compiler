import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

// The packaged-app release gate: launches a real packaged build, waits for the
// React workbench to mount, opens the user guide through the real IPC, and
// requires the launch log (and, for the Windows launcher, its log) to show a
// healthy start.
//
// Usage: smoke-packaged.mjs [executable | archive.zip] [--portable | --zip] [--gpu]
//
//   (default)   the unpacked build in release/.
//   --portable  the Windows Portable.exe, which first extracts the whole app
//               into %TEMP% -- the slowest part of a portable start.
//   --zip       the Windows .zip (or the .zip given), extracted into a fresh
//               folder the way a user would -- Expand-Archive on Windows -- and
//               started from its top-level launcher.
//   --gpu       leave hardware acceleration on. Every gate before 0.9.0 passed
//               --disable-gpu, so the GPU path users hit was never launched.
//
// scripts/smoke-installer.mjs imports smokeLaunch() to run the same checks on
// an installed copy.

const LAUNCHER_FILE_NAME = 'Joint Domain Data Compiler.exe'
const APP_IMAGE_NAME = 'JointDomainDataCompiler.exe'
const EXPECTED_TITLE = 'Joint Domain Data Compiler'
const EXPECTED_URL_FRAGMENT = 'app.asar/dist/index.html'

const sleep = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))

/**
 * Launches `executable` and runs every check. `launcher` is true when the
 * executable is launcher/Launcher.cs, which exits by design once the app's own
 * window is up.
 */
export async function smokeLaunch({ executable, description = '', gpu = false, readyTimeoutMs = 30_000 }) {
  const launcher = basename(executable) === LAUNCHER_FILE_NAME
  const port = await availablePort()
  const output = []
  const inCiLinux = process.platform === 'linux' && (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true')
  const electronArgs = [...(gpu ? [] : ['--disable-gpu']), `--remote-debugging-port=${port}`]
  if (inCiLinux || process.env.JDDC_SMOKE_NO_SANDBOX === '1') electronArgs.push('--no-sandbox', '--disable-setuid-sandbox')
  // Pointed somewhere this script can find on any platform. A build whose log
  // is silent is a build whose next field failure cannot be diagnosed.
  const logDir = mkdtempSync(join(tmpdir(), 'jddc-smoke-log-'))
  const logs = {
    main: () => readText(join(logDir, 'main.log')),
    launcher: () => readText(join(logDir, 'launcher.log')),
  }

  console.log(`Launching ${executable}${description ? ` (${description})` : ''} with ${gpu ? 'hardware acceleration' : '--disable-gpu'}`)
  const launchedAt = Date.now()
  const command = process.platform === 'linux' ? 'xvfb-run' : executable
  const args = process.platform === 'linux' ? ['-a', executable, ...electronArgs] : electronArgs
  const child = spawn(command, args, {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, JDDC_STARTUP_TRACE: '1', JDDC_LOG_DIR: logDir, ...(gpu ? { JDDC_GPU: 'on' } : {}) },
  })
  child.stdout.on('data', (chunk) => output.push(String(chunk)))
  child.stderr.on('data', (chunk) => output.push(String(chunk)))

  try {
    const { page, sawSplash } = await waitForRenderer(port, child, readyTimeoutMs, launcher)
    await waitForWorkbenchMounted(page.webSocketDebuggerUrl)
    console.log(`Packaged ${process.platform} renderer launched: ${page.title}`)
    console.log(`Launch to mounted workbench: ${Date.now() - launchedAt} ms`)
    // Reported, not asserted: on a launch faster than the 250 ms poll the
    // splash can legitimately never be sampled.
    console.log(sawSplash ? 'Launch splash was observed during startup.' : 'Launch splash was not sampled (startup may have outrun the 250 ms poll).')
    await openUserGuide(page.webSocketDebuggerUrl, port)
    printStartupTrace(output)
    await checkMainLog(logs.main, logDir, gpu, launcher)
    if (launcher) await checkLauncherLog(logs.launcher, logs.main, launchedAt)
  } catch (error) {
    const detail = output.join('').trim()
    if (detail) console.error(detail)
    printLog('Launch log', logs.main(), console.error)
    if (launcher) printLog('Launcher log', logs.launcher(), console.error)
    throw error
  } finally {
    stopPackagedApp(child, launcher)
  }
}

function readText(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

function printLog(title, text, print) {
  if (text === null) {
    print(`${title}: not written.`)
    return
  }
  print(`${title}:`)
  for (const line of text.trimEnd().split(/\r?\n/)) print(`  ${line}`)
}

// Polled: "startup complete" is written after the splash's outro, which can
// land a moment after the DOM check has already seen the workbench.
async function checkMainLog(readMain, logDir, gpu, launcher) {
  const expected = [
    '---- launch: Joint Domain Data Compiler',
    'startup complete',
    gpu ? 'Hardware rendering' : 'Software rendering',
    ...(launcher ? ['Started by the JDDC launcher', 'process spawn to main.cjs'] : []),
  ]
  let missing = expected
  for (const deadline = Date.now() + 15_000; Date.now() < deadline; await sleep(250)) {
    const text = readMain() ?? ''
    missing = expected.filter((line) => !text.includes(line))
    if (missing.length === 0) {
      printLog(`Launch log (${join(logDir, 'main.log')})`, text, console.log)
      return
    }
  }
  throw new Error(`The launch log in ${logDir} is missing: ${missing.map((line) => `"${line}"`).join(', ')}.`)
}

// The launcher's whole job, asserted from its own record: its splash was up
// before the app's window, and it handed off and exited cleanly.
async function checkLauncherLog(readLauncher, readMain, launchedAt) {
  let text = ''
  for (const deadline = Date.now() + 15_000; Date.now() < deadline; await sleep(250)) {
    text = readLauncher() ?? ''
    if (/launcher exiting with code -?\d+/.test(text)) break
  }
  const splashShown = Number(/splash shown (\d+) ms after launch/.exec(text)?.[1])
  const appVisible = Number(/app window visible (\d+) ms after launch/.exec(text)?.[1])
  const exitCode = Number(/launcher exiting with code (-?\d+)/.exec(text)?.[1])
  const spawnGap = Number(/(\d+)ms {2}process spawn to main\.cjs/.exec(readMain() ?? '')?.[1])
  console.log('Launcher timings:')
  console.log(`  launcher splash on screen     ${splashShown} ms after the launcher started`)
  console.log(`  app's code running            ${spawnGap} ms after the launcher started (process spawn to main.cjs)`)
  console.log(`  app window visible, hand-off  ${appVisible} ms after the launcher started`)
  console.log(`  (the launcher itself was started ${Date.now() - launchedAt} ms ago by this script)`)
  if (!Number.isFinite(splashShown)) throw new Error('The launcher never reported its splash on screen.')
  if (!Number.isFinite(appVisible)) throw new Error('The launcher never saw the app\'s window.')
  if (!(splashShown < appVisible)) throw new Error(`The launcher's splash (${splashShown} ms) was not up before the app's window (${appVisible} ms).`)
  if (exitCode !== 0) throw new Error(`The launcher did not exit cleanly after the hand-off (exit line: ${Number.isFinite(exitCode) ? exitCode : 'missing'}).`)
  const route = /splash visible \(([^)]+)\)/.exec(readMain() ?? '')?.[1]
  console.log(`  the app's splash took over via: ${route ?? 'not shown'}`)
}

// The guide lives inside app.asar. It once opened through the OS default
// browser, which cannot read into an asar -- so the info button worked from a
// checkout and did nothing in every installed build. This drives the real
// button's IPC and requires the guide to render, from the archive, in the app.
async function openUserGuide(webSocketDebuggerUrl, debugPort) {
  await evaluateDevTools(webSocketDebuggerUrl, 'window.jointDomainCompiler.openUserGuide().then(() => true)', true)
  for (const deadline = Date.now() + 15_000; Date.now() < deadline; await sleep(250)) {
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json()).catch(() => [])
    const guide = targets.find((target) => target.type === 'page' && target.url.includes('user-guide.html'))
    if (guide && /User Guide/.test(guide.title)) {
      console.log(`User guide opened inside the app: ${guide.title}`)
      return
    }
  }
  throw new Error('The user guide did not open inside the packaged app within 15 seconds.')
}

function printStartupTrace(output) {
  const lines = output.join('').split(/\r?\n/).filter((line) => line.startsWith('[startup]'))
  if (lines.length === 0) {
    console.log('No startup trace on stdout (a GUI process started through the launcher does not forward it); the launch log below has it.')
    return
  }
  console.log('Startup and window trace:')
  for (const line of lines) console.log(`  ${line}`)
  const created = lines.filter((line) => / window #\d+ created$/.test(line)).length
  console.log(`Windows created by the app: ${created} (splash, workbench, user guide expected).`)
}

async function waitForWorkbenchMounted(webSocketDebuggerUrl) {
  if (typeof webSocketDebuggerUrl !== 'string') throw new Error('Packaged renderer did not expose a DevTools WebSocket endpoint.')
  let state = null
  for (const deadline = Date.now() + 30_000; Date.now() < deadline; await sleep(250)) {
    state = await evaluateDevTools(webSocketDebuggerUrl, `(() => {
      const root = document.querySelector('#root')
      return { mounted: Boolean(root && root.childElementCount > 0 && /Joint Domain Data Compiler|Import/i.test(root.textContent || '')), readyState: document.readyState, rootHtml: root?.innerHTML.slice(0, 500) ?? null, location: location.href }
    })()`)
    if (state?.mounted === true) return
  }
  throw new Error(`Packaged renderer opened, but the JDDC React workbench did not mount into #root: ${JSON.stringify(state)}`)
}

function evaluateDevTools(url, expression, awaitPromise = false) {
  return new Promise((resolveValue, reject) => {
    const socket = new WebSocket(url)
    const timer = setTimeout(() => { socket.close(); reject(new Error('Timed out evaluating packaged renderer DOM.')) }, 10_000)
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise } })))
    socket.addEventListener('message', (event) => {
      const response = JSON.parse(String(event.data))
      if (response.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (response.error || response.result?.exceptionDetails) reject(new Error(`Could not evaluate packaged renderer DOM: ${JSON.stringify(response.error ?? response.result.exceptionDetails)}`))
      else resolveValue(response.result?.result?.value)
    })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to packaged renderer DevTools endpoint.')) })
  })
}

async function waitForRenderer(port, processHandle, readyTimeoutMs, launcher) {
  let lastPage = null
  let sawSplash = false
  for (const deadline = Date.now() + readyTimeoutMs; Date.now() < deadline; await sleep(250)) {
    // The launcher exits 0 by design once the app's window is up; anything
    // else exiting early is a failed launch.
    if (processHandle.exitCode !== null && !(launcher && processHandle.exitCode === 0)) {
      throw new Error(`Packaged application exited early with code ${processHandle.exitCode}.`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        // Matched by URL: the splash is a second page for the first second or
        // two of startup.
        const pages = targets.filter((target) => target.type === 'page')
        if (pages.some((target) => target.url.includes('splash.html'))) sawSplash = true
        const page = pages.find((target) => target.url.includes(EXPECTED_URL_FRAGMENT)) ?? pages[0]
        if (page) {
          lastPage = page
          if (page.url.includes(EXPECTED_URL_FRAGMENT) && page.title === EXPECTED_TITLE) return { page, sawSplash }
        }
      }
    } catch {
      // Electron has not opened the debugging endpoint yet.
    }
  }
  const observed = lastPage ? ` Last page was ${JSON.stringify({ title: lastPage.title, url: lastPage.url })}.` : ''
  throw new Error(`Packaged renderer did not become ready within ${readyTimeoutMs / 1000} seconds.${observed}`)
}

function stopPackagedApp(processHandle, launcher) {
  if (process.platform === 'win32') {
    if (processHandle.pid) spawnSync('taskkill', ['/pid', String(processHandle.pid), '/t', '/f'], { stdio: 'ignore' })
    // The launcher has already exited, so its process tree no longer leads to
    // the app it started.
    if (launcher) spawnSync('taskkill', ['/im', APP_IMAGE_NAME, '/t', '/f'], { stdio: 'ignore' })
    return
  }
  if (!processHandle.pid) return
  // ESRCH just means the app already exited, which is the outcome wanted.
  try { process.kill(-processHandle.pid, 'SIGTERM') } catch { /* already gone */ }
  setTimeout(() => {
    try { process.kill(-processHandle.pid, 'SIGKILL') } catch { /* already gone */ }
  }, 1_000).unref()
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const allocated = typeof address === 'object' && address ? address.port : null
      server.close((error) => error ? reject(error) : allocated ? resolvePort(allocated) : reject(new Error('Could not allocate a smoke-test port')))
    })
  })
}

async function onlyReleaseFile(pattern, label) {
  const matches = (await readdir('release')).filter((name) => pattern.test(name))
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label} in release/, found ${matches.length}.`)
  return join('release', matches[0])
}

/**
 * Extracts the zip into a fresh folder and returns what a user would
 * double-click: the launcher at the top of the Windows zip, or the app itself
 * for an archive without one.
 */
function extractZip(zipPath) {
  const target = mkdtempSync(join(tmpdir(), 'jddc-smoke-zip-'))
  const extract = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:JDDC_ZIP -DestinationPath $env:JDDC_ZIP_TARGET'], { env: { ...process.env, JDDC_ZIP: zipPath, JDDC_ZIP_TARGET: target }, encoding: 'utf8' })
    : spawnSync('unzip', ['-q', zipPath, '-d', target], { encoding: 'utf8' })
  if (extract.status !== 0) throw new Error(`Could not extract ${zipPath}: ${extract.stderr || extract.stdout || `exit ${extract.status}`}`)
  const top = readdirSync(target)
  if (top.length !== 1) throw new Error(`The zip must hold exactly one top-level folder; found ${JSON.stringify(top)}.`)
  const folder = join(target, top[0])
  if (!existsSync(join(folder, 'README.txt'))) throw new Error('The zip has no README.txt beside the executable.')
  const candidates = process.platform === 'win32'
    ? [join(folder, LAUNCHER_FILE_NAME)]
    : [join(folder, 'joint-domain-data-compiler'), join(folder, 'app', 'joint-domain-data-compiler')]
  const exe = candidates.find((candidate) => existsSync(candidate))
  if (!exe) throw new Error(`The zip has no executable at ${candidates.join(' or ')}.`)
  if (process.platform === 'win32') {
    // What the user sees at the top level is exactly the launcher, the README
    // and the app folder -- nothing else to wonder about.
    const visible = readdirSync(folder).sort().join(', ')
    if (visible !== ['README.txt', 'app', LAUNCHER_FILE_NAME].sort().join(', ')) throw new Error(`Unexpected top-level contents in the zip folder: ${visible}`)
    if (!existsSync(join(folder, 'app', APP_IMAGE_NAME))) throw new Error('The zip has no app\\JointDomainDataCompiler.exe for the launcher to start.')
  }
  console.log(`Extracted ${zipPath} to ${folder}`)
  return exe
}

async function defaultExecutable() {
  if (process.platform === 'win32') return join('release', 'win-unpacked', APP_IMAGE_NAME)
  if (process.platform === 'linux') return 'release/linux-unpacked/joint-domain-data-compiler'
  if (process.platform === 'darwin') {
    const outputDirectory = (await readdir('release', { withFileTypes: true }))
      .find((entry) => entry.isDirectory() && entry.name.startsWith('mac'))?.name
    if (!outputDirectory) throw new Error('Could not find the unpacked macOS application directory.')
    return join('release', outputDirectory, 'Joint Domain Data Compiler.app', 'Contents', 'MacOS', 'Joint Domain Data Compiler')
  }
  throw new Error(`Packaged smoke is not configured for ${process.platform}.`)
}

if (process.argv[1] && basename(process.argv[1]) === 'smoke-packaged.mjs') {
  const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith('--')))
  const positional = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
  const gpu = flags.has('--gpu')
  if (flags.has('--zip')) {
    const executable = extractZip(resolve(positional ?? await onlyReleaseFile(/Windows-x64\.zip$/, 'Windows zip')))
    await smokeLaunch({ executable, description: 'extracted from the zip', gpu })
  } else if (flags.has('--portable')) {
    if (process.platform !== 'win32') throw new Error('--portable is a Windows-only launch.')
    const executable = resolve(positional ?? await onlyReleaseFile(/Windows-x64-Portable\.exe$/, 'portable executable'))
    // Its extraction happens inside this window, so it gets longer; the point
    // is to measure it, not to fail on a slow runner.
    await smokeLaunch({ executable, description: 'portable launcher; includes extracting the app', gpu, readyTimeoutMs: 180_000 })
  } else {
    await smokeLaunch({ executable: resolve(positional ?? await defaultExecutable()), gpu })
  }
}

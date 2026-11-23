import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Usage: smoke-packaged.mjs [executable | archive.zip] [--portable | --zip] [--gpu]
//
//   --portable  launch the Windows Portable.exe from release/ instead of
//               win-unpacked. That is what users actually run, and it first
//               extracts the whole app into %TEMP% -- a step the unpacked
//               launch skips entirely, and the slowest part of a portable start.
//   --zip       extract the Windows .zip (or the .zip given) into a fresh temp
//               folder the way a user would -- Expand-Archive on Windows -- check
//               it holds one top-level folder with the README, and launch the
//               executable from inside it.
//   --gpu       leave hardware acceleration on. Every earlier gate passed
//               --disable-gpu, so the GPU path users hit was never launched.
const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith('--')))
const positional = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
const usePortable = flags.has('--portable')
const useZip = flags.has('--zip')
const useGpu = flags.has('--gpu')
const executable = useZip
  ? extractZipAndLocateExecutable(resolve(positional ?? await windowsZip()))
  : resolve(positional ?? (usePortable ? await portableExecutable() : await defaultExecutable()))
const expectedTitle = 'Joint Domain Data Compiler'
const expectedUrlFragment = 'app.asar/dist/index.html'
// The portable launcher's extraction happens inside this window, so it gets
// longer; the point is to measure it, not to fail on a slow runner.
const readyTimeoutMs = usePortable ? 180_000 : 30_000
const port = await availablePort()
const output = []
const inCiLinux = process.platform === 'linux' && (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true')
const electronArgs = [...(useGpu ? [] : ['--disable-gpu']), `--remote-debugging-port=${port}`]
// The launch log the app writes for every start, pointed somewhere this script
// can find on any platform. Asserted below: a build whose log is silent is a
// build whose next field failure cannot be diagnosed.
const logDir = mkdtempSync(join(tmpdir(), 'jddc-smoke-log-'))
console.log(`Launching ${executable}${usePortable ? ' (portable launcher)' : useZip ? ' (extracted from the zip)' : ''} with ${useGpu ? 'hardware acceleration' : '--disable-gpu'}`)
const launchedAt = Date.now()
if (inCiLinux || process.env.JDDC_SMOKE_NO_SANDBOX === '1') {
  electronArgs.push('--no-sandbox', '--disable-setuid-sandbox')
}
const command = process.platform === 'linux' ? 'xvfb-run' : executable
const args = process.platform === 'linux' ? ['-a', executable, ...electronArgs] : electronArgs
const child = spawn(command, args, {
  detached: process.platform !== 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
  // The startup trace names every window the app creates and each show/hide/
  // close. Printed below, it puts a real record of what a packaged launch puts
  // on screen into every release log -- including Windows, which cannot be
  // launched anywhere else in this project's tooling.
  env: { ...process.env, JDDC_STARTUP_TRACE: '1', JDDC_LOG_DIR: logDir, ...(useGpu ? { JDDC_GPU: 'on' } : {}) },
})

child.stdout.on('data', (chunk) => output.push(String(chunk)))
child.stderr.on('data', (chunk) => output.push(String(chunk)))

try {
  const { page, sawSplash } = await waitForRenderer(port, child)
  await waitForWorkbenchMounted(page.webSocketDebuggerUrl)
  console.log(`Packaged ${process.platform} renderer launched: ${page.title}`)
  console.log(`Launch to mounted workbench: ${Date.now() - launchedAt} ms${usePortable ? ' (includes the portable launcher extracting the app)' : ''}`)
  // Reported, not asserted. The splash is retired as soon as the workbench
  // mounts, so on a launch fast enough to beat this poller's 250 ms interval it
  // can legitimately never be sampled — failing on that would make this gate
  // flaky on exactly the fast machines where the splash matters least. Printing
  // it is what makes a packaged launch that shows NO splash visible in the
  // release log instead of silent.
  console.log(sawSplash
    ? 'Launch splash was observed during startup.'
    : 'Launch splash was not sampled (startup may have outrun the 250 ms poll).')
  await openUserGuide(page.webSocketDebuggerUrl, port)
  printStartupTrace()
  await checkLaunchLog()
} catch (error) {
  const detail = output.join('').trim()
  if (detail) console.error(detail)
  printLaunchLog(console.error)
  throw error
} finally {
  stopPackagedApp(child)
}

// The guide lives inside app.asar. It once opened through the OS default
// browser, which cannot read into an asar -- so the info button worked from a
// checkout and did nothing in every installed build. This drives the real
// button's IPC and requires the guide to render, from the archive, in the app.
async function openUserGuide(webSocketDebuggerUrl, debugPort) {
  await evaluateDevTools(webSocketDebuggerUrl, 'window.jointDomainCompiler.openUserGuide().then(() => true)', true)
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json()).catch(() => [])
    const guide = targets.find((target) => target.type === 'page' && target.url.includes('user-guide.html'))
    if (guide && /User Guide/.test(guide.title)) {
      console.log(`User guide opened inside the app: ${guide.title}`)
      return
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error('The user guide did not open inside the packaged app within 15 seconds.')
}

function printStartupTrace() {
  const lines = output.join('').split(/\r?\n/).filter((line) => line.startsWith('[startup]'))
  if (lines.length === 0) {
    console.log('No startup trace was captured (this platform may not forward a GUI process\'s stdout).')
    return
  }
  console.log('Startup and window trace:')
  for (const line of lines) console.log(`  ${line}`)
  const created = lines.filter((line) => / window #\d+ created$/.test(line)).length
  console.log(`Windows created by the app: ${created} (splash, workbench, user guide expected).`)
}

function readLaunchLog() {
  const file = join(logDir, 'main.log')
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

function printLaunchLog(print) {
  const text = readLaunchLog()
  if (text === null) {
    print(`No launch log was written to ${logDir}.`)
    return
  }
  print(`Launch log (${join(logDir, 'main.log')}):`)
  for (const line of text.trimEnd().split(/\r?\n/)) print(`  ${line}`)
}

// Polled: "startup complete" is written after the splash's outro, which can
// land a moment after the DOM check above has already seen the workbench.
async function checkLaunchLog() {
  const expected = ['---- launch: Joint Domain Data Compiler', 'startup complete', useGpu ? 'Hardware rendering' : 'Software rendering']
  const deadline = Date.now() + 15_000
  let missing = expected
  while (Date.now() < deadline) {
    const text = readLaunchLog() ?? ''
    missing = expected.filter((line) => !text.includes(line))
    if (missing.length === 0) {
      printLaunchLog(console.log)
      return
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`The launch log in ${logDir} is missing: ${missing.map((line) => `"${line}"`).join(', ')}.`)
}

async function waitForWorkbenchMounted(webSocketDebuggerUrl) {
  if (typeof webSocketDebuggerUrl !== 'string') throw new Error('Packaged renderer did not expose a DevTools WebSocket endpoint.')
  const deadline = Date.now() + 30_000
  let state = null
  while (Date.now() < deadline) {
    state = await evaluateDevTools(webSocketDebuggerUrl, `(() => {
      const root = document.querySelector('#root')
      return { mounted: Boolean(root && root.childElementCount > 0 && /Joint Domain Data Compiler|Import/i.test(root.textContent || '')), readyState: document.readyState, rootHtml: root?.innerHTML.slice(0, 500) ?? null, location: location.href }
    })()`)
    if (state?.mounted === true) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
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

async function windowsZip() {
  const zips = (await readdir('release')).filter((name) => /Windows-x64\.zip$/.test(name))
  if (zips.length !== 1) throw new Error(`Expected exactly one Windows zip in release/, found ${zips.length}.`)
  return join('release', zips[0])
}

function extractZipAndLocateExecutable(zipPath) {
  const target = mkdtempSync(join(tmpdir(), 'jddc-smoke-zip-'))
  const extract = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:JDDC_ZIP -DestinationPath $env:JDDC_ZIP_TARGET'], { env: { ...process.env, JDDC_ZIP: zipPath, JDDC_ZIP_TARGET: target }, encoding: 'utf8' })
    : spawnSync('unzip', ['-q', zipPath, '-d', target], { encoding: 'utf8' })
  if (extract.status !== 0) throw new Error(`Could not extract ${zipPath}: ${extract.stderr || extract.stdout || `exit ${extract.status}`}`)
  const top = readdirSync(target)
  if (top.length !== 1) throw new Error(`The zip must hold exactly one top-level folder; found ${JSON.stringify(top)}.`)
  const folder = join(target, top[0])
  if (!existsSync(join(folder, 'README.txt'))) throw new Error('The zip has no README.txt beside the executable.')
  const exe = join(folder, process.platform === 'win32' ? 'JointDomainDataCompiler.exe' : 'joint-domain-data-compiler')
  if (!existsSync(exe)) throw new Error(`The zip has no executable at ${exe}.`)
  console.log(`Extracted ${zipPath} to ${folder}`)
  return exe
}

async function portableExecutable() {
  if (process.platform !== 'win32') throw new Error('--portable is a Windows-only launch.')
  const portable = (await readdir('release')).filter((name) => /Windows-x64-Portable\.exe$/.test(name))
  if (portable.length !== 1) throw new Error(`Expected exactly one portable executable in release/, found ${portable.length}.`)
  return join('release', portable[0])
}

async function defaultExecutable() {
  if (process.platform === 'win32') return 'release/win-unpacked/JointDomainDataCompiler.exe'
  if (process.platform === 'linux') return 'release/linux-unpacked/joint-domain-data-compiler'
  if (process.platform === 'darwin') {
    const outputDirectory = (await readdir('release', { withFileTypes: true }))
      .find((entry) => entry.isDirectory() && entry.name.startsWith('mac'))?.name
    if (!outputDirectory) throw new Error('Could not find the unpacked macOS application directory.')
    return join('release', outputDirectory, 'Joint Domain Data Compiler.app', 'Contents', 'MacOS', 'Joint Domain Data Compiler')
  }
  throw new Error(`Packaged smoke is not configured for ${process.platform}.`)
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

async function waitForRenderer(port, processHandle) {
  const deadline = Date.now() + readyTimeoutMs
  let lastPage = null
  // The splash was only ever filtered OUT here, so the one gate that runs a
  // packaged build never checked the thing four splash fixes were about. If it
  // appears, record it: this is the only place the packaged Windows launch is
  // observed at all.
  let sawSplash = false
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Packaged application exited early with code ${processHandle.exitCode}.`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        // Matched by URL, not just by being the first page target: the
        // launch splash is a second page for the first second or two of
        // startup, and `find` would otherwise keep returning it.
        const pages = targets.filter((target) => target.type === 'page')
        if (pages.some((target) => target.url.includes('splash.html'))) sawSplash = true
        const page = pages.find((target) => target.url.includes(expectedUrlFragment)) ?? pages[0]
        if (page) {
          lastPage = page
          if (page.url.includes(expectedUrlFragment) && page.title === expectedTitle) {
            return { page, sawSplash }
          }
        }
      }
    } catch {
      // Electron has not opened the debugging endpoint yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  const observed = lastPage ? ` Last page was ${JSON.stringify({ title: lastPage.title, url: lastPage.url })}.` : ''
  throw new Error(`Packaged renderer did not become ready within ${readyTimeoutMs / 1000} seconds.${observed}`)
}

function stopPackagedApp(processHandle) {
  if (!processHandle.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(processHandle.pid), '/t', '/f'], { stdio: 'ignore' })
    return
  }
  // ESRCH here just means the app already exited on its own, which is the
  // outcome this function wants anyway.
  try { process.kill(-processHandle.pid, 'SIGTERM') } catch { /* already gone */ }
  setTimeout(() => {
    try { process.kill(-processHandle.pid, 'SIGKILL') } catch { /* already gone */ }
  }, 1_000).unref()
}

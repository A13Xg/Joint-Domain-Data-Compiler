const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { pathToFileURL } = require('url')
const zlib = require('zlib')
const { seedKmlLibrary, seedKmlLibraryAsync, fetchKmlFromRemote } = require('./kml-seed.cjs')
const {
  ARCHIVE_DIRECTIONS,
  DEV_ORIGIN,
  IPC_CHANNELS,
  MAX_ARCHIVE_FILE_BYTES,
  MAX_ARCHIVE_TOTAL_BYTES,
  MAX_KML_LIBRARY_BYTES,
  SUITE_APPS,
  diagnosticBundleText,
  ipcBytes,
  isAllowedAppUrl,
  resolveChildPath,
  reportHtmlText,
  resolveLibraryPath,
  safeArchiveName,
  safePdfName,
} = require('./security.cjs')

// Startup phase trace, off unless JDDC_STARTUP_TRACE is set.
//
// This exists because a slow launch could not be diagnosed. The splash was
// rewritten four times against a suite that reads main.cjs as a string, while
// users still reported seeing nothing for ten seconds — and nobody could say
// which phase those ten seconds were in. Now they can:
//
//   JDDC_STARTUP_TRACE=1 JointDomainDataCompiler
//
// `JDDC_SPAWN_MS`, if set to a wall-clock epoch-ms captured by whatever launched
// the process, also reports the gap from spawn to this module loading — the one
// phase no in-app window can ever cover, because Electron has not booted yet.
const STARTUP_TRACE = Boolean(process.env.JDDC_STARTUP_TRACE)
const startupBegan = Date.now()
function tracePhase(name) {
  if (!STARTUP_TRACE) return
  console.log(`[startup] ${String(Date.now() - startupBegan).padStart(6)}ms  ${name}`)
}
if (STARTUP_TRACE) {
  const spawnedAt = Number(process.env.JDDC_SPAWN_MS)
  if (Number.isFinite(spawnedAt) && spawnedAt > 0) {
    console.log(`[startup] ${String(startupBegan - spawnedAt).padStart(6)}ms  process spawn to main.cjs (cannot be covered by any in-app window)`)
  }
  tracePhase('main.cjs loaded')
}

const isDev = !app.isPackaged
const useDevServer = isDev
const packagedRendererUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).href
const packagedGuideUrl = pathToFileURL(path.join(__dirname, '../dist/user-guide.html')).href

// Window lifecycle, traced alongside the startup phases. A report of windows
// that "open and close" at launch cannot be reproduced on every platform here,
// so the trace names every window this process creates and each time one is
// shown, hidden or closed -- enough to tell which window a flash belongs to, or
// that it is not one of ours at all (a portable launcher's extraction splash,
// say, which runs before this process exists).
const windowLabels = new WeakMap()
function labelWindow(window, label) {
  windowLabels.set(window, label)
  tracePhase(`window #${window.id} is the ${label}`)
}
if (STARTUP_TRACE) {
  app.on('browser-window-created', (_event, window) => {
    const id = window.id
    const name = () => `${windowLabels.get(window) ?? 'unlabelled'} window #${id}`
    tracePhase(`window #${id} created`)
    window.on('show', () => tracePhase(`${name()} shown`))
    window.on('hide', () => tracePhase(`${name()} hidden`))
    window.on('closed', () => tracePhase(`${name()} closed`))
  })
}

// Mirrors the renderer's `projectDirty`, pushed over IPC on every change.
//
// The renderer cannot guard the close itself. A `beforeunload` listener that
// calls preventDefault() does NOT raise a confirmation in Electron the way it
// does in a browser -- Electron simply cancels the close, silently. That is
// exactly what shipped: with a dirty project loaded, the window button, the
// taskbar "Close window" item, and Alt+F4 all did nothing at all, with no
// dialog to explain why. The prompt has to live here, on the window's own
// `close` event, where a native modal can actually be shown.
let hasUnsavedChanges = false

// The launch splash. A frameless window carrying its own art and stylesheet,
// opened as the first act of `ready` and closed once the renderer reports the
// workbench mounted. It depends on neither dist/ nor the dev server, so it
// paints while the workbench bundle is still downloading -- which is the whole
// point, since a cold launch is otherwise seconds of nothing but a taskbar
// entry. index.html's skeleton still covers the same gap for the browser
// build, where there is no main process to open a window early.
//
// Opaque and square-cornered on purpose: `transparent: true` is unreliable on
// Linux without a compositor, and black corners on the AppImage and .deb
// builds are a worse outcome than a straight edge on every platform.
const SPLASH_STAGE_CHANNEL = 'splash:stage'
// Sent by splash-preload.cjs once the artwork is decoded and composited. See
// where it is consumed in openSplash() for why the window waits for it.
const SPLASH_PAINTED_CHANNEL = 'splash:painted'
// Matches splash.png's aspect ratio, so its `cover` fit is exact.
const SPLASH_SIZE = { width: 800, height: 343 }
// Only four stages, because only four moments are real. Registering the IPC
// handlers takes well under a millisecond, so a "registering services" stage
// would be a progress step that exists to be watched rather than to report
// anything -- its pieces are named in `boot`'s item list instead. Each
// `progress` is a ceiling the bar eases toward over seconds rather than a
// value it snaps to (see splash.html), so it keeps moving through a slow
// stage without ever overrunning into the next one.
const SPLASH_STAGES = Object.freeze({
  boot: {
    progress: 0.18,
    items: [
      'Starting Joint Domain Data Compiler',
      'Electron runtime',
      'KML/KMZ overlay library',
      'File archive',
      'Diagnostic bundles',
      'Window state',
      'User guide',
    ],
  },
  renderer: {
    progress: 0.32,
    items: ['Loading the workbench', 'React runtime', 'Stylesheets', 'Application log'],
  },
  // Reached at the workbench document's 'did-finish-load', which is BEFORE
  // src/main.tsx dynamically imports App.tsx -- by far the largest remaining
  // chunk. This used to sit at 0.86, so the bar arrived within a few hundred
  // milliseconds at a near-full reading and then stalled there for the whole of
  // the actual work: a progress bar that was finished before the slow part
  // started. Held lower on purpose, so the 5-second ease in splash.html still
  // has somewhere to travel while that chunk loads and executes.
  workbench: {
    progress: 0.55,
    items: [
      'Preparing the workbench',
      'Format parsers',
      'Coordinate transforms',
      'Analytics derivations',
      'Transform operations',
      'Project archive',
      'Workspace state',
      'Import view',
    ],
  },
  ready: { progress: 1, items: ['Ready'] },
})
// Ceiling on how long the splash may hold the workbench window back when the
// renderer never reports in -- a bundle that throws before React mounts must
// not leave a permanent splash and no way to see why.
const SPLASH_TIMEOUT_MS = 8000
// Long enough to read the bar landing on 100%, short enough not to feel like lag.
const SPLASH_OUTRO_MS = 260
// Total time the splash stays on screen at minimum, outro included.
//
// Measured on a packaged Linux build, a warm launch reached "renderer ready"
// 381 ms after process start, which put the splash on screen for about 330 ms
// -- a flash that reads as a rendering glitch rather than as a splash, and the
// reason a real launch could be reported as showing no splash at all. This
// only binds on launches already fast enough to beat it; a slow launch has
// long since exceeded it, so it costs nothing on exactly the launches the
// splash exists for.
const SPLASH_MIN_VISIBLE_MS = 900
// How long to wait for the splash renderer's first paint before showing the
// window anyway. See markShown() in openSplash() for why a blind show is the
// right fallback rather than a hazard.
const SPLASH_FALLBACK_SHOW_MS = 700

let splashWindow = null
// When the splash actually became visible -- not when it was constructed. The
// hold above has to be measured from the paint, or a slow first paint eats the
// budget it is meant to add.
let splashShownAt = null
let splashStageName = 'boot'
// webContents.send before the preload has registered its listener is dropped
// silently, and the first stages are dispatched from the same startup tick
// that begins loading the page. Sending is gated on the splash's own
// 'did-finish-load' and the current stage replayed there instead.
let splashCanReceive = false

function sendSplashStage() {
  if (!splashCanReceive || !splashWindow || splashWindow.isDestroyed()) return
  splashWindow.webContents.send(SPLASH_STAGE_CHANNEL, {
    ...SPLASH_STAGES[splashStageName],
    version: app.getVersion(),
  })
}

function splashStage(name) {
  if (!SPLASH_STAGES[name]) return
  splashStageName = name
  sendSplashStage()
}

function openSplash() {
  const window = new BrowserWindow({
    ...SPLASH_SIZE,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    backgroundColor: '#050b18',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  // Shown on the FIRST PAINT OF THE DOCUMENT, and never gated on the artwork.
  //
  // This is the correction to four previous attempts. Every one of them made
  // visibility depend on splash.png being decoded -- the last by waiting for an
  // IPC message the preload sends after Image.decode() -- on the theory that a
  // window shown earlier is "a black box". It is not. splash.html paints its own
  // dark ground (`--ink`), the product name seeded into the status line, the
  // version, and the progress bar entirely from inline CSS, with no image
  // involved: showing at first paint yields a complete splash that the 222 KB
  // plate then fades into. Gating on the plate bought nothing and added a single
  // point of failure with no fallback, so when anything went wrong -- a slow
  // decode, a renderer teardown, a dropped message -- the splash was never shown
  // at all. That is the reported symptom: a launch showing nothing, from a splash
  // that had been "fixed" four times.
  const markShown = (why) => {
    if (window.isDestroyed() || splashShownAt !== null) return
    splashShownAt = Date.now()
    window.show()
    tracePhase(`splash visible (${why})`)
  }
  // Whichever of these happens first wins; they are three independent routes to
  // the same one-shot, because the failure being fixed is "none of them fired".
  window.once('ready-to-show', () => markShown('first paint'))
  // Sender-checked: this channel is only meaningful from the splash's own
  // renderer, and the workbench renderer must not be able to trip it.
  ipcMain.on(SPLASH_PAINTED_CHANNEL, (event) => {
    if (event.sender === window.webContents) markShown('artwork decoded')
  })
  // Last resort. Deliberately shorter than any plausible artwork decode: if the
  // renderer is so starved that it has not managed a first paint by now, showing
  // the window with its background colour is still the right answer, because the
  // alternative that shipped was showing nothing for ten seconds.
  const blindShow = setTimeout(() => markShown('fallback timer'), SPLASH_FALLBACK_SHOW_MS)
  window.once('closed', () => clearTimeout(blindShow))

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => { event.preventDefault() })

  // A splash whose renderer or preload dies stays non-null and hidden forever
  // otherwise, and a lingering hidden splash is worse than none: it is what the
  // workbench reveal used to wait behind. Drop it and let the workbench take
  // over on its own first paint.
  window.webContents.on('render-process-gone', (_event, details) => {
    console.warn(`[splash] Splash renderer exited (${details.reason}); continuing without it.`)
    dismissSplash()
  })
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.warn(`[splash] Splash preload failed (${preloadPath}): ${error instanceof Error ? error.message : String(error)}`)
    dismissSplash()
  })

  window.webContents.on('did-finish-load', () => {
    splashCanReceive = true
    sendSplashStage()
  })

  tracePhase('splash window created')
  labelWindow(window, 'splash')
  splashWindow = window
  // A splash that cannot load is a cosmetic loss, not a startup failure: drop
  // it and let the workbench window reveal on first paint as it did before.
  window.loadFile(path.join(__dirname, 'splash.html')).catch((error) => {
    console.warn(`[splash] Could not load the launch splash: ${error instanceof Error ? error.message : String(error)}`)
    dismissSplash()
  })
}

function dismissSplash() {
  const window = splashWindow
  splashWindow = null
  splashCanReceive = false
  splashShownAt = null
  // The paint listener outlives the window it was registered for otherwise, and
  // a macOS 'activate' reopen would build a second splash while the first one's
  // one-shot was still pending against a destroyed window.
  ipcMain.removeAllListeners(SPLASH_PAINTED_CHANNEL)
  if (window && !window.isDestroyed()) {
    tracePhase('splash dismissed')
    window.destroy()
  }
}

// How long to keep the splash up before starting its outro, so that a launch
// quick enough to outrun it still shows a splash rather than a flicker.
function splashHoldMs() {
  if (!splashWindow || splashShownAt === null) return 0
  return Math.max(0, SPLASH_MIN_VISIBLE_MS - SPLASH_OUTRO_MS - (Date.now() - splashShownAt))
}

// The renderer-ready channel is registered once at startup, but the window it
// has to reveal is whichever one is currently waiting -- including one built
// by a later 'activate' reopen, long after the splash is gone.
let revealCurrentWindow = null

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f172a',
    // Held back until 'ready-to-show' below instead of appearing immediately:
    // an immediately-shown window is blank until the renderer's first paint,
    // which on a slow launch is exactly the "did this even open?" window the
    // loading skeleton (index.html) exists to avoid. Because that skeleton is
    // static HTML with no script dependency, 'ready-to-show' -- which waits
    // for a first paint, not for the app to finish loading -- fires with the
    // skeleton already on screen rather than after the full bundle is ready.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  // With a splash on screen the window waits for the renderer to report the
  // workbench mounted, not for 'ready-to-show'. 'ready-to-show' fires at the
  // skeleton's first paint, which under a splash would mean raising a
  // half-built window behind it and then swapping to that same window a
  // second later. Without a splash -- a macOS 'activate' reopen -- there is
  // nothing to wait behind, so first paint is still the right moment and the
  // skeleton carries the wait exactly as it did before.
  let revealed = false
  let revealTimer = null
  const reveal = () => {
    if (revealed || window.isDestroyed()) return
    revealed = true
    clearTimeout(revealTimer)
    revealCurrentWindow = null
    // No splash, or one whose artwork never painted and so was never shown:
    // there is nothing on screen to hand off from, and holding the workbench
    // back for an invisible window would be pure added latency.
    tracePhase('workbench revealed')
    if (!splashWindow || splashShownAt === null) {
      dismissSplash()
      window.show()
      warmKmlLibrary()
      exitAfterStartupIfAsked()
      return
    }
    // The workbench is ready, but the splash may only just have appeared.
    // Let it finish being seen, still cycling its current stage, before the
    // bar runs to 100% and the windows swap.
    setTimeout(() => {
      tracePhase('workbench mounted')
      splashStage('ready')
      setTimeout(() => {
        if (!window.isDestroyed()) {
          window.show()
          window.focus()
        }
        // Dismissed after the workbench window is up, never before: the other
        // order leaves a beat with no window of ours on screen at all.
        dismissSplash()
        warmKmlLibrary()
        exitAfterStartupIfAsked()
      }, SPLASH_OUTRO_MS)
    }, splashHoldMs())
  }
  revealCurrentWindow = reveal
  labelWindow(window, 'workbench')

  // Defensive: if the ready signal never arrives -- 'ready-to-show' swallowed
  // (observed to be flaky on some Linux/GPU combinations for other Electron
  // apps), or a bundle that throws before React mounts -- the window must not
  // stay permanently invisible with no way for the user to know why. The
  // skeleton is on screen by then and carries the failure text itself.
  revealTimer = setTimeout(reveal, splashWindow ? SPLASH_TIMEOUT_MS : 1000)
  // `splashShownAt === null`, NOT `!splashWindow`. The difference is the whole
  // bug this once caused: the old guard asked whether a splash OBJECT existed,
  // so a splash that was constructed but never became visible suppressed the
  // workbench's own first-paint reveal as well -- and then the only thing left
  // on screen's behalf was the 8-second timer above. That turned a failed splash
  // into a launch showing nothing at all for eight seconds, where before the
  // splash existed index.html's skeleton appeared at first paint in a few
  // hundred milliseconds. Asking whether a splash is actually VISIBLE restores
  // that floor: if it is, it covers the gap and the workbench waits its turn; if
  // it is not, the skeleton goes up immediately, exactly as it used to.
  window.once('ready-to-show', () => { if (splashShownAt === null) reveal() })

  window.webContents.once('dom-ready', () => { tracePhase('renderer dom-ready'); splashStage('renderer') })
  window.webContents.once('did-finish-load', () => { tracePhase('renderer loaded'); splashStage('workbench') })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppUrl(url, useDevServer, packagedRendererUrl)) {
      event.preventDefault()
      if (url.startsWith('https://')) void shell.openExternal(url)
    }
  })

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  // loadURL/loadFile reject when the dev server is down or dist/ is missing;
  // unawaited that is a blank window with no explanation anywhere.
  const load = useDevServer
    ? window.loadURL(DEV_ORIGIN)
    : window.loadFile(path.join(__dirname, '../dist/index.html'))
  load.catch((error) => {
    reportFatal(useDevServer ? `Could not load the dev server at ${DEV_ORIGIN}` : 'Could not load the packaged renderer', error)
  })
  // Development only. A detached DevTools is a window of its own, so
  // test/electron-launch.ts turns it off to count only the app's windows.
  if (useDevServer && !process.env.JDDC_NO_DEVTOOLS) window.webContents.openDevTools({ mode: 'detach' })

  // The guide is a child of the workbench in lifetime, not in stacking: left
  // open it would keep the app running with no workbench, because
  // 'window-all-closed' never fires while it exists.
  window.on('closed', () => {
    if (guideWindow && !guideWindow.isDestroyed()) guideWindow.close()
  })

  // `forceClose` breaks the recursion: the second close() must pass straight
  // through this handler rather than prompt again.
  let forceClose = false
  window.on('close', (event) => {
    if (forceClose || !hasUnsavedChanges) return
    event.preventDefault()
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: ['Close without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'Unsaved changes',
      message: 'This project has unsaved changes.',
      detail: 'Closing now discards every change made since the last save.',
    })
    if (choice === 0) {
      forceClose = true
      window.close()
    }
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    reportFatal('The renderer process stopped', new Error(`${details.reason}${details.exitCode ? ` (exit ${details.exitCode})` : ''}`))
  })

  return window
}

// Lets test/electron-launch.ts assert on a completed startup without having to
// kill a GUI process and race its output. JDDC_SMOKE_OPEN_GUIDE additionally
// opens the user guide first and waits for it to load, which is the only way to
// prove the guide renders from inside a packaged app's asar.
function exitAfterStartupIfAsked() {
  if (!process.env.JDDC_EXIT_AFTER_STARTUP) return
  const quit = () => {
    tracePhase('exiting after startup (JDDC_EXIT_AFTER_STARTUP)')
    app.quit()
  }
  // JDDC_SMOKE_REPORT_PDF: render a small report through the same function the
  // "Save PDF" IPC uses, and trace the result. The save dialog is the only part
  // left out, since nothing can click it.
  const pdfCheck = process.env.JDDC_SMOKE_REPORT_PDF
    ? renderReportPdf('<!doctype html><html><head><meta charset="utf-8"><title>smoke</title></head><body><h1>JDDC report PDF smoke</h1></body></html>')
      .then((pdf) => tracePhase(`report PDF rendered (${pdf.length} bytes, ${pdf.subarray(0, 5).toString('latin1')})`))
      .catch((error) => tracePhase(`report PDF failed (${error instanceof Error ? error.message : String(error)})`))
    : Promise.resolve()
  if (!process.env.JDDC_SMOKE_OPEN_GUIDE) return void pdfCheck.then(quit)
  const guide = openUserGuideWindow()
  const timer = setTimeout(quit, 10_000)
  guide.webContents.once('did-finish-load', () => { clearTimeout(timer); void pdfCheck.then(() => setTimeout(quit, 200)) })
  guide.webContents.once('did-fail-load', (_event, code, description) => {
    tracePhase(`user guide failed to load (${code} ${description})`)
    clearTimeout(timer)
    quit()
  })
}

function kmlLibraryDir() {
  const configured = process.env.JDDC_KML_LIBRARY_DIR
  if (configured) return path.resolve(configured)
  if (isDev) return path.resolve(process.cwd(), 'KML-KMZ')
  return path.join(app.getPath('userData'), 'KML-KMZ')
}

function kmlSeedDirectory() {
  return isDev
    ? path.resolve(process.cwd(), 'KML-KMZ')
    : path.join(process.resourcesPath, 'kml-seed')
}

// Remote overlay repositories for lazy loading
const REMOTE_KML_OVERLAYS = {
  'Special_Use_Airspace.kml': 'https://raw.githubusercontent.com/A13Xg/Joint-Domain-Data-Compiler/data/KML-KMZ/Special_Use_Airspace.kml',
}

// Ensure KML library directory exists and fetch missing overlays from remote
async function ensureKmlLibraryDir() {
  const dir = kmlLibraryDir()
  fs.mkdirSync(dir, { recursive: true })

  // Seed from local directory if dev mode or if bundled seed is available
  await seedKmlLibraryAsync(kmlSeedDirectory(), dir)

  // Fetch missing overlays from remote (non-blocking, continues on error)
  if (!isDev) {
    for (const [fileName, remoteUrl] of Object.entries(REMOTE_KML_OVERLAYS)) {
      const filePath = path.join(dir, fileName)
      if (!fs.existsSync(filePath)) {
        const result = await fetchKmlFromRemote(filePath, remoteUrl)
        if (result.success) {
          console.log(`[KML] Fetched ${fileName} (${result.bytes} bytes)`)
        } else {
          console.warn(`[KML] Failed to fetch ${fileName}: ${result.error}`)
        }
      }
    }
  }

  return dir
}

// Deliberately deferred until the workbench window is on screen, and
// deliberately not awaited.
//
// This used to run in `ready`, between opening the splash and the splash's
// first paint. Its first act is a synchronous 23 MB copyFileSync of the
// bundled airspace overlay into userData on a first launch, which blocks the
// main process: the splash's own 'ready-to-show' cannot be delivered while it
// runs, so the launch that most needed a splash was the launch least likely to
// show one. Nothing needs the library before the map is opened, and the IPC
// handlers call ensureKmlLibraryDir() themselves, so this is only a cache
// warm and is safe anywhere after startup.
function warmKmlLibrary() {
  ensureKmlLibraryDir().catch((error) => {
    console.warn('[KML] Background overlay warm-up failed:', error.message)
  })
}

function libraryPath(name) {
  const dir = kmlLibraryDir()
  return resolveLibraryPath(dir, name)
}

// A safety-net duplicate of every dataset a user imports or exports, kept
// outside the OS Downloads folder so it survives a misplaced/overwritten
// download. Mirrors kmlLibraryDir()'s override/dev/packaged resolution.
function fileArchiveBaseDir() {
  const configured = process.env.JDDC_ARCHIVE_DIR
  if (configured) return path.resolve(configured)
  if (isDev) return path.resolve(process.cwd(), '.jddc-archive')
  return path.join(app.getPath('userData'), 'archive')
}

function fileArchiveDir(direction) {
  if (!ARCHIVE_DIRECTIONS.includes(direction)) throw new Error(`Invalid archive direction: ${direction}`)
  const dir = path.join(fileArchiveBaseDir(), direction)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Oldest-first pruning keeps the archive a bounded safety net instead of an
// unbounded copy of every file the app ever touches.
function pruneFileArchiveDir(dir, maxTotalBytes) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(dir, entry.name) // nosemgrep
      const stat = fs.statSync(filePath)
      return { filePath, bytes: stat.size, mtimeMs: stat.mtimeMs }
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0)
  for (const entry of entries) {
    if (total <= maxTotalBytes) break
    fs.rmSync(entry.filePath, { force: true })
    total -= entry.bytes
  }
}

function dosDateTimeToMs(date, time) {
  const day = date & 0x1f
  // A zero month field is out of spec; clamping keeps it from rolling the
  // reported timestamp back into the previous year.
  const month = Math.min(11, Math.max(0, ((date >> 5) & 0x0f) - 1))
  const year = ((date >> 9) & 0x7f) + 1980
  const second = (time & 0x1f) * 2
  const minute = (time >> 5) & 0x3f
  const hour = (time >> 11) & 0x1f
  return Date.UTC(year, month, day || 1, hour, minute, second)
}

// Every offset and length below is read FROM the archive being parsed, so all of
// them are untrusted. Node's Buffer readers throw ERR_OUT_OF_RANGE on a bad
// offset — a message that says nothing about which file is broken — so bounds
// are checked explicitly and reported as a KMZ problem.
function readU16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.length) throw new Error('KMZ archive is truncated or its index is corrupt')
  return bytes.readUInt16LE(offset)
}

function readU32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) throw new Error('KMZ archive is truncated or its index is corrupt')
  return bytes.readUInt32LE(offset)
}

function firstKmlFromKmz(bytes) {
  const eocdMinSize = 22
  if (!Buffer.isBuffer(bytes)) throw new Error('KMZ payload must be binary data')
  if (bytes.length < eocdMinSize) throw new Error('KMZ archive is too small to be a valid ZIP')
  for (let eocd = bytes.length - eocdMinSize; eocd >= Math.max(0, bytes.length - 65557); eocd--) {
    if (readU32(bytes, eocd) !== 0x06054b50) continue
    const entries = readU16(bytes, eocd + 10)
    const centralOffset = readU32(bytes, eocd + 16)
    if (centralOffset >= bytes.length) throw new Error('KMZ central directory offset is outside the archive')
    let cursor = centralOffset
    for (let i = 0; i < entries; i++) {
      if (cursor + 46 > bytes.length) throw new Error('KMZ central directory is truncated')
      if (readU32(bytes, cursor) !== 0x02014b50) break
      const method = readU16(bytes, cursor + 10)
      const modifiedTime = readU16(bytes, cursor + 12)
      const modifiedDate = readU16(bytes, cursor + 14)
      const compressedSize = readU32(bytes, cursor + 20)
      const uncompressedSize = readU32(bytes, cursor + 24)
      const nameLen = readU16(bytes, cursor + 28)
      const extraLen = readU16(bytes, cursor + 30)
      const commentLen = readU16(bytes, cursor + 32)
      const localOffset = readU32(bytes, cursor + 42)
      if (cursor + 46 + nameLen > bytes.length) throw new Error('KMZ entry name is truncated')
      const entryName = bytes.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8')
      if (entryName.toLowerCase().endsWith('.kml')) {
        if (uncompressedSize > MAX_KML_LIBRARY_BYTES) throw new Error('Embedded KML exceeds safety limit')
        if (readU32(bytes, localOffset) !== 0x04034b50) throw new Error('KMZ local file header is invalid')
        const localNameLen = readU16(bytes, localOffset + 26)
        const localExtraLen = readU16(bytes, localOffset + 28)
        const start = localOffset + 30 + localNameLen + localExtraLen
        if (start > bytes.length || compressedSize > bytes.length - start) throw new Error('KMZ compressed entry is truncated')
        const payload = bytes.subarray(start, start + compressedSize)
        let content
        if (method === 0) {
          content = payload
        } else if (method === 8) {
          try {
            content = zlib.inflateRawSync(payload, { maxOutputLength: MAX_KML_LIBRARY_BYTES })
          } catch (error) {
            throw new Error(
              `KMZ embedded KML could not be decompressed: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            )
          }
        } else {
          throw new Error(`Unsupported KMZ compression method ${method}`)
        }
        if (content.length > MAX_KML_LIBRARY_BYTES || content.length !== uncompressedSize) {
          throw new Error('KMZ embedded KML size is invalid or exceeds safety limit')
        }
        return { text: content.toString('utf8'), entryName, modifiedAt: dosDateTimeToMs(modifiedDate, modifiedTime) }
      }
      const next = cursor + 46 + nameLen + extraLen + commentLen
      if (next <= cursor) throw new Error('KMZ central directory entry has an invalid length')
      cursor = next
    }
  }
  throw new Error('KMZ archive does not contain a .kml entry')
}

function registerKmlLibraryIpc() {
  ipcMain.handle(IPC_CHANNELS.list, async () => {
    const dir = await ensureKmlLibraryDir()
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.km?l$/i.test(entry.name))
      .map((entry) => {
        // `entry.name` is an OS-reported directory-entry name from the
        // readdirSync call on `dir` above, not attacker-controlled input.
        const stat = fs.statSync(path.join(dir, entry.name)) // nosemgrep
        return { name: entry.name, bytes: stat.size, modifiedAt: stat.mtimeMs, kind: path.extname(entry.name).toLowerCase().slice(1) }
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
  })

  ipcMain.handle(IPC_CHANNELS.save, async (_event, name, bytes) => {
    const filePath = libraryPath(name)
    const buffer = ipcBytes(bytes)
    fs.writeFileSync(filePath, buffer)
    const stat = fs.statSync(filePath)
    return { name: path.basename(filePath), bytes: stat.size, modifiedAt: stat.mtimeMs, kind: path.extname(filePath).toLowerCase().slice(1) }
  })

  ipcMain.handle(IPC_CHANNELS.readText, async (_event, name) => {
    const filePath = libraryPath(name)
    const stat = fs.statSync(filePath)
    if (stat.size > MAX_KML_LIBRARY_BYTES) throw new Error('KML/KMZ file exceeds safety limit')
    const buffer = fs.readFileSync(filePath)
    if (path.extname(filePath).toLowerCase() === '.kmz') return firstKmlFromKmz(buffer)
    return { text: buffer.toString('utf8'), entryName: path.basename(filePath), modifiedAt: stat.mtimeMs }
  })

  ipcMain.handle(IPC_CHANNELS.remove, async (_event, name) => {
    fs.rmSync(libraryPath(name), { force: true })
    return true
  })

  // Explicit "Fetch overlays" action. Fetches bundled/remote KML/KMZ files
  // that are missing from the library folder. In dev mode, copies from local
  // KML-KMZ/ directory; in production, fetches from remote GitHub repo.
  // Non-blocking: continues on network errors. Returns status of fetch attempt.
  ipcMain.handle(IPC_CHANNELS.reseed, async () => {
    const dir = kmlLibraryDir()
    fs.mkdirSync(dir, { recursive: true })

    const results = { local: [], remote: [], failed: [] }

    // Try local seed first (dev mode or if somehow bundled)
    const localSeeded = seedKmlLibrary(kmlSeedDirectory(), dir)
    results.local = localSeeded

    // Try remote fetch for any still-missing overlays
    if (!isDev) {
      for (const [fileName, remoteUrl] of Object.entries(REMOTE_KML_OVERLAYS)) {
        if (!localSeeded.includes(fileName)) {
          const filePath = path.join(dir, fileName)
          if (!fs.existsSync(filePath)) {
            const result = await fetchKmlFromRemote(filePath, remoteUrl)
            if (result.success) {
              results.remote.push(fileName)
            } else {
              results.failed.push({ file: fileName, error: result.error })
            }
          }
        }
      }
    }

    return results
  })

  ipcMain.handle(IPC_CHANNELS.reveal, async () => {
    const dir = await ensureKmlLibraryDir()
    // openPath resolves with an error STRING instead of rejecting, so an
    // unchecked call makes "Reveal" look like a no-op when it fails.
    const failure = await shell.openPath(dir)
    if (failure) throw new Error(`Could not open the KML/KMZ library folder: ${failure}`)
    return dir
  })
}

// The user guide, opened in a window of the app's own.
//
// It used to be handed to the OS with shell.openPath(). In a packaged build the
// guide lives INSIDE app.asar, and an asar archive is only a directory to
// Electron's own fs and loaders -- to the OS default browser the path does not
// exist, so the info button did nothing on the installed app while working
// perfectly from a dev checkout. Loading it here reads it straight out of the
// archive, needs no browser and no network, and keeps it beside the workbench.
let guideWindow = null

function userGuideUrl() {
  return useDevServer ? `${DEV_ORIGIN}/user-guide.html` : packagedGuideUrl
}

/** In-page anchors are the only navigation the guide window allows. */
function isUserGuideUrl(url) {
  if (typeof url !== 'string') return false
  const [withoutHash] = url.split('#')
  return withoutHash === userGuideUrl()
}

function openUserGuideWindow() {
  if (guideWindow && !guideWindow.isDestroyed()) {
    if (guideWindow.isMinimized()) guideWindow.restore()
    guideWindow.show()
    guideWindow.focus()
    return guideWindow
  }
  const window = new BrowserWindow({
    width: 1120,
    height: 880,
    minWidth: 640,
    minHeight: 480,
    title: 'Joint Domain Data Compiler — User Guide',
    backgroundColor: '#0f172a',
    // Shown at first paint, not on construction, so it never appears as an
    // empty frame -- the same rule every other window here follows.
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      // No preload: the guide is a static document and gets no API surface.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })
  labelWindow(window, 'user guide')
  guideWindow = window
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isUserGuideUrl(url)) return
    event.preventDefault()
    if (url.startsWith('https://')) void shell.openExternal(url)
  })
  window.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
  window.webContents.on('did-finish-load', () => tracePhase(`user guide loaded (${window.webContents.getTitle()})`))
  window.on('closed', () => { if (guideWindow === window) guideWindow = null })
  window.loadURL(userGuideUrl()).catch((error) => {
    console.warn(`[guide] Could not load the user guide: ${error instanceof Error ? error.message : String(error)}`)
    if (!window.isDestroyed()) window.destroy()
  })
  return window
}

function registerUserGuideIpc() {
  // Takes no argument from the renderer, so this handler can only ever open the
  // one document that ships with the app.
  ipcMain.handle(IPC_CHANNELS.openUserGuide, async () => {
    if (!useDevServer && !fs.existsSync(path.join(__dirname, '../dist/user-guide.html'))) {
      throw new Error('The user guide is not present in this build')
    }
    openUserGuideWindow()
    return userGuideUrl()
  })
}

// --- Suite windows (Playback / Graph) ---
//
// Opened on demand from the workbench's "Launch Playback"/"Launch Graph"
// buttons (docs/superpowers/specs/2026-09-27-jddc-suite-design.md §5). Modeled
// on openUserGuideWindow's singleton-per-window-type pattern above, NOT on
// createWindow's splash/close-confirmation machinery: these are read-only
// viewers with no dirty-state of their own, so they never touch the
// workbench's own module-level unsaved-changes flag or splash-reveal
// callback (see createWindow, above) at all, and never need those made
// per-window.
//
// Kept outside IPC_CHANNELS/preload.cjs on purpose, same as the splash
// channels above: this is not part of the workbench's own IPC surface, it is
// the transport between main and a *different* renderer (preload-suite.cjs),
// so duplicating the two channel names there (rather than importing them) is
// the same sandboxed-preload constraint preload.cjs's own comment documents.
const SUITE_LOAD_CHANNEL = 'suite:load'
const SUITE_READY_CHANNEL = 'suite:ready'
// How long to wait for a newly-opened suite window to report ready before
// warning that its queued payload is stuck. Generous because a cold suite
// window pays the same bundle-download cost the workbench does on first
// launch, just without a splash covering it.
const SUITE_READY_TIMEOUT_MS = 30_000
const SUITE_TITLES = Object.freeze({ playback: 'Playback', graph: 'Graph Analysis' })

const suiteWindows = { playback: null, graph: null }
// Set once a window's renderer has called `jddcSuite.ready()`; cleared when
// the window closes so a later relaunch waits for a fresh mount instead of
// sending into a torn-down renderer.
const suiteReady = { playback: false, graph: false }
// A payload queued because its window wasn't ready yet when launched.
const suitePendingPayloads = { playback: null, graph: null }

function suiteAppUrl(appType) {
  return useDevServer ? `${DEV_ORIGIN}/?app=${appType}` : `${packagedRendererUrl}?app=${appType}`
}

/** In-page anchors are the only navigation a suite window allows, same restriction as the guide window. */
function isSuiteAppUrl(url, appType) {
  if (typeof url !== 'string') return false
  const [withoutHash] = url.split('#')
  return withoutHash === suiteAppUrl(appType)
}

function openSuiteWindow(appType) {
  const existing = suiteWindows[appType]
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return existing
  }
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: `Joint Domain Data Compiler — ${SUITE_TITLES[appType]}`,
    backgroundColor: '#0b0f17',
    // Held back until first paint, same rule every window here follows.
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-suite.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })
  labelWindow(window, `${appType} window`)
  suiteWindows[appType] = window
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isSuiteAppUrl(url, appType)) return
    event.preventDefault()
    if (url.startsWith('https://')) void shell.openExternal(url)
  })
  window.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
  window.webContents.on('did-finish-load', () => tracePhase(`${appType} window loaded`))
  window.on('closed', () => {
    if (suiteWindows[appType] === window) suiteWindows[appType] = null
    suiteReady[appType] = false
    suitePendingPayloads[appType] = null
  })
  window.loadURL(suiteAppUrl(appType)).catch((error) => {
    console.warn(`[suite] Could not load the ${appType} window: ${error instanceof Error ? error.message : String(error)}`)
    if (!window.isDestroyed()) window.destroy()
  })
  return window
}

/**
 * Opens (or focuses) `appType`'s window and delivers `buffer` to it — right
 * away if that window's renderer has already reported ready, otherwise
 * queued until it does. `launchSuiteApp`'s own IPC handler below is the only
 * caller, but this stays a separate function so the ready/queue logic reads
 * apart from request validation.
 */
function deliverToSuiteWindow(appType, buffer) {
  const window = openSuiteWindow(appType)
  if (suiteReady[appType] && !window.isDestroyed()) {
    window.webContents.send(SUITE_LOAD_CHANNEL, { format: 'jddc-playback', payload: buffer })
    return
  }
  suitePendingPayloads[appType] = buffer
  const timeout = setTimeout(() => {
    if (suitePendingPayloads[appType] === buffer) {
      console.warn(`[suite] ${appType} window did not report ready within ${SUITE_READY_TIMEOUT_MS}ms; payload still queued`)
    }
  }, SUITE_READY_TIMEOUT_MS)
  window.once('closed', () => clearTimeout(timeout))
}

function registerSuiteIpc() {
  ipcMain.handle(IPC_CHANNELS.launchSuiteApp, async (_event, appType, bytes) => {
    if (!SUITE_APPS.includes(appType)) throw new Error(`Unknown suite app: ${String(appType)}`)
    const buffer = ipcBytes(bytes, MAX_ARCHIVE_FILE_BYTES)
    deliverToSuiteWindow(appType, buffer)
  })

  // Not scoped to IPC_CHANNELS.rendererReady's handler above: that one reveals
  // the *workbench* window behind the launch splash and has nothing to do
  // with these. `event.sender` identifies which suite window (if any) this
  // came from, so one listener serves both app types.
  ipcMain.on(SUITE_READY_CHANNEL, (event) => {
    for (const appType of SUITE_APPS) {
      const window = suiteWindows[appType]
      if (!window || window.isDestroyed() || window.webContents !== event.sender) continue
      suiteReady[appType] = true
      const payload = suitePendingPayloads[appType]
      if (payload) {
        window.webContents.send(SUITE_LOAD_CHANNEL, { format: 'jddc-playback', payload })
        suitePendingPayloads[appType] = null
      }
    }
  })
}

function registerFileArchiveIpc() {
  ipcMain.handle(IPC_CHANNELS.archiveFile, async (_event, direction, name, bytes) => {
    const dir = fileArchiveDir(direction)
    const buffer = ipcBytes(bytes, MAX_ARCHIVE_FILE_BYTES)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const unique = crypto.randomUUID().slice(0, 8)
    const fileName = `${stamp}_${unique}_${safeArchiveName(name)}`
    const filePath = resolveChildPath(dir, fileName)
    fs.writeFileSync(filePath, buffer)
    pruneFileArchiveDir(dir, MAX_ARCHIVE_TOTAL_BYTES)
    return { path: filePath, bytes: buffer.byteLength }
  })

  ipcMain.handle(IPC_CHANNELS.revealArchive, async () => {
    const dir = fileArchiveBaseDir()
    fs.mkdirSync(dir, { recursive: true })
    const failure = await shell.openPath(dir)
    if (failure) throw new Error(`Could not open the archive folder: ${failure}`)
    return dir
  })
}

function registerWindowStateIpc() {
  ipcMain.on(IPC_CHANNELS.setUnsavedChanges, (_event, dirty) => {
    hasUnsavedChanges = dirty === true
  })

  // The renderer's own report that the workbench has mounted -- the only
  // signal here that means the window is worth looking at, as opposed to
  // 'ready-to-show', which fires at the static skeleton's first paint. Sent
  // again after every dev-server hot reload; `reveal` is single-entry, so the
  // repeats are no-ops.
  ipcMain.on(IPC_CHANNELS.rendererReady, () => {
    if (revealCurrentWindow) revealCurrentWindow()
  })
}

function registerDiagnosticIpc() {
  ipcMain.handle(IPC_CHANNELS.saveDiagnostics, async (_event, text) => {
    const content = diagnosticBundleText(text)
    const result = await dialog.showSaveDialog({
      title: 'Save diagnostic bundle',
      defaultPath: `jddc-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON diagnostic bundle', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    fs.writeFileSync(result.filePath, content, 'utf8')
    return result.filePath
  })
}

// HTML report -> PDF. The report is loaded from a temp FILE rather than a data:
// URL (Chromium caps URLs at 2 MB, and a report with several datasets passes
// that), in a window that is never shown and runs no script: the report has
// none, and a generated document has no business executing any. The temp file
// is removed whatever happens.
async function renderReportPdf(html) {
  const text = reportHtmlText(html)
  const tempPath = path.join(os.tmpdir(), `jddc-report-${crypto.randomUUID()}.html`)
  fs.writeFileSync(tempPath, text, 'utf8')
  const renderer = new BrowserWindow({
    show: false,
    width: 1100,
    height: 1400,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, javascript: false },
  })
  labelWindow(renderer, 'report PDF renderer (hidden)')
  renderer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  renderer.webContents.on('will-navigate', (navigation) => navigation.preventDefault())
  try {
    await renderer.loadFile(tempPath)
    return await renderer.webContents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true })
  } finally {
    if (!renderer.isDestroyed()) renderer.destroy()
    fs.rmSync(tempPath, { force: true })
  }
}

function registerReportPdfIpc() {
  ipcMain.handle(IPC_CHANNELS.saveReportPdf, async (event, html, suggestedName) => {
    const pdf = await renderReportPdf(html)
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showSaveDialog(owner, {
      title: 'Save report as PDF',
      defaultPath: safePdfName(suggestedName),
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return null
    fs.writeFileSync(result.filePath, pdf)
    return result.filePath
  })
}

// A throw anywhere in startup used to surface only as an unhandled rejection on
// a console no packaged user ever sees, leaving a process running with no
// window. Show it and exit non-zero instead.
function reportFatal(context, error) {
  const message = error instanceof Error ? (error.stack || error.message) : String(error)
  console.error(`[main] ${context}: ${message}`)
  // Before the dialog, always: the splash is alwaysOnTop, so leaving it up
  // would hide the one thing explaining why the app is not starting.
  dismissSplash()
  try {
    dialog.showErrorBox('Joint Domain Data Compiler failed to start', `${context}\n\n${message}`)
  } catch {
    // dialog is unavailable before `ready`; the console line above is the readout.
  }
}

app.whenReady().then(async () => {
  tracePhase('app ready')
  // The workbench owns its visible navigation and commands. Remove Electron's
  // default File/Edit/View/Window menu in both development and packaged builds.
  Menu.setApplicationMenu(null)
  // First act of `ready`, ahead of every registration and filesystem touch
  // below, so the launch is acknowledged on screen in well under a second and
  // the rest of startup happens behind it. Caught rather than reported: the
  // splash is decoration, and a window manager that refuses to give it a
  // window must not turn a launch that would otherwise have worked into a
  // fatal one. With `splashWindow` left null, createWindow() reveals on first
  // paint exactly as it did before the splash existed.
  try {
    openSplash()
  } catch (error) {
    console.warn(`[splash] Could not open the launch splash: ${error instanceof Error ? error.message : String(error)}`)
    dismissSplash()
  }
  registerKmlLibraryIpc()
  registerFileArchiveIpc()
  registerDiagnosticIpc()
  registerWindowStateIpc()
  registerUserGuideIpc()
  registerReportPdfIpc()
  registerSuiteIpc()

  tracePhase('startup services registered')
  createWindow()
  tracePhase('workbench window created')

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        createWindow()
      } catch (error) {
        reportFatal('Could not reopen the window', error)
      }
    }
  })
}).catch((error) => {
  reportFatal('Startup failed', error)
  app.exit(1)
})

process.on('uncaughtException', (error) => {
  reportFatal('Unexpected main-process error', error)
})

process.on('unhandledRejection', (reason) => {
  reportFatal('Unhandled main-process rejection', reason)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

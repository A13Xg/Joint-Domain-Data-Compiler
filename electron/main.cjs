const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const zlib = require('zlib')
const { seedKmlLibrary, fetchKmlFromRemote } = require('./kml-seed.cjs')
const {
  ARCHIVE_DIRECTIONS,
  DEV_ORIGIN,
  IPC_CHANNELS,
  MAX_ARCHIVE_FILE_BYTES,
  MAX_ARCHIVE_TOTAL_BYTES,
  MAX_KML_LIBRARY_BYTES,
  diagnosticBundleText,
  ipcBytes,
  isAllowedAppUrl,
  resolveChildPath,
  resolveLibraryPath,
  safeArchiveName,
} = require('./security.cjs')

const isDev = !app.isPackaged
const packagedRendererUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).href

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
    progress: 0.52,
    items: ['Loading the workbench', 'React runtime', 'Stylesheets', 'Application log'],
  },
  workbench: {
    progress: 0.86,
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

  // Shown on first paint rather than at construction. `show: true` does map
  // the window immediately -- verified against a deliberately blocked main
  // thread -- but Chromium paints it WHITE until the document commits, and a
  // white rectangle on a dark app reads as a fault, not as a launch. Waiting
  // for the real pixels costs about 200 ms and is the difference between a
  // splash and a flash of the wrong colour.
  const markShown = () => {
    if (window.isDestroyed() || splashShownAt !== null) return
    splashShownAt = Date.now()
    window.show()
  }
  // Shown when splash-preload.cjs reports the artwork composited -- NOT on
  // 'ready-to-show' or 'did-finish-load'. Both of those fire before a CSS
  // background-image has decoded, so showing on either put the window up
  // painted in nothing but `backgroundColor`: a black box that sat there until
  // the art caught up, and on a fast launch closed again before it ever did.
  ipcMain.once(SPLASH_PAINTED_CHANNEL, markShown)

  // There is deliberately no timeout that shows the window anyway. Every
  // version of that idea shipped the bug it was meant to guard against: at
  // 400 ms and at 1200 ms it beat the artwork on a cold start and put a blank
  // rectangle on screen, and at 2500 ms it sat past the point where a fast
  // launch had already retired the splash, so it never fired at all. A splash
  // is decoration; if its art cannot be painted, the right outcome is the
  // launch it replaced -- no splash -- not a coloured box pretending to be one.
  // reveal() treats a never-shown splash as absent and hands off immediately.

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => { event.preventDefault() })

  window.webContents.on('did-finish-load', () => {
    splashCanReceive = true
    sendSplashStage()
  })

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
  if (window && !window.isDestroyed()) window.destroy()
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
    if (!splashWindow || splashShownAt === null) {
      dismissSplash()
      window.show()
      warmKmlLibrary()
      return
    }
    // The workbench is ready, but the splash may only just have appeared.
    // Let it finish being seen, still cycling its current stage, before the
    // bar runs to 100% and the windows swap.
    setTimeout(() => {
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
      }, SPLASH_OUTRO_MS)
    }, splashHoldMs())
  }
  revealCurrentWindow = reveal

  // Defensive: if the ready signal never arrives -- 'ready-to-show' swallowed
  // (observed to be flaky on some Linux/GPU combinations for other Electron
  // apps), or a bundle that throws before React mounts -- the window must not
  // stay permanently invisible with no way for the user to know why. The
  // skeleton is on screen by then and carries the failure text itself.
  revealTimer = setTimeout(reveal, splashWindow ? SPLASH_TIMEOUT_MS : 1000)
  window.once('ready-to-show', () => { if (!splashWindow) reveal() })

  window.webContents.once('dom-ready', () => splashStage('renderer'))
  window.webContents.once('did-finish-load', () => splashStage('workbench'))

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppUrl(url, isDev, packagedRendererUrl)) {
      event.preventDefault()
      if (url.startsWith('https://')) void shell.openExternal(url)
    }
  })

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  // loadURL/loadFile reject when the dev server is down or dist/ is missing;
  // unawaited that is a blank window with no explanation anywhere.
  const load = isDev
    ? window.loadURL(DEV_ORIGIN)
    : window.loadFile(path.join(__dirname, '../dist/index.html'))
  load.catch((error) => {
    reportFatal(isDev ? `Could not load the dev server at ${DEV_ORIGIN}` : 'Could not load the packaged renderer', error)
  })
  if (isDev) window.webContents.openDevTools({ mode: 'detach' })

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
  seedKmlLibrary(kmlSeedDirectory(), dir)

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

function registerUserGuideIpc() {
  ipcMain.handle(IPC_CHANNELS.openUserGuide, async () => {
    // Resolved here rather than passed in from the renderer, so this handler
    // can only ever open the one document that ships with the app.
    const guidePath = path.join(__dirname, '../dist/user-guide.html')
    if (!fs.existsSync(guidePath)) throw new Error('The user guide is not present in this build')
    // openPath resolves with an error STRING instead of rejecting, so an
    // unchecked call makes the info button look like a no-op when it fails.
    const failure = await shell.openPath(guidePath)
    if (failure) throw new Error(`Could not open the user guide: ${failure}`)
    return guidePath
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

  createWindow()

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

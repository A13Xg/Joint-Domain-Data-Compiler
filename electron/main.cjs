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

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

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
  registerKmlLibraryIpc()
  registerFileArchiveIpc()
  registerDiagnosticIpc()
  registerWindowStateIpc()

  // Fetch KML overlays in background (non-blocking startup)
  // This ensures they're cached locally before the user opens the map
  ensureKmlLibraryDir().catch((error) => {
    console.warn('[KML] Background fetch failed:', error.message)
  })

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

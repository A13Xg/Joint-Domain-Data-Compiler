const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const zlib = require('zlib')
const { seedKmlLibrary } = require('./kml-seed.cjs')
const {
  DEV_ORIGIN,
  IPC_CHANNELS,
  MAX_KML_LIBRARY_BYTES,
  diagnosticBundleText,
  ipcBytes,
  isAllowedAppUrl,
  resolveLibraryPath,
} = require('./security.cjs')

const isDev = !app.isPackaged
const packagedRendererUrl = pathToFileURL(path.join(__dirname, '../dist/index.html')).href

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

  if (isDev) {
    window.loadURL(DEV_ORIGIN)
    window.webContents.openDevTools({ mode: 'detach' })
  } else {
    window.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function kmlLibraryDir() {
  const configured = process.env.JDDC_KML_LIBRARY_DIR
  if (configured) return path.resolve(configured)
  if (isDev) return path.resolve(process.cwd(), 'KML-KMZ')
  return path.join(app.getPath('userData'), 'KML-KMZ')
}

function ensureKmlLibraryDir() {
  const dir = kmlLibraryDir()
  fs.mkdirSync(dir, { recursive: true })
  const seedDirectory = isDev
    ? path.resolve(process.cwd(), 'KML-KMZ')
    : path.join(process.resourcesPath, 'kml-seed')
  seedKmlLibrary(seedDirectory, dir)
  return dir
}

function libraryPath(name) {
  const dir = ensureKmlLibraryDir()
  return resolveLibraryPath(dir, name)
}

function dosDateTimeToMs(date, time) {
  const day = date & 0x1f
  const month = ((date >> 5) & 0x0f) - 1
  const year = ((date >> 9) & 0x7f) + 1980
  const second = (time & 0x1f) * 2
  const minute = (time >> 5) & 0x3f
  const hour = (time >> 11) & 0x1f
  return Date.UTC(year, month, day || 1, hour, minute, second)
}

function firstKmlFromKmz(bytes) {
  const eocdMinSize = 22
  for (let eocd = bytes.length - eocdMinSize; eocd >= Math.max(0, bytes.length - 65557); eocd--) {
    if (bytes.readUInt32LE(eocd) !== 0x06054b50) continue
    const entries = bytes.readUInt16LE(eocd + 10)
    const centralOffset = bytes.readUInt32LE(eocd + 16)
    let cursor = centralOffset
    for (let i = 0; i < entries; i++) {
      if (bytes.readUInt32LE(cursor) !== 0x02014b50) break
      const method = bytes.readUInt16LE(cursor + 10)
      const modifiedTime = bytes.readUInt16LE(cursor + 12)
      const modifiedDate = bytes.readUInt16LE(cursor + 14)
      const compressedSize = bytes.readUInt32LE(cursor + 20)
      const uncompressedSize = bytes.readUInt32LE(cursor + 24)
      const nameLen = bytes.readUInt16LE(cursor + 28)
      const extraLen = bytes.readUInt16LE(cursor + 30)
      const commentLen = bytes.readUInt16LE(cursor + 32)
      const localOffset = bytes.readUInt32LE(cursor + 42)
      const entryName = bytes.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8')
      if (entryName.toLowerCase().endsWith('.kml')) {
        if (uncompressedSize > MAX_KML_LIBRARY_BYTES) throw new Error('Embedded KML exceeds safety limit')
        if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('KMZ local file header is invalid')
        const localNameLen = bytes.readUInt16LE(localOffset + 26)
        const localExtraLen = bytes.readUInt16LE(localOffset + 28)
        const start = localOffset + 30 + localNameLen + localExtraLen
        if (start > bytes.length || compressedSize > bytes.length - start) throw new Error('KMZ compressed entry is truncated')
        const payload = bytes.subarray(start, start + compressedSize)
        const content = method === 0
          ? payload
          : method === 8
            ? zlib.inflateRawSync(payload, { maxOutputLength: MAX_KML_LIBRARY_BYTES })
            : null
        if (!content) throw new Error(`Unsupported KMZ compression method ${method}`)
        if (content.length > MAX_KML_LIBRARY_BYTES || content.length !== uncompressedSize) {
          throw new Error('KMZ embedded KML size is invalid or exceeds safety limit')
        }
        return { text: content.toString('utf8'), entryName, modifiedAt: dosDateTimeToMs(modifiedDate, modifiedTime) }
      }
      cursor += 46 + nameLen + extraLen + commentLen
    }
  }
  throw new Error('KMZ archive does not contain a .kml entry')
}

function registerKmlLibraryIpc() {
  ipcMain.handle(IPC_CHANNELS.list, async () => {
    const dir = ensureKmlLibraryDir()
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

  ipcMain.handle(IPC_CHANNELS.reveal, async () => {
    const dir = ensureKmlLibraryDir()
    await shell.openPath(dir)
    return dir
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

app.whenReady().then(() => {
  // The workbench owns its visible navigation and commands. Remove Electron's
  // default File/Edit/View/Window menu in both development and packaged builds.
  Menu.setApplicationMenu(null)
  registerKmlLibraryIpc()
  registerDiagnosticIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

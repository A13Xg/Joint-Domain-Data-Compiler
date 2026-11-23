const { contextBridge, ipcRenderer } = require('electron')

// Sandboxed preload scripts (webPreferences.sandbox: true, set in main.cjs) run
// through Electron's restricted preload loader, which only resolves `electron`
// and Node built-ins — requiring a sibling local file throws "module not
// found" there even though the same require works fine in the (unsandboxed)
// main process. These channel names are duplicated from security.cjs rather
// than shared, so this file stays a single, self-contained module the
// sandboxed loader can actually load. Keep in sync with IPC_CHANNELS there.
const IPC_CHANNELS = Object.freeze({
  archiveFile: 'file-archive:save',
  list: 'kml-library:list',
  save: 'kml-library:save',
  readText: 'kml-library:read-text',
  remove: 'kml-library:remove',
  rendererReady: 'window:renderer-ready',
  reseed: 'kml-library:reseed',
  reveal: 'kml-library:reveal',
  revealArchive: 'file-archive:reveal',
  openUserGuide: 'user-guide:open',
  saveDiagnostics: 'diagnostics:save',
  saveReportPdf: 'report:save-pdf',
  setUnsavedChanges: 'window:set-unsaved-changes',
  launchSuiteApp: 'suite:launch',
})

contextBridge.exposeInMainWorld('jointDomainCompiler', {
  platform: process.platform,
  isDesktop: true,
  kmlLibrary: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.list),
    save: (name, bytes) => ipcRenderer.invoke(IPC_CHANNELS.save, name, bytes),
    readText: (name) => ipcRenderer.invoke(IPC_CHANNELS.readText, name),
    remove: (name) => ipcRenderer.invoke(IPC_CHANNELS.remove, name),
    reseed: () => ipcRenderer.invoke(IPC_CHANNELS.reseed),
    reveal: () => ipcRenderer.invoke(IPC_CHANNELS.reveal),
  },
  diagnostics: {
    save: (text) => ipcRenderer.invoke(IPC_CHANNELS.saveDiagnostics, text),
  },
  // Renders a generated HTML report to PDF in the main process and asks where
  // to save it. Resolves with the saved path, or null if the user cancelled.
  saveReportPdf: (html, suggestedName) => ipcRenderer.invoke(IPC_CHANNELS.saveReportPdf, html, suggestedName),
  // Opens the packaged user guide in an app window. Takes no argument
  // on purpose: the path is resolved in the main process, so the renderer can
  // never ask it to open an arbitrary file.
  openUserGuide: () => ipcRenderer.invoke(IPC_CHANNELS.openUserGuide),
  fileArchive: {
    save: (direction, name, bytes) => ipcRenderer.invoke(IPC_CHANNELS.archiveFile, direction, name, bytes),
    reveal: () => ipcRenderer.invoke(IPC_CHANNELS.revealArchive),
  },
  // Fire-and-forget: the renderer reports dirtiness, the main process owns the
  // close confirmation. See the `close` handler in main.cjs for why the
  // renderer cannot do this itself with `beforeunload`.
  setUnsavedChanges: (dirty) => ipcRenderer.send(IPC_CHANNELS.setUnsavedChanges, dirty === true),
  // Also fire-and-forget: reports that the workbench has actually mounted, so
  // the main process can retire the launch splash and raise a finished window
  // instead of a half-painted one. Takes no argument and returns nothing --
  // the renderer cannot ask for anything with it.
  notifyRendererReady: () => ipcRenderer.send(IPC_CHANNELS.rendererReady),
  // Opens (or focuses) the Playback/Graph window and delivers `bytes` (a
  // gzip .jddc-playback archive) to it once that window's renderer is ready.
  // `appType` is validated in the main process against the same closed
  // SUITE_APPS list this call site can't see — the renderer cannot open any
  // window this wasn't already going to allow.
  launchSuiteApp: (appType, bytes) => ipcRenderer.invoke(IPC_CHANNELS.launchSuiteApp, appType, bytes),
})

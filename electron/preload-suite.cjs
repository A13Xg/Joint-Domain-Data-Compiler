const { contextBridge, ipcRenderer } = require('electron')

// Preload for the Playback/Graph suite windows — deliberately NOT the
// workbench's preload.cjs. Those windows are read-only viewers with none of
// the workbench-only API surface (local file storage, the bundled overlay
// library, bug-report export, close confirmation) to expose, so this bridge
// carries only the two messages the suite launch handshake needs (see
// docs/superpowers/specs/2026-09-27-jddc-suite-design.md §5).
// Sandboxed (webPreferences.sandbox: true, set where this window is created
// in main.cjs), so — same constraint preload.cjs's own comment documents —
// this channel name is duplicated rather than required from security.cjs.
const SUITE_LOAD_CHANNEL = 'suite:load'
const SUITE_READY_CHANNEL = 'suite:ready'

contextBridge.exposeInMainWorld('jddcSuite', {
  isDesktop: true,
  // Fire-and-forget: tells the main process this window's renderer has
  // mounted and can receive a queued payload. Takes the app type so main can
  // route it in an "activate" edge case (macOS re-showing an already-open
  // window rather than constructing a new one, so the ready message races
  // window creation) — main knows independently which window sent this
  // through `event.sender`, but passing it here keeps the two sides
  // consistent without relying on that.
  ready: (appType) => ipcRenderer.send(SUITE_READY_CHANNEL, appType),
  // Registers a persistent listener, not a one-shot: relaunching from the
  // workbench while this window is already open reuses it and pushes a new
  // payload rather than opening a second window, so more than one 'suite:load'
  // can arrive over this window's lifetime. There is no unsubscribe surface
  // because nothing in this app ever needs to stop listening.
  onLoad: (callback) => {
    ipcRenderer.on(SUITE_LOAD_CHANNEL, (_event, payload) => callback(payload))
  },
})

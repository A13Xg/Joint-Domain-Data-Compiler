const { ipcRenderer } = require('electron')

// Unlike preload.cjs this exposes nothing through contextBridge. A preload runs
// in an isolated world but against the page's own DOM, and page CSP does not
// apply to it -- so driving the splash from here lets splash.html ship with
// `script-src 'none'` and no renderer-facing API surface at all. Everything
// visual (easing, fades, the pulsing bar head) lives in that file's CSS; this
// only sets a width, swaps a string, and toggles one class.
//
// Keep the channel name in sync with SPLASH_STAGE_CHANNEL in main.cjs. It is
// deliberately NOT in security.cjs's IPC_CHANNELS: that object is the
// workbench's renderer surface, mirrored into preload.cjs and asserted
// one-for-one by test/electron-integration.ts, and the splash is neither.
const SPLASH_STAGE_CHANNEL = 'splash:stage'
const ITEM_INTERVAL_MS = 470
const SWAP_FADE_MS = 180

let view = null
// A stage can land before the document parses; the splash window is created
// and messaged from the same startup tick that loads it.
let queuedStage = null
let itemTimer = null
let swapTimer = null

function showItems(items) {
  clearInterval(itemTimer)
  clearTimeout(swapTimer)
  if (items.length === 0) return

  view.item.classList.remove('is-swapping')
  view.item.textContent = items[0]
  if (items.length === 1) return

  let index = 0
  itemTimer = setInterval(() => {
    index = (index + 1) % items.length
    const next = items[index]
    view.item.classList.add('is-swapping')
    swapTimer = setTimeout(() => {
      view.item.textContent = next
      view.item.classList.remove('is-swapping')
    }, SWAP_FADE_MS)
  }, ITEM_INTERVAL_MS)
}

function applyStage(stage) {
  if (typeof stage.version === 'string') view.version.textContent = `v${stage.version}`
  // The final stage swaps to a short transition so the bar visibly lands on
  // 100% instead of easing toward it for another five seconds.
  if (stage.progress >= 1) {
    view.fill.classList.add('is-complete')
    clearInterval(itemTimer)
    clearTimeout(swapTimer)
  }
  view.fill.style.width = `${Math.min(100, Math.max(0, stage.progress * 100))}%`
  if (Array.isArray(stage.items)) showItems(stage.items)
}

ipcRenderer.on(SPLASH_STAGE_CHANNEL, (_event, stage) => {
  if (!stage || typeof stage !== 'object') return
  if (view) applyStage(stage)
  else queuedStage = stage
})

document.addEventListener('DOMContentLoaded', () => {
  const item = document.getElementById('splash-item')
  const fill = document.getElementById('splash-fill')
  const version = document.getElementById('splash-version')
  if (!item || !fill || !version) return
  view = { item, fill, version }
  if (queuedStage) {
    applyStage(queuedStage)
    queuedStage = null
  }
})

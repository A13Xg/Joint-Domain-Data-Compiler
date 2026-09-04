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
// Reports that the artwork is decoded and a frame carrying it has been
// composited, so the main process can show a window with the splash actually
// on it. 'ready-to-show' and 'did-finish-load' both fire earlier than that: a
// CSS background-image does not block first paint, so showing on either of
// them puts the window up painted in nothing but `backgroundColor` -- a black
// box that sits there until the art arrives, which is what a fast launch
// showed and then closed again.
const SPLASH_PAINTED_CHANNEL = 'splash:painted'
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

  // Loading the plate through an Image() pulls it into the same cache the CSS
  // background paints from, so the window's first frame after show() already
  // carries the art instead of bare `backgroundColor`.
  //
  // Deliberately not requestAnimationFrame: the splash window is still hidden
  // at this point, and Chromium does not run frame callbacks for a window that
  // is not on screen. Waiting for a frame here deadlocked -- the signal never
  // arrived, the window was never shown, and the splash was destroyed by the
  // handoff before the blind fallback could rescue it. `onload` and `decode()`
  // are not frame-gated and fire regardless of visibility.
  //
  // Errors announce too: a splash that cannot find its artwork should still
  // appear rather than be withheld until that fallback.
  const plate = new Image()
  const announceOnce = () => {
    plate.onload = null
    plate.onerror = null
    ipcRenderer.send(SPLASH_PAINTED_CHANNEL)
  }
  plate.onload = () => {
    // decode() resolves once the bitmap is ready to paint, which onload alone
    // does not guarantee. Its rejection is not interesting -- announce either way.
    if (typeof plate.decode === 'function') plate.decode().then(announceOnce, announceOnce)
    else announceOnce()
  }
  plate.onerror = announceOnce
  plate.src = './splash.png'
})

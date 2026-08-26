// Verifies ChartLegend renders one entry per non-timestamp channel with a
// rotating color swatch, marks visible channels (when `visibleChannels` is
// supplied) with a `.visible` class, and wires an optional toggle button to
// `onToggleChannel` — while staying toggle-free when no callback is given.
import { parseHTML } from 'linkedom'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { ReactElement } from 'react'
import type { Dataset } from '../src/core/model.ts'
import { ChartLegend } from '../src/ui/ChartLegend.tsx'

// Mirrors the private LEGEND_PALETTE inside ChartLegend.tsx. Not imported
// directly: exporting a plain constant alongside the component would violate
// this repo's react-refresh/only-export-components lint rule (component
// files must only export components), so the array is kept module-private
// there and duplicated here for the assertion below.
const LEGEND_PALETTE = [
  '#ea4f2f',
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#a855f7',
  '#ec4899',
  '#14b8a6',
  '#6366f1',
]

// react-dom needs a browser-like `document`/`window` before it can mount into
// a container. parseHTML gives us a minimal one for this Node test process
// only; production always renders against a real browser DOM.
const { window } = parseHTML('<!doctype html><html><body></body></html>')
;(globalThis as unknown as { window: unknown }).window = window
;(globalThis as unknown as { document: unknown }).document = window.document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
;(globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number
;(globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) =>
  clearTimeout(id as unknown as ReturnType<typeof setTimeout>)

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

// A dataset with three ext channels plus a stray 'timestamp' entry, which
// some parsers could in principle add to `channels` — the legend must skip
// it since time already drives the chart's x-axis, not a plotted series.
const dataset: Dataset = {
  id: 'flight-1',
  name: 'Flight 1',
  sourceFormat: 'csv',
  warnings: [],
  channels: ['altitude_ft', 'speed_kt', 'heading_deg', 'timestamp'],
  createdAt: Date.now(),
  points: [
    { lat: 0, lon: 0, time: 1000, ext: { altitude_ft: 100, speed_kt: 120, heading_deg: 45 } },
    { lat: 1, lon: 1, time: 2000, ext: { altitude_ft: 200, speed_kt: 130, heading_deg: 50 } },
  ],
}

const emptyDataset: Dataset = {
  id: 'empty',
  name: 'Empty',
  sourceFormat: 'csv',
  warnings: [],
  channels: [],
  createdAt: Date.now(),
  points: [],
}

function render(node: ReactElement) {
  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  const root = createRoot(container as unknown as Element)
  flushSync(() => {
    root.render(node)
  })
  return container
}

// --- Scenario 1: no visibleChannels, no onToggleChannel ---
const container = render(<ChartLegend dataset={dataset} />)

check('renders the chart-legend wrapper', container.querySelector('.chart-legend') !== null)
check('renders a legend-items list', container.querySelector('ul.legend-items') !== null)

const items = Array.from(container.querySelectorAll('li')) as unknown as HTMLLIElement[]
check('renders one item per non-timestamp channel (3, not 4)', items.length === 3)

const labels = items.map((item) => item.querySelector('.legend-label')?.textContent ?? '')
check('altitude_ft channel label is present', labels.some((label) => label.includes('altitude_ft')))
check('speed_kt channel label is present', labels.some((label) => label.includes('speed_kt')))
check('heading_deg channel label is present', labels.some((label) => label.includes('heading_deg')))
check('timestamp channel is not rendered', !labels.some((label) => label.includes('timestamp')))

const swatches = items.map((item) => item.querySelector('.legend-color') as HTMLElement | null)
check('every item has a color swatch', swatches.every((swatch) => swatch !== null))
check(
  'swatch colors rotate through the palette by index',
  swatches.every((swatch, index) => (swatch?.style.backgroundColor ?? '') === LEGEND_PALETTE[index % LEGEND_PALETTE.length]),
)

check('no legend item is marked visible when visibleChannels is not provided', items.every((item) => !item.classList.contains('visible')))
check('no toggle button rendered when onToggleChannel is not provided', container.querySelector('.legend-toggle') === null)

// --- Scenario 2: visibleChannels + onToggleChannel provided ---
const toggled: string[] = []
const container2 = render(
  <ChartLegend
    dataset={dataset}
    visibleChannels={['altitude_ft', 'heading_deg']}
    onToggleChannel={(key) => toggled.push(key)}
  />,
)
const items2 = Array.from(container2.querySelectorAll('li')) as unknown as HTMLLIElement[]

check('altitude_ft item (visible) has .visible class', items2[0]?.classList.contains('visible') === true)
check('speed_kt item (not visible) lacks .visible class', items2[1]?.classList.contains('visible') === false)
check('heading_deg item (visible) has .visible class', items2[2]?.classList.contains('visible') === true)

const toggleButtons = Array.from(container2.querySelectorAll('button.legend-toggle')) as unknown as HTMLButtonElement[]
check('toggle button rendered for every channel when onToggleChannel is provided', toggleButtons.length === 3)

toggleButtons[1]?.dispatchEvent(new window.Event('click', { bubbles: true }))
check('clicking a toggle button calls onToggleChannel with that channel key', toggled.includes('speed_kt') && toggled.length === 1)

toggleButtons[0]?.dispatchEvent(new window.Event('click', { bubbles: true }))
check('clicking a different toggle button calls onToggleChannel with its own key', toggled.includes('altitude_ft'))

// --- Scenario 3: empty dataset ---
const container3 = render(<ChartLegend dataset={emptyDataset} />)
check('empty dataset renders the wrapper without throwing', container3.querySelector('.chart-legend') !== null)
check('empty dataset renders zero legend items', container3.querySelectorAll('li').length === 0)

console.log(`\n${failures === 0 ? 'ALL CHART LEGEND CHECKS PASSED' : `${failures} CHART LEGEND CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

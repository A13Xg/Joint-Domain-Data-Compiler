// Verifies Task 4's integration of ChartTypeSelector, ChartLegend, and the
// chart-type validator (Tasks 1-3) into TimeSeriesChart: the selector and
// legend render and are interactive, a mismatch banner appears when the
// selected type no longer fits the data, switching types works, and the
// component auto-recovers (with a toast) when new data invalidates the
// current selection — all while the existing SVG chart rendering path stays
// intact.
import { parseHTML } from 'linkedom'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { TrackPoint } from '../src/core/model.ts'
import { TimeSeriesChart } from '../src/ui/TimeSeriesChart.tsx'

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

// Timestamped points with two numeric channels (elevation + speed_mps): every
// chart type the validator knows about (timeSeries, area, scatter) is valid
// for this shape, so it exercises the "no mismatch" path and gives all three
// ChartTypeSelector buttons enabled.
const timestampedPoints: TrackPoint[] = [
  { lat: 0, lon: 0, ele: 100, time: 1000, ext: { speed_mps: 5 } },
  { lat: 1, lon: 1, ele: 200, time: 2000, ext: { speed_mps: 6 } },
  { lat: 2, lon: 2, ele: 300, time: 3000, ext: { speed_mps: 7 } },
]

// Same channel shape, but with no `time` field on any point: timeSeries and
// area become invalid (both require timestamps); scatter stays valid
// (2+ numeric channels: elevation + speed_mps). getBestChartType should land
// on 'scatter' since it's the only one left standing.
const untimedPoints: TrackPoint[] = [
  { lat: 0, lon: 0, ele: 100, ext: { speed_mps: 5 } },
  { lat: 1, lon: 1, ele: 200, ext: { speed_mps: 6 } },
]

function renderChart(points: TrackPoint[], channels: string[]): { container: HTMLElement; root: Root } {
  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  const root = createRoot(container as unknown as Element)
  flushSync(() => {
    root.render(<TimeSeriesChart points={points} channels={channels} />)
  })
  return { container: container as unknown as HTMLElement, root }
}

// --- Scenario 1: timestamped data, everything valid on mount ---
const { container } = renderChart(timestampedPoints, ['speed_mps'])

check('renders the time-series-chart-container wrapper', container.querySelector('.time-series-chart-container') !== null)
check('renders the chart-wrapper', container.querySelector('.chart-wrapper') !== null)
check('renders the existing chart rendering (chart-svg present)', container.querySelector('.chart-svg') !== null)
check('renders the existing chart toolbar (preserved unchanged)', container.querySelector('.chart-toolbar') !== null)

check('ChartTypeSelector is rendered', container.querySelector('.chart-type-selector') !== null)
const typeButtons = Array.from(container.querySelectorAll('.chart-type-selector button')) as unknown as HTMLButtonElement[]
check('ChartTypeSelector renders one button per chart type', typeButtons.length === 3)
check('all three chart-type buttons are enabled (data supports every type)', typeButtons.every((btn) => !btn.disabled))
check('timeSeries button (default selection) is marked active', typeButtons[0]?.classList.contains('active') === true)

check('ChartLegend is rendered', container.querySelector('.chart-legend') !== null)
const legendItems = Array.from(container.querySelectorAll('.legend-item')) as unknown as HTMLLIElement[]
check('ChartLegend renders one item for the speed_mps channel', legendItems.length === 1)
check('legend item starts marked visible (matches default visibleChannels)', legendItems[0]?.classList.contains('visible') === true)

check('no mismatch warning shown when the current type fits the data', container.querySelector('.chart-mismatch-warning') === null)

// --- Scenario 2: click the legend's toggle button; it should flip its own visible state ---
// React 18's createRoot schedules the re-render from a dispatched event
// asynchronously (via its own scheduler) rather than flushing it in the same
// tick, so the click itself must be wrapped in flushSync to observe the
// resulting DOM update synchronously in this Node test process.
const legendToggle = container.querySelector('.legend-toggle') as HTMLButtonElement | null
check('legend toggle button is rendered (onToggleChannel wired)', legendToggle !== null)
flushSync(() => { legendToggle?.dispatchEvent(new window.Event('click', { bubbles: true })) })
const legendItemsAfterToggle = Array.from(container.querySelectorAll('.legend-item')) as unknown as HTMLLIElement[]
check('clicking the legend toggle flips the item to not-visible', legendItemsAfterToggle[0]?.classList.contains('visible') === false)

// --- Scenario 3: click the scatter button in ChartTypeSelector; it should become active ---
const scatterButton = Array.from(container.querySelectorAll('.chart-type-selector button'))[1] as unknown as HTMLButtonElement
flushSync(() => { scatterButton.dispatchEvent(new window.Event('click', { bubbles: true })) })
const typeButtonsAfterClick = Array.from(container.querySelectorAll('.chart-type-selector button')) as unknown as HTMLButtonElement[]
check('clicking an enabled chart-type button switches the active selection', typeButtonsAfterClick[1]?.classList.contains('active') === true)
check('the previously active button is no longer active', typeButtonsAfterClick[0]?.classList.contains('active') === false)
check('switching to a still-valid type shows no mismatch warning', container.querySelector('.chart-mismatch-warning') === null)
check('the existing chart rendering is still present after switching types', container.querySelector('.chart-svg') !== null)

// --- Scenario 4: mount directly on untimed data with only 1 channel (elevation) ---
// Both timeSeries and area need timestamps; only scatter is possible, but
// scatter needs 2+ numeric channels and this dataset has only 1 (elevation).
// No chart type is valid, so the lazy initializer's fallback keeps 'timeSeries'
// and the mismatch warning should be visible immediately on mount.
const singleChannelUntimed: TrackPoint[] = [
  { lat: 0, lon: 0, ele: 100 },
  { lat: 1, lon: 1, ele: 200 },
]
const { container: mismatchContainer } = renderChart(singleChannelUntimed, [])
check('mismatch warning appears when no chart type fits the data', mismatchContainer.querySelector('.chart-mismatch-warning') !== null)
check('mismatch warning has role="alert" for accessibility', mismatchContainer.querySelector('[role="alert"].chart-mismatch-warning') !== null)
check(
  'mismatch warning includes the required warning copy',
  mismatchContainer.querySelector('.chart-mismatch-warning')?.textContent?.includes("doesn't match your data") === true,
)
check(
  'mismatch warning has a recovery action button',
  mismatchContainer.querySelector('.chart-mismatch-warning button') !== null,
)

// --- Scenario 5: auto-selection when data changes underneath the component ---
// Start on timestamped data (timeSeries selected, valid), then re-render with
// untimed data for the same instance (simulating a dataset switch). timeSeries
// becomes invalid; the component should auto-switch to 'scatter' (the only
// type still valid: 2 numeric channels, no timestamp requirement) and show a
// toast about the change.
const { container: autoContainer, root: autoRoot } = renderChart(timestampedPoints, ['speed_mps'])
const buttonsBeforeChange = Array.from(autoContainer.querySelectorAll('.chart-type-selector button')) as unknown as HTMLButtonElement[]
check('auto-selection scenario starts on timeSeries', buttonsBeforeChange[0]?.classList.contains('active') === true)

flushSync(() => {
  autoRoot.render(<TimeSeriesChart points={untimedPoints} channels={['speed_mps']} />)
})

const buttonsAfterChange = Array.from(autoContainer.querySelectorAll('.chart-type-selector button')) as unknown as HTMLButtonElement[]
check('timeSeries button is now disabled (data lost its timestamps)', buttonsAfterChange[0]?.disabled === true)
check('scatter button (index 1) is auto-selected as the active type', buttonsAfterChange[1]?.classList.contains('active') === true)
check('no mismatch warning after auto-correction (scatter is valid)', autoContainer.querySelector('.chart-mismatch-warning') === null)
check('a toast notification is shown after the auto-switch', autoContainer.querySelector('.toast') !== null)
check(
  'the toast mentions the switch away from Time Series',
  autoContainer.querySelector('.toast')?.textContent?.includes('Time Series') === true,
)

// --- Scenario 6: point rendering below the render budget --------------------
// A small dataset (well under the 1,500-point render budget) is never
// downsampled, even on first mount with no zoom applied — so individual point
// markers should render immediately, and clicking one should select that
// exact source index.
const smallDataset: TrackPoint[] = Array.from({ length: 20 }, (_, index) => ({
  lat: 0, lon: 0, ele: index, time: index * 1000,
}))
const { container: smallContainer } = renderChart(smallDataset, [])
const pointMarkers = smallContainer.querySelectorAll('.chart-point')
check('Individual point markers render for a dataset under the render budget', pointMarkers.length === smallDataset.length)

// --- Scenario 7: no point markers above the render budget without zoom ------
// A dataset larger than the render budget stays downsampled on the initial
// full-extent view (no zoom applied yet), so no per-point markers should
// render — only the reduced line. This is the "not yet drilled down" half of
// window-aware downsampling; recovering resolution on zoom is covered at the
// extractChartSeries level in chart-series.ts.
const largeDataset: TrackPoint[] = Array.from({ length: 2000 }, (_, index) => ({
  lat: 0, lon: 0, ele: index, time: index * 1000,
}))
const { container: largeContainer } = renderChart(largeDataset, [])
check('No point markers render for the full-extent view of an over-budget dataset', largeContainer.querySelectorAll('.chart-point').length === 0)
check('The line still renders for the over-budget dataset', largeContainer.querySelector('.chart-line') !== null)

console.log(`\n${failures === 0 ? 'ALL TIME SERIES CHART INTEGRATION CHECKS PASSED' : `${failures} TIME SERIES CHART INTEGRATION CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

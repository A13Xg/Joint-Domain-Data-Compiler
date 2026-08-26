// The selection badge has to take you to the samples it names, and a point and
// a range can both be selected at once — Shift with the arrow keys extends a
// range around a selected point. This pins that the point badge frames the
// point and the range badge frames the range, rather than both tripping one
// range-first lookup, and that clicking a badge actually moves the view rather
// than only firing its handler.
import { parseHTML } from 'linkedom'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { ReactElement } from 'react'
import type { TrackPoint } from '../src/core/model.ts'
import { restorePointSelection } from '../src/state/pointSelection.ts'
import { TimeSeriesChart } from '../src/ui/TimeSeriesChart.tsx'

const { window } = parseHTML('<!doctype html><html><body></body></html>')
;(globalThis as unknown as { window: unknown }).window = window
;(globalThis as unknown as { document: unknown }).document = window.document
;(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = window.HTMLElement
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
;(globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number
;(globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) =>
  clearTimeout(id as unknown as ReturnType<typeof setTimeout>)

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function render(node: ReactElement) {
  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  flushSync(() => { createRoot(container as unknown as Element).render(node) })
  return container
}

// `find` yields undefined, not null, so the null coalesce matters: `=== null`
// checks would otherwise pass vacuously against a missing element.
function chipNamed(container: Element, label: string): HTMLElement | null {
  return ([...container.querySelectorAll('.selection-chip-jump')].find((node) => node.textContent === label) as HTMLElement | undefined) ?? null
}

function buttonNamed(container: Element, label: string): HTMLElement | null {
  return ([...container.querySelectorAll('button')].find((node) => node.textContent?.trim() === label) as HTMLElement | undefined) ?? null
}

/** Width of the drawn range highlight: the narrower the zoom, the wider the range reads. */
function rangeHighlightWidth(container: Element): number {
  const rect = container.querySelector('.chart-svg rect[fill="rgba(234,79,47,0.12)"]')
  return rect ? Number(rect.getAttribute('width')) : Number.NaN
}

const points: TrackPoint[] = Array.from({ length: 60 }, (_, index) => ({
  lat: 40 + index * 0.001,
  lon: -75 + index * 0.001,
  ele: 300 + index * 5,
  time: 1_700_000_000_000 + index * 1000,
  ext: { speed_mps: 100 },
}))

const POINT = 20
const RANGE = { start: 20, end: 24 }

console.log('clicking a badge moves the view')
{
  restorePointSelection(points, POINT, null)
  const container = render(<TimeSeriesChart points={points} channels={['speed_mps']} />)
  check('the chart starts unzoomed', buttonNamed(container, 'Reset zoom ×') === null)

  const badge = chipNamed(container, `point #${POINT}`)
  check('the point badge is rendered', badge !== null)
  flushSync(() => { badge?.click() })
  // Reset zoom only renders while the chart is actually zoomed, so its
  // appearance is proof the click reached the view and not just the handler.
  check('the chart is zoomed after clicking the badge', buttonNamed(container, 'Reset zoom ×') !== null)
}

console.log('the point badge ignores a range selected alongside it')
{
  restorePointSelection(points, POINT, RANGE)
  const container = render(<TimeSeriesChart points={points} channels={['speed_mps']} />)
  check('both badges are live', chipNamed(container, `point #${POINT}`) !== null && chipNamed(container, `range ${RANGE.start}–${RANGE.end}`) !== null)

  flushSync(() => { chipNamed(container, `point #${POINT}`)?.click() })
  const afterPoint = rangeHighlightWidth(container)
  check('the point badge zoomed the chart', buttonNamed(container, 'Reset zoom ×') !== null)

  flushSync(() => { buttonNamed(container, 'Reset zoom ×')?.click() })
  flushSync(() => { chipNamed(container, `range ${RANGE.start}–${RANGE.end}`)?.click() })
  const afterRange = rangeHighlightWidth(container)

  // Framing one sample is a far tighter domain than framing five, so the same
  // highlighted range has to draw much wider under the point badge's zoom.
  // Equal widths would mean both badges framed the same thing — the range-first
  // bug this guards.
  check('the two badges frame different spans', Number.isFinite(afterPoint) && Number.isFinite(afterRange) && afterPoint > afterRange * 1.5, `point ${afterPoint.toFixed(1)} vs range ${afterRange.toFixed(1)}`)
}

console.log('the range badge still frames the range on its own')
{
  restorePointSelection(points, null, RANGE)
  const container = render(<TimeSeriesChart points={points} channels={['speed_mps']} />)
  check('no point badge is shown', chipNamed(container, `point #${POINT}`) === null)
  flushSync(() => { chipNamed(container, `range ${RANGE.start}–${RANGE.end}`)?.click() })
  check('the range badge zoomed the chart', buttonNamed(container, 'Reset zoom ×') !== null)
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll selection-jump checks passed.')

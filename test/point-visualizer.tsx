// Verifies the point visualizer: that it draws a sample in its neighbourhood
// rather than repeating the table, reports the legs either side with real
// geodesic numbers, surfaces provenance and quality events for the selected
// sample, and drives the shared selection store so the rest of the workspace
// follows.
import { parseHTML } from 'linkedom'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { ReactElement } from 'react'
import type { Dataset } from '../src/core/model.ts'
import { getSelectedPointIndex } from '../src/state/pointSelection.ts'
import { PointVisualizerPanel } from '../src/ui/PointVisualizerPanel.tsx'

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
  const root = createRoot(container as unknown as Element)
  flushSync(() => { root.render(node) })
  return container
}

function buttonNamed(container: Element, label: string): HTMLButtonElement | null {
  return [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === label) as HTMLButtonElement | null
}

// A 1 Hz northbound track with a deliberate 60 s dropout after sample 20, so
// the quality strip and the per-sample event list both have something true to
// report.
const dataset: Dataset = {
  id: 'flight-1',
  name: 'Flight 1',
  sourceFormat: 'csv',
  warnings: [],
  channels: ['heading_deg'],
  createdAt: 0,
  points: Array.from({ length: 40 }, (_, index) => ({
    lat: 40 + index * 0.001,
    lon: -75,
    ele: 300 + index * 2,
    time: 1_700_000_000_000 + index * 1000 + (index > 20 ? 60_000 : 0),
    ext: { heading_deg: 0 },
    provenance: { sourceRecord: index + 1, sourceSegment: 'leg-a', qualityFlags: index === 5 ? ['suspect'] : [] },
  })),
}

console.log('renders a sample in its neighbourhood')
{
  const container = render(<PointVisualizerPanel dataset={dataset} />)
  check('the quality strip is drawn', container.querySelector('.point-strip svg') !== null)
  check('a local plan view is drawn', container.querySelector('.point-plan svg') !== null)
  check('the plan view is not empty', (container.querySelector('.point-plan polyline')?.getAttribute('points')?.length ?? 0) > 10)
  check('a local elevation profile is drawn', container.querySelector('.point-profile svg') !== null)
  check('individual samples are clickable nodes', container.querySelectorAll('.point-node').length > 1)
  check('it says which sample is shown when nothing is selected', container.textContent?.includes('Showing the first sample') === true)
}

console.log('reports the sample and its legs')
{
  const container = render(<PointVisualizerPanel dataset={dataset} />)
  const fields = container.querySelector('.point-fields')?.textContent ?? ''
  check('latitude is shown in decimal and DMS', fields.includes('40.000000') && fields.includes('N'), fields.slice(0, 80))
  check('elevation is shown', fields.includes('300 m'), fields.slice(0, 200))
  check('the timestamp is shown', fields.includes('2023-11-14') || fields.includes('T'), fields.slice(0, 200))
  check('provenance is shown', fields.includes('leg-a'))

  const deltas = container.querySelector('.point-deltas')?.textContent ?? ''
  check('the first sample has no previous leg', deltas.includes('no neighbouring sample'))
  // 0.001° of latitude is ~111 m; at 1 Hz that is an implied ~111 m/s.
  check('the forward leg reports a real distance', /11[01](\.\d+)? m/.test(deltas), deltas)
  check('the forward leg reports an implied speed', /11[01](\.\d+)? m\/s/.test(deltas), deltas)
  check('the channels are listed', container.querySelector('.point-channels')?.textContent?.includes('heading_deg') === true)
}

console.log('stepping drives the shared selection')
{
  const container = render(<PointVisualizerPanel dataset={dataset} />)
  flushSync(() => { buttonNamed(container, 'Next →')?.click() })
  check('Next selects the following sample', getSelectedPointIndex(dataset.points) === 1, String(getSelectedPointIndex(dataset.points)))
  check('the heading follows the selection', container.querySelector('.point-detail h4')?.textContent?.includes('Sample 1') === true)

  flushSync(() => { buttonNamed(container, '← Prev')?.click() })
  check('Prev steps back', getSelectedPointIndex(dataset.points) === 0)
  check('Prev is disabled at the start', buttonNamed(container, '← Prev')?.hasAttribute('disabled') === true)
}

console.log('surfaces quality events on the sample they cover')
{
  const container = render(<PointVisualizerPanel dataset={dataset} />)
  const next = buttonNamed(container, 'Next →')!
  for (let step = 0; step < 21; step++) flushSync(() => { next.click() })
  check('the selection reached the dropout', getSelectedPointIndex(dataset.points) === 21, String(getSelectedPointIndex(dataset.points)))
  const events = container.querySelector('.point-events')?.textContent ?? ''
  check('the timestamp gap is reported on the sample', events.includes('gap'), events)
  const deltas = container.querySelector('.point-deltas')?.textContent ?? ''
  check('the leg across the gap reports its duration', deltas.includes('61.000 s'), deltas)
}

console.log('degenerate dataset')
{
  const container = render(<PointVisualizerPanel dataset={{ ...dataset, id: 'empty', points: [] }} />)
  check('an empty track explains itself instead of rendering an empty plot', container.textContent?.includes('no points to visualize') === true)
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll point-visualizer checks passed.')

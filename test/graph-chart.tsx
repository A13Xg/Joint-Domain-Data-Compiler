// Verifies GraphChart (the Graph app's read-only SVG chart) renders a
// polyline per line series, a circle per scatter point, a legend entry per
// series, and the "no data" fallback when every series is empty — without
// throwing on degenerate domains (all-equal x or y values).
import { parseHTML } from 'linkedom'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { ReactElement } from 'react'
import { GraphChart, type GraphSeries } from '../src/graph/GraphChart.tsx'

const { window } = parseHTML('<!doctype html><html><body></body></html>')
;(globalThis as unknown as { window: unknown }).window = window
;(globalThis as unknown as { document: unknown }).document = window.document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

function render(element: ReactElement): HTMLElement {
  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  const root = createRoot(container as unknown as Element)
  flushSync(() => root.render(element))
  return container as unknown as HTMLElement
}

const lineSeries: GraphSeries = {
  label: 'Alpha',
  color: '#ea4f2f',
  kind: 'line',
  points: [{ x: 0, y: 10 }, { x: 10, y: 20 }, { x: 20, y: 15 }],
}
const scatterSeries: GraphSeries = {
  label: 'Bravo',
  color: '#3b82f6',
  kind: 'scatter',
  points: [{ x: 0, y: 5 }, { x: 5, y: 8 }],
}

const withData = render(<GraphChart title="Test chart" xLabel="x" yLabel="y" series={[lineSeries, scatterSeries]} />)
check('renders one polyline for the line series', withData.querySelectorAll('polyline').length === 1)
check('renders one circle per scatter point', withData.querySelectorAll('circle').length === scatterSeries.points.length)
check('renders one legend entry per series', withData.querySelectorAll('.graph-chart-legend-item').length === 2)
check('legend includes both series labels', withData.textContent?.includes('Alpha') === true && withData.textContent?.includes('Bravo') === true)

const empty = render(<GraphChart title="Empty chart" xLabel="x" yLabel="y" series={[{ label: 'Nothing', color: '#000', kind: 'line', points: [] }]} />)
check('shows the no-data fallback when every series is empty', empty.textContent?.includes('No data for this channel.') === true)
check('renders no svg when there is no data', empty.querySelectorAll('svg').length === 0)

// Degenerate domains (every x equal, every y equal) must not throw or divide by zero.
const degenerate: GraphSeries = { label: 'Flat', color: '#000', kind: 'line', points: [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }] }
let degenerateThrew = false
try {
  render(<GraphChart title="Degenerate" xLabel="x" yLabel="y" series={[degenerate]} />)
} catch {
  degenerateThrew = true
}
check('a chart with every point at the same (x, y) does not throw', !degenerateThrew)

console.log(`\n${failures === 0 ? 'ALL GRAPH CHART CHECKS PASSED' : `${failures} GRAPH CHART CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

// TrackMetricsPanel surfaces what the app already computes plus the parser
// metadata that previously had no consumer at all. The assertions below are
// about that surfacing, and about the point accounting being honest.

import { parseHTML } from 'linkedom'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { ReactElement } from 'react'
import type { Dataset, TrackPoint } from '../src/core/model.ts'
import { computeStats } from '../src/core/stats.ts'
import { TrackMetricsPanel } from '../src/ui/TrackMetricsPanel.tsx'

const { window } = parseHTML('<!doctype html><html><body></body></html>')
;(globalThis as unknown as { window: unknown }).window = window
;(globalThis as unknown as { document: unknown }).document = window.document
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

const START = 1_700_000_000_000
const points: TrackPoint[] = [
  { lat: 40, lon: -75, ele: 100, time: START },
  { lat: 40.001, lon: -75, ele: 250, time: START + 10_000 },
  // Interpolated, and the elevation high-water mark.
  { lat: 40.002, lon: -75, ele: 900, time: START + 20_000, provenance: { qualityFlags: ['interpolated'] } },
  { lat: 40.003, lon: -75, ele: 400, time: START + 30_000, provenance: { qualityFlags: ['interpolated', 'hampel_corrected'] } },
  // Invalid latitude: counted as an invalid coordinate, not silently ignored.
  { lat: 999, lon: -75, ele: 50, time: START + 40_000 },
  // Untimed and elevation-less, so the "of N" denominators differ.
  { lat: 40.004, lon: -75 },
]

const dataset: Dataset = {
  id: 'metrics-1',
  name: 'Metrics fixture',
  sourceFormat: 'eag',
  warnings: ['3 records dropped during parse'],
  channels: [],
  createdAt: START,
  points,
  metadata: {
    coordinateSystem: 'EPSG:4326',
    altitudeReference: 'MSL',
    timeReference: 'UTC',
    channels: [],
    source: { filename: 'sortie.eag', byteLength: 4096, importedAt: START, parserId: 'eag', parserVersion: '2' },
    meta: { platformName: 'VIPER 11', exerciseId: 'RF-24-3', missionId: 'M-0042' },
  },
}

const container = render(<TrackMetricsPanel dataset={dataset} />)
const text = container.textContent ?? ''

check('renders the track metrics block', container.querySelector('.track-metrics') !== null)

// --- metadata that had no consumer before this panel ---
check('surfaces the EAG platform name from metadata.meta', text.includes('VIPER 11'))
check('surfaces the exercise id', text.includes('RF-24-3'))
check('surfaces the mission id', text.includes('M-0042'))
check('surfaces the source filename', text.includes('sortie.eag'))
check('surfaces the parser and version', text.includes('eag v2'))
check('surfaces the altitude reference', text.includes('MSL'))
check('surfaces the coordinate system', text.includes('EPSG:4326'))

// --- extremes, read from computeStats rather than recomputed ---
const stats = computeStats(dataset)
check('stats expose a minimum speed', stats.speed !== null && Number.isFinite(stats.speed.minMps))
check('min speed is not above max speed', stats.speed !== null && stats.speed.minMps <= stats.speed.maxMps)
check('renders the maximum altitude', text.includes('900 m'), text.slice(0, 160))
check('renders the minimum altitude', text.includes('50 m'))

// --- point accounting ---
check('counts every point', text.includes('6'))
check('reports the invalid coordinate', stats.invalidCoordCount === 1, `${stats.invalidCoordCount}`)
check('reports valid coordinates separately', stats.validCoordCount === 5, `${stats.validCoordCount}`)
// Two points carry 'interpolated'; only one also carries 'hampel_corrected'.
check('counts interpolated points', text.toLowerCase().includes('interpolated'))
check('counts Hampel-corrected points', text.toLowerCase().includes('hampel-corrected'))
check('says the live counts reflect applied operations', text.includes('after any applied'))
check('does not invent a dropped-at-import section when nothing was dropped', !text.includes('Dropped at import'))

// --- structured parse-time drops ---

// These cannot be recovered from the points, so the panel is the only place a
// user can see that the source offered more records than the track contains.
const withDrops: Dataset = { ...dataset, droppedCounts: { invalidCoordinate: 4 } }
const dropContainer = render(<TrackMetricsPanel dataset={withDrops} />)
const dropText = dropContainer.textContent ?? ''
check('renders a dropped-at-import section', dropText.includes('Dropped at import'))
check('humanizes the drop reason', dropText.includes('invalid coordinate'))
check('reports the drop count', dropText.includes('4'))
// 6 points kept + 4 refused = 10 records in the file.
check('reports what the source originally offered', dropText.includes('10'), dropText.slice(dropText.indexOf('Dropped at import'), dropText.indexOf('Dropped at import') + 120))

const zeroDrops = render(<TrackMetricsPanel dataset={{ ...dataset, droppedCounts: { invalidCoordinate: 0 } }} />)
check('a zero drop count renders no section', !(zeroDrops.textContent ?? '').includes('Dropped at import'))

// --- a bare dataset must not crash or invent metadata ---
const bare: Dataset = {
  id: 'bare', name: 'Bare', sourceFormat: 'csv', warnings: [], channels: [], createdAt: START,
  points: [{ lat: 1, lon: 2 }],
}
const bareContainer = render(<TrackMetricsPanel dataset={bare} />)
const bareText = bareContainer.textContent ?? ''
check('renders for a dataset with no metadata', bareContainer.querySelector('.track-metrics') !== null)
check('falls back to the source format when there is no source metadata', bareText.includes('csv'))
check('shows em dashes rather than fabricated extremes', bareText.includes('—'))

console.log(`\n${failures === 0 ? 'ALL TRACK METRICS CHECKS PASSED' : `${failures} TRACK METRICS CHECK(S) FAILED`}`)
if (failures > 0) process.exit(1)

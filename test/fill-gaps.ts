// Gap filling must bridge a real dropout, refuse an implausible one, and
// never overshoot the samples bracketing the gap.

import type { Dataset, TrackPoint } from '../src/core/model.ts'
import { haversineMeters } from '../src/core/model.ts'
import { ensureBuiltinOperationsRegistered } from '../src/core/operations/basic.ts'
import { executeOperation } from '../src/core/recipes/executor.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function throws(name: string, run: () => unknown, match?: RegExp): void {
  try {
    run()
    check(name, false, 'did not throw')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    check(name, match ? match.test(message) : true, match ? message : '')
  }
}

ensureBuiltinOperationsRegistered()

function dataset(points: TrackPoint[]): Dataset {
  return { id: 'gaps', name: 'gaps', sourceFormat: 'csv', points, warnings: [], channels: [], createdAt: 0 }
}

const START = 1_700_000_000_000
/** A steady 1 Hz climb heading roughly north-east at a walkable speed. */
function sample(index: number, seconds = index): TrackPoint {
  return {
    lat: 40 + index * 0.00002,
    lon: -75 + index * 0.00002,
    ele: 300 + index * 0.5,
    time: START + seconds * 1000,
    ext: { heading_deg: 45, ground_speed_mps: 2.8 },
  }
}

// ------------------------------------------------------------------ basic fill

// Ten seconds of 1 Hz data, then a 10 s dropout, then ten more seconds.
const withGap: TrackPoint[] = []
for (let index = 0; index < 10; index++) withGap.push(sample(index))
for (let index = 10; index < 20; index++) withGap.push(sample(index, index + 9))

const params = { gapThresholdMs: 2000, sampleIntervalMs: 1000, contextPoints: 4, profile: 'unconstrained' }
const filled = executeOperation(dataset(withGap), 'fill-gaps', params)
check('Fill inserts points across the gap', filled.dataset.points.length > withGap.length, `${withGap.length} → ${filled.dataset.points.length}`)
check('Fill reports what it did', /Filled 1 of 1 gap/.test(filled.record.summary), filled.record.summary)

const inserted = filled.dataset.points.filter((point) => point.provenance?.qualityFlags?.includes('interpolated'))
check('Every inserted point is flagged interpolated', inserted.length === filled.dataset.points.length - withGap.length, `${inserted.length} flagged`)
check('Real points are not flagged interpolated', filled.dataset.points.filter((point) => !point.provenance?.qualityFlags?.includes('interpolated')).length === withGap.length)
check('Timestamps stay strictly increasing', filled.dataset.points.every((point, index, all) => index === 0 || point.time! > all[index - 1]!.time!))
check('Fill does not mutate the input', withGap.length === 20)

// The Fritsch–Carlson limiter is the reason this operation can be trusted: an
// interpolated value must never leave the range spanned by the samples
// bracketing the gap.
const before = withGap[9]!
const after = withGap[10]!
const lowLat = Math.min(before.lat, after.lat)
const highLat = Math.max(before.lat, after.lat)
const lowEle = Math.min(before.ele!, after.ele!)
const highEle = Math.max(before.ele!, after.ele!)
check('No inserted latitude overshoots the bracketing samples', inserted.every((point) => point.lat >= lowLat && point.lat <= highLat))
check('No inserted elevation overshoots the bracketing samples', inserted.every((point) => point.ele! >= lowEle && point.ele! <= highEle))
check('Inserted points carry interpolated channels', inserted.every((point) => typeof point.ext?.heading_deg === 'number'))

// ------------------------------------------------------------- profile refusal

// A 30 s dropout that ends 200 km away. Bridging it means ~6.6 km/s, which no
// profile but 'unconstrained' allows.
const teleport: TrackPoint[] = []
for (let index = 0; index < 6; index++) teleport.push(sample(index))
for (let index = 0; index < 6; index++) {
  teleport.push({ lat: 42, lon: -73, ele: 320, time: START + (35 + index) * 1000, ext: { heading_deg: 45 } })
}
const refused = executeOperation(dataset(teleport), 'fill-gaps', { ...params, profile: 'marine' })
check('An implausible gap is not filled', refused.dataset.points.length === teleport.length)
check('The refusal is reported as a warning', refused.record.warnings.length === 1, refused.record.warnings[0] ?? '')
check('The warning names the limit that was broken', /ground speed/.test(refused.record.warnings[0] ?? ''), refused.record.warnings[0] ?? '')
check('The summary says nothing was filled', /Filled no gaps/.test(refused.record.summary), refused.record.summary)

const allowed = executeOperation(dataset(teleport), 'fill-gaps', { ...params, profile: 'unconstrained' })
check('The same gap fills under the unconstrained profile', allowed.dataset.points.length > teleport.length)

// A vertical-only jump: same place, 5000 m higher after 10 s. Marine allows
// 2 m/s vertical, so this must be refused on the vertical limit specifically.
const elevator: TrackPoint[] = []
for (let index = 0; index < 6; index++) elevator.push({ lat: 40, lon: -75, ele: 10, time: START + index * 1000 })
for (let index = 0; index < 6; index++) elevator.push({ lat: 40, lon: -75, ele: 5000, time: START + (15 + index) * 1000 })
const vertical = executeOperation(dataset(elevator), 'fill-gaps', { ...params, profile: 'marine' })
check('A vertical-only jump is refused on the vertical limit', /vertical speed/.test(vertical.record.warnings[0] ?? ''), vertical.record.warnings[0] ?? '')

// ------------------------------------------------------------------- no gaps

const contiguous = Array.from({ length: 20 }, (_, index) => sample(index))
const untouched = executeOperation(dataset(contiguous), 'fill-gaps', params)
check('A contiguous track is left alone', untouched.dataset.points.length === contiguous.length)
check('A contiguous track reports nothing to fill', /nothing to fill/.test(untouched.record.summary), untouched.record.summary)

// -------------------------------------------------------------- antimeridian

// A dropout straddling the 180° seam must interpolate the short way across it,
// not the long way back around the globe.
const seam: TrackPoint[] = []
for (let index = 0; index < 5; index++) seam.push({ lat: 0, lon: 179.9 + index * 0.01, ele: 100, time: START + index * 1000 })
for (let index = 0; index < 5; index++) seam.push({ lat: 0, lon: -179.85 + index * 0.01, ele: 100, time: START + (12 + index) * 1000 })
const crossed = executeOperation(dataset(seam), 'fill-gaps', { ...params, profile: 'unconstrained' })
const seamInserted = crossed.dataset.points.filter((point) => point.provenance?.qualityFlags?.includes('interpolated'))
check('The seam gap is filled', seamInserted.length > 0)
check('Inserted longitudes stay in -180..180', seamInserted.every((point) => point.lon >= -180 && point.lon <= 180))
// Going the long way round would put the fill thousands of km from the seam.
check(
  'The fill crosses the seam the short way',
  seamInserted.every((point) => haversineMeters(0, 180, point.lat, point.lon) < 50_000),
  seamInserted.map((point) => point.lon.toFixed(3)).join(' '),
)

// ------------------------------------------------------------------ validation

throws('Fill gaps rejects an untimed point', () => executeOperation(
  dataset([{ lat: 0, lon: 0, time: START }, { lat: 0, lon: 1 }, { lat: 0, lon: 2, time: START + 9000 }]),
  'fill-gaps', params,
), /timestamp/)

throws('Fill gaps rejects non-increasing timestamps', () => executeOperation(
  dataset([{ lat: 0, lon: 0, time: START }, { lat: 0, lon: 1, time: START }, { lat: 0, lon: 2, time: START + 9000 }]),
  'fill-gaps', params,
), /strictly increasing/)

throws('Fill gaps rejects an unknown profile', () => executeOperation(dataset(withGap), 'fill-gaps', { ...params, profile: 'submarine' }))
throws('Fill gaps rejects fewer than two context points', () => executeOperation(dataset(withGap), 'fill-gaps', { ...params, contextPoints: 1 }))
// A sample interval longer than the threshold would detect a gap and then
// produce nothing for it, which is a silently useless run.
throws('Fill gaps rejects a sample interval longer than the threshold', () => executeOperation(
  dataset(withGap), 'fill-gaps', { ...params, sampleIntervalMs: 5000, gapThresholdMs: 2000 },
), /must not exceed/)
throws('Fill gaps rejects range scope', () => executeOperation(dataset(withGap), 'fill-gaps', params, { indexRange: { start: 0, end: 5 } }))
throws('Fill gaps refuses to insert more than a million points', () => executeOperation(
  dataset([{ lat: 0, lon: 0, time: START }, { lat: 0, lon: 0.1, time: START + 5_000_000_000 }]),
  'fill-gaps', { ...params, sampleIntervalMs: 1000, gapThresholdMs: 2000 },
), /over the/)

console.log(`\n${failures === 0 ? 'ALL FILL GAPS CHECKS PASSED' : `${failures} FILL GAPS CHECK(S) FAILED`}`)
if (failures > 0) process.exit(1)

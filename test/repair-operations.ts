// Covers the consolidated repair operations: strict parameter validation,
// scope handling, and the property that every one of them survives a recipe
// replay — which is the whole reason they were registered.

import type { Dataset, TrackPoint } from '../src/core/model.ts'
import { ensureBuiltinOperationsRegistered } from '../src/core/operations/basic.ts'
import { buildRecipe, executeOperation, replayRecipe } from '../src/core/recipes/executor.ts'
import { getOperation } from '../src/core/recipes/registry.ts'
import { decimate } from '../src/core/transforms.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function throws(name: string, run: () => unknown): void {
  let threw = false
  try { run() } catch { threw = true }
  check(name, threw)
}

ensureBuiltinOperationsRegistered()
ensureBuiltinOperationsRegistered() // idempotent: registerOperation throws on a duplicate id

function dataset(points: TrackPoint[], name = 'fixture'): Dataset {
  return { id: 'fixture', name, sourceFormat: 'csv', points, warnings: [], channels: [], createdAt: 0 }
}

// A gently curving, steadily climbing track at 1 Hz, with one hard position
// spike and one hard elevation spike deliberately planted mid-run.
const SPIKE_INDEX = 20
const ELEVATION_SPIKE_INDEX = 35
const base: TrackPoint[] = Array.from({ length: 60 }, (_, index) => ({
  lat: 40 + index * 0.001,
  lon: -75 + index * 0.0012,
  ele: 300 + index * 2,
  time: 1_700_000_000_000 + index * 1000,
  ext: { heading_deg: 45 + index * 0.1 },
}))
base[SPIKE_INDEX] = { ...base[SPIKE_INDEX]!, lat: 40.5, lon: -74.5 }
base[ELEVATION_SPIKE_INDEX] = { ...base[ELEVATION_SPIKE_INDEX]!, ele: 9000 }
const source = dataset(base)

// ---------------------------------------------------------------- registration

const EXPECTED_IDS = [
  'sort-by-time', 'swap-lat-lon', 'drop-invalid', 'dejitter-timestamps', 'clip-time-range',
  'drop-outliers', 'elevation-filter', 'smooth',
  'reduce-points', 'round-precision',
  'resample-fixed-rate', 'resample-distance-monotone-cubic', 'fill-gaps',
  'standard-kinematics', 'shift-time', 'offset-elevation',
]
for (const id of EXPECTED_IDS) check(`Operation ${id} is registered`, getOperation(id) !== null)

// ---------------------------------------------------------------- drop-outliers

const outlierParams = {
  channels: ['position', 'elevation'],
  windowSize: 5,
  scoreThreshold: 3,
  minPositionScaleMeters: 1,
  minElevationScaleMeters: 1,
  minSpeedScaleMps: 0.5,
}
const dropped = executeOperation(source, 'drop-outliers', outlierParams)
check('Drop outliers removes the planted spikes', dropped.dataset.points.length < base.length, `${base.length} → ${dropped.dataset.points.length}`)
check('Drop outliers removes the position spike', !dropped.dataset.points.some((point) => point.lat === 40.5))
check('Drop outliers does not mutate the input', source.points.length === base.length && source.points[SPIKE_INDEX]!.lat === 40.5)

// Scoping narrows what is removed but not how points are scored, so a range
// that excludes the elevation spike must leave it in place.
const scopedDrop = executeOperation(source, 'drop-outliers', outlierParams, { indexRange: { start: 0, end: 25 } })
check('Scoped drop keeps flagged points outside the range', scopedDrop.dataset.points.some((point) => point.ele === 9000))
check('Scoped drop still removes flagged points inside the range', !scopedDrop.dataset.points.some((point) => point.lat === 40.5))
check('Scoped drop names the range in its summary', scopedDrop.record.summary.includes('0–25'))

// The planted position spike scores highest on *speed* (a 55 km jump between
// 1 Hz samples). Selecting position alone must still drop it: the mask is
// applied when scoring, not by filtering the reported dominant channel.
const positionOnly = executeOperation(source, 'drop-outliers', { ...outlierParams, channels: ['position'] })
check('Position-only selection drops a spike whose dominant channel is speed', !positionOnly.dataset.points.some((point) => point.lat === 40.5))
check('Position-only selection keeps the elevation spike', positionOnly.dataset.points.some((point) => point.ele === 9000))
const elevationOnly = executeOperation(source, 'drop-outliers', { ...outlierParams, channels: ['elevation'] })
check('Elevation-only selection keeps the position spike', elevationOnly.dataset.points.some((point) => point.lat === 40.5))
check('Elevation-only selection drops the elevation spike', !elevationOnly.dataset.points.some((point) => point.ele === 9000))

throws('Drop outliers rejects an empty channel list', () => executeOperation(source, 'drop-outliers', { ...outlierParams, channels: [] }))
throws('Drop outliers rejects an unknown channel', () => executeOperation(source, 'drop-outliers', { ...outlierParams, channels: ['altitude'] }))
throws('Drop outliers rejects repeated channels', () => executeOperation(source, 'drop-outliers', { ...outlierParams, channels: ['position', 'position'] }))
throws('Drop outliers rejects time-range scope', () => executeOperation(source, 'drop-outliers', outlierParams, { timeRange: { startMs: 0, endMs: 1 } }))

// ---------------------------------------------------------------- reduce-points

const decimated = executeOperation(source, 'reduce-points', { mode: 'decimate', factor: 7 })
check('Decimate keeps the first point', decimated.dataset.points[0]!.time === base[0]!.time)
check('Decimate keeps the last point', decimated.dataset.points.at(-1)!.time === base.at(-1)!.time)
check('Decimate keeps the last point even when the index is not a multiple', decimate(base, 7).points.at(-1)!.time === base.at(-1)!.time)

const simplified = executeOperation(source, 'reduce-points', { mode: 'simplify', epsilonMeters: 25 })
check('Simplify reduces the point count', simplified.dataset.points.length < base.length)
check('Simplify keeps the endpoints', simplified.dataset.points[0]!.time === base[0]!.time && simplified.dataset.points.at(-1)!.time === base.at(-1)!.time)

throws('Reduce points rejects an unknown mode', () => executeOperation(source, 'reduce-points', { mode: 'thin', factor: 2 }))
throws('Reduce points rejects a factor below 2', () => executeOperation(source, 'reduce-points', { mode: 'decimate', factor: 1 }))
throws('Reduce points rejects a non-integer factor', () => executeOperation(source, 'reduce-points', { mode: 'decimate', factor: 2.5 }))
// A stray parameter from the wrong mode means two different records could
// describe the same result, which is exactly what output hashing exists to catch.
throws('Reduce points rejects parameters from another mode', () => executeOperation(source, 'reduce-points', { mode: 'decimate', factor: 2, epsilonMeters: 5 }))
throws('Reduce points rejects an array as params', () => executeOperation(source, 'reduce-points', ['decimate']))
throws('Reduce points rejects range scope', () => executeOperation(source, 'reduce-points', { mode: 'decimate', factor: 2 }, { indexRange: { start: 0, end: 3 } }))

// ---------------------------------------------------------------- round-precision

const rounded = executeOperation(source, 'round-precision', { coordinateDecimals: 3, elevationDecimals: 0 })
check('Round precision truncates coordinate decimals', rounded.dataset.points.every((point) => Math.abs(point.lat * 1000 - Math.round(point.lat * 1000)) < 1e-9))
check('Round precision leaves the point count alone', rounded.dataset.points.length === base.length)
check('Round precision leaves untargeted channels alone', rounded.dataset.points[1]!.ext!.heading_deg === base[1]!.ext!.heading_deg)

const roundedChannels = executeOperation(source, 'round-precision', { coordinateDecimals: 6, channelDecimals: 0 })
check('Round precision rounds numeric channels when asked', Number.isInteger(roundedChannels.dataset.points[1]!.ext!.heading_deg as number))

const scopedRound = executeOperation(source, 'round-precision', { coordinateDecimals: 1 }, { indexRange: { start: 0, end: 4 } })
check('Scoped rounding leaves points outside the range untouched', scopedRound.dataset.points[10]!.lat === base[10]!.lat)
check('Scoped rounding changes points inside the range', scopedRound.dataset.points[3]!.lat !== base[3]!.lat)

throws('Round precision rejects negative decimals', () => executeOperation(source, 'round-precision', { coordinateDecimals: -1 }))
throws('Round precision rejects a missing coordinate precision', () => executeOperation(source, 'round-precision', {}))

// A NaN elevation must not become a real number: trimNumber maps non-finite
// values to '0', and inventing 0 m would fabricate data.
const withNaN = dataset([{ lat: 1.23456789, lon: 2.3456789, ele: Number.NaN }])
const naNRounded = executeOperation(withNaN, 'round-precision', { coordinateDecimals: 2, elevationDecimals: 2 })
check('Round precision leaves a non-finite elevation non-finite', Number.isNaN(naNRounded.dataset.points[0]!.ele as number))

// ---------------------------------------------------------------- elevation-filter

const hampel = executeOperation(source, 'elevation-filter', { mode: 'hampel', window: 11, sigmaThreshold: 3 })
check('Hampel rewrites the elevation spike', hampel.dataset.points[ELEVATION_SPIKE_INDEX]!.ele !== 9000)
check('Hampel preserves the point count', hampel.dataset.points.length === base.length)

const scopedMedian = executeOperation(source, 'elevation-filter', { mode: 'median', window: 5 }, { indexRange: { start: 30, end: 40 } })
check('Scoped elevation filter preserves the point count', scopedMedian.dataset.points.length === base.length)
check('Scoped elevation filter leaves points outside the range untouched', scopedMedian.dataset.points[5]!.ele === base[5]!.ele)
check('Scoped elevation filter reports the range', scopedMedian.record.summary.includes('30–40'))

throws('Elevation filter rejects an unknown mode', () => executeOperation(source, 'elevation-filter', { mode: 'butterworth', window: 5 }))
throws('Elevation filter rejects an alpha of 1', () => executeOperation(source, 'elevation-filter', { mode: 'ema', alpha: 1 }))
throws('Elevation filter rejects an alpha of 0', () => executeOperation(source, 'elevation-filter', { mode: 'ema', alpha: 0 }))
throws('Elevation filter rejects median params on the ema mode', () => executeOperation(source, 'elevation-filter', { mode: 'ema', alpha: 0.5, window: 5 }))

// ---------------------------------------------------------------- smooth

throws('Smooth rejects targeting neither channel', () => executeOperation(source, 'smooth', { window: 5, coords: false, elevation: false }))
throws('Smooth rejects a non-boolean target', () => executeOperation(source, 'smooth', { window: 5, coords: 'yes', elevation: true }))
const smoothed = executeOperation(source, 'smooth', { window: 5, coords: true, elevation: true }, { indexRange: { start: 10, end: 30 } })
check('Scoped smooth preserves the point count', smoothed.dataset.points.length === base.length)

// ---------------------------------------------------------------- structure

throws('Sort by time rejects range scope', () => executeOperation(source, 'sort-by-time', {}, { indexRange: { start: 0, end: 1 } }))
throws('Sort by time rejects stray parameters', () => executeOperation(source, 'sort-by-time', { reverse: true }))

const clipped = executeOperation(source, 'clip-time-range', {
  startMs: base[10]!.time!, endMs: base[20]!.time!, untimedPolicy: 'drop',
})
check('Clip keeps only the requested window', clipped.dataset.points.length === 11, `${clipped.dataset.points.length} points`)
throws('Clip rejects an inverted window', () => executeOperation(source, 'clip-time-range', { startMs: 10, endMs: 5, untimedPolicy: 'keep' }))
throws('Clip rejects an unknown untimed policy', () => executeOperation(source, 'clip-time-range', { startMs: 0, endMs: 10, untimedPolicy: 'discard' }))

const jittered = dataset([
  { lat: 0, lon: 0, time: 1000 },
  { lat: 0, lon: 1, time: 1000 },
  { lat: 0, lon: 2, time: 900 },
  { lat: 0, lon: 3, time: 2000 },
])
const dejittered = executeOperation(jittered, 'dejitter-timestamps', { duplicatePolicy: 'nudge', epsilonMs: 1 })
check('De-jitter makes timestamps strictly increasing', dejittered.dataset.points.every((point, index, all) => index === 0 || point.time! > all[index - 1]!.time!))
throws('De-jitter rejects a zero epsilon', () => executeOperation(jittered, 'dejitter-timestamps', { duplicatePolicy: 'nudge', epsilonMs: 0 }))
// 'drop' changes the point count, which a scoped run must refuse rather than
// quietly widening to the whole dataset.
throws('Scoped de-jitter refuses the drop policy', () => executeOperation(jittered, 'dejitter-timestamps', { duplicatePolicy: 'drop', epsilonMs: 1 }, { indexRange: { start: 0, end: 3 } }))

// ---------------------------------------------------------------- replay

// The point of registration: a stack of operations, including scoped and
// point-count-changing ones, must reproduce byte-for-byte from the source.
const chain: { id: string; params: unknown; scope?: { indexRange: { start: number; end: number } } }[] = [
  { id: 'sort-by-time', params: {} },
  { id: 'drop-outliers', params: outlierParams },
  { id: 'elevation-filter', params: { mode: 'median', window: 5 }, scope: { indexRange: { start: 5, end: 25 } } },
  { id: 'round-precision', params: { coordinateDecimals: 5, elevationDecimals: 1 } },
  { id: 'reduce-points', params: { mode: 'simplify', epsilonMeters: 10 } },
  { id: 'standard-kinematics', params: {} },
  { id: 'shift-time', params: { seconds: 3 } },
]

let current = source
const records = []
for (const step of chain) {
  const execution = executeOperation(current, step.id, step.params, step.scope)
  current = execution.dataset
  records.push(execution.record)
}
check('Operation chain produced a record per step', records.length === chain.length)
check('Every record is replayable at the registered version', records.every((record) => getOperation(record.operationId)?.version === record.operationVersion))

const recipe = buildRecipe('repair chain', source, records)
let replayError: string | null = null
let replayed: Dataset | null = null
try { replayed = replayRecipe(source, recipe) } catch (error) { replayError = String(error) }
check('Recipe replays without error', replayError === null, replayError ?? '')
check('Replay reproduces the final point count', replayed?.points.length === current.points.length)
check('Replay reproduces the final coordinates', JSON.stringify(replayed?.points) === JSON.stringify(current.points))

// A tampered parameter must be rejected by validateParams on the way in, not
// discovered later as an output-hash mismatch.
const tampered = buildRecipe('tampered', source, records.map((record) => record.operationId === 'reduce-points'
  ? { ...record, params: { mode: 'simplify', epsilonMeters: 'ten' } }
  : record))
throws('Replay rejects a tampered parameter', () => replayRecipe(source, tampered))

console.log(`\n${failures === 0 ? 'ALL REPAIR OPERATION CHECKS PASSED' : `${failures} REPAIR OPERATION CHECK(S) FAILED`}`)
if (failures > 0) process.exit(1)

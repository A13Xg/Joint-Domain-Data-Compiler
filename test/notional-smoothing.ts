// Tranche 6 Task 6.4 (core layer): non-destructive notional gap-fill.
import type { Dataset, TrackPoint } from '../src/core/model.ts'
import { deriveNotionalSmoothedDataset, deriveNotionalSmoothedTrack } from '../src/core/derivations/notionalSmoothing.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function regularTrack(count: number, intervalMs = 1000): TrackPoint[] {
  return Array.from({ length: count }, (_, i) => ({ lat: 34 + i * 0.001, lon: -118 + i * 0.001, ele: 100 + i, time: i * intervalMs }))
}

// --- No gaps: passthrough, no insertions -----------------------------------
{
  const points = regularTrack(10, 1000)
  const result = deriveNotionalSmoothedTrack(points)
  check('No gap above threshold inserts nothing', result.insertedCount === 0 && result.points.length === 10)
  check('Original points are unchanged and in the same order', result.points.every((p, i) => p === points[i]))
}

// --- A single large gap gets filled ------------------------------------------
{
  const points: TrackPoint[] = [
    { lat: 0, lon: 0, ele: 100, time: 0 },
    { lat: 0, lon: 0, ele: 100, time: 1000 },
    { lat: 0, lon: 0, ele: 100, time: 2000 },
    { lat: 1, lon: 1, ele: 200, time: 12_000 }, // 10s gap after a 1000ms cadence
    { lat: 1.001, lon: 1.001, ele: 200, time: 13_000 },
  ]
  const result = deriveNotionalSmoothedTrack(points)
  check('A single 10s gap on a 1s cadence inserts real intermediate samples', result.insertedCount > 0, `${result.insertedCount}`)
  check('Original points are all still present', points.every((p) => result.points.includes(p)))
  check('Gap report identifies the correct before/after indices', result.gaps.length === 1 && result.gaps[0]?.beforeIndex === 2 && result.gaps[0]?.afterIndex === 3)

  const notional = result.points.filter((p) => p.ext?.notional === true)
  check('Inserted points are flagged notional in ext', notional.length === result.insertedCount)
  check('Inserted points carry the notional quality flag in provenance', notional.every((p) => p.provenance?.qualityFlags?.includes('notional')))
  check('Inserted points interpolate position between the gap endpoints', notional.every((p) => p.lat > 0 && p.lat < 1))
  check('Inserted points interpolate elevation', notional.every((p) => p.ele !== undefined && p.ele! > 100 && p.ele! < 200))
  check('Inserted points are chronologically ordered within the gap', notional.every((p, i) => i === 0 || p.time! > notional[i - 1]!.time!))
}

// --- Never mutates the source array/points -----------------------------------
{
  const points: TrackPoint[] = [
    { lat: 0, lon: 0, time: 0 },
    { lat: 0, lon: 0, time: 1000 },
    { lat: 1, lon: 1, time: 20_000 },
  ]
  const snapshot = JSON.parse(JSON.stringify(points))
  deriveNotionalSmoothedTrack(points)
  check('Source points array is untouched after derivation', JSON.stringify(points) === JSON.stringify(snapshot))
}

// --- Untimed points are left alone (no crash, no insertion around them) -----
{
  const points: TrackPoint[] = [{ lat: 0, lon: 0, time: 0 }, { lat: 0, lon: 0 }, { lat: 0, lon: 0, time: 20_000 }]
  const result = deriveNotionalSmoothedTrack(points)
  check('Untimed adjacent points do not trigger gap-fill', result.insertedCount === 0)
}

// --- Antimeridian-safe interpolation -----------------------------------------
{
  const points: TrackPoint[] = [
    { lat: 0, lon: 179.9, time: 0 },
    { lat: 0, lon: 179.95, time: 1000 },
    { lat: 0, lon: -179.9, time: 11_000 },
  ]
  const result = deriveNotionalSmoothedTrack(points)
  const notional = result.points.filter((p) => p.ext?.notional === true)
  check('Antimeridian-crossing gap interpolates the short way (near ±180, not through 0)', notional.every((p) => Math.abs(p.lon) > 170), notional.map((p) => p.lon.toFixed(2)).join(', '))
}

// --- Explicit sample interval override --------------------------------------
{
  const points: TrackPoint[] = [{ lat: 0, lon: 0, time: 0 }, { lat: 1, lon: 1, time: 20_000 }]
  const result = deriveNotionalSmoothedTrack(points, { gapThresholdMs: 3000, sampleIntervalMs: 5000 })
  check('An explicit sample interval controls the inserted count', result.insertedCount === 3, `${result.insertedCount}`)
}

// --- Rejects invalid options --------------------------------------------------
{
  let threw = false
  try { deriveNotionalSmoothedTrack(regularTrack(3), { gapThresholdMs: 0 }) } catch { threw = true }
  check('A non-positive gapThresholdMs is rejected', threw)
}
{
  let threw = false
  try { deriveNotionalSmoothedTrack(regularTrack(3), { sampleIntervalMs: -1 }) } catch { threw = true }
  check('A non-positive sampleIntervalMs is rejected', threw)
}

// --- Dataset wrapper: new dataset, source dataset untouched -------------------
{
  const source: Dataset = {
    id: 'ds1', name: 'track', sourceFormat: 'gpx',
    points: [{ lat: 0, lon: 0, time: 0 }, { lat: 1, lon: 1, time: 20_000 }],
    warnings: [], channels: [], createdAt: 0,
  }
  const { dataset: derived, result } = deriveNotionalSmoothedDataset(source, { gapThresholdMs: 3000 })
  check('Derived dataset has a distinct id', derived.id === 'ds1_notionalSmoothed')
  check('Derived dataset name is suffixed for the same entity', derived.name === 'track_notionalSmoothed')
  check('Derived dataset has more points than the source (gap was filled)', derived.points.length > source.points.length)
  check('Source dataset object is untouched', source.points.length === 2 && source.id === 'ds1')
  check('Result report matches the derived dataset point count', derived.points.length === source.points.length + result.insertedCount)
}

console.log(`\n${failures === 0 ? 'ALL NOTIONAL SMOOTHING CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

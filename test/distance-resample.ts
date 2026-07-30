// Task 5.2: distance-based resampling using monotone cubic interpolation.
import type { Dataset } from '../src/core/model.ts'
import { distanceResampleMonotoneOperation } from '../src/core/operations/distance-resample.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function makeDataset(points: Dataset['points']): Dataset {
  return { id: 'd', name: 'd', sourceFormat: 'csv', createdAt: 0, warnings: [], channels: [], points }
}

// --- Invalid params ------------------------------------------------------------
{
  let threw = false
  try { distanceResampleMonotoneOperation.validateParams({ intervalMeters: 0 }) } catch { threw = true }
  check('intervalMeters of 0 is rejected', threw)
  threw = false
  try { distanceResampleMonotoneOperation.validateParams({ intervalMeters: -5 }) } catch { threw = true }
  check('Negative intervalMeters is rejected', threw)
  threw = false
  try { distanceResampleMonotoneOperation.validateParams('nope') } catch { threw = true }
  check('Non-object params are rejected', threw)
}

// --- Edge inputs -----------------------------------------------------------
{
  const dataset = makeDataset([{ lat: 0, lon: 0 }])
  let threw = false
  try {
    distanceResampleMonotoneOperation.execute({ dataset, params: { intervalMeters: 10 } })
  } catch { threw = true }
  check('A single point is rejected (need at least two)', threw)
}
{
  const dataset = makeDataset([{ lat: 0, lon: 0 }, { lat: 0, lon: 0 }, { lat: 0, lon: 0 }])
  let threw = false
  try {
    distanceResampleMonotoneOperation.execute({ dataset, params: { intervalMeters: 10 } })
  } catch { threw = true }
  check('All-coincident points are rejected (no spatial extent to fit)', threw)
}
{
  const dataset = makeDataset([])
  let threw = false
  try {
    distanceResampleMonotoneOperation.execute({ dataset, params: { intervalMeters: 10 } })
  } catch { threw = true }
  check('Empty dataset is rejected', threw)
}

// --- Immutability ------------------------------------------------------------
{
  const points: Dataset['points'] = [
    { lat: 0, lon: 0, ele: 0 },
    { lat: 0, lon: 0.01, ele: 5 },
    { lat: 0, lon: 0.02, ele: 0 },
  ]
  const original = JSON.parse(JSON.stringify(points))
  const dataset = makeDataset(points)
  distanceResampleMonotoneOperation.execute({ dataset, params: { intervalMeters: 100 } })
  check('Execute does not mutate source points', JSON.stringify(points) === JSON.stringify(original))
}

// --- Basic behavior ------------------------------------------------------------
{
  // A straight line along longitude at the equator: ~111.19 km per degree.
  const points: Dataset['points'] = [
    { lat: 0, lon: 0, ele: 0 },
    { lat: 0, lon: 0.001, ele: 10 },
    { lat: 0, lon: 0.002, ele: 0 },
  ]
  const dataset = makeDataset(points)
  const params = distanceResampleMonotoneOperation.validateParams({ intervalMeters: 20 })
  const result = distanceResampleMonotoneOperation.execute({ dataset, params })
  check('Produces more than one output point', result.dataset.points.length > 1)
  check('First point matches the start latitude/longitude closely', Math.abs(result.dataset.points[0]!.lon - 0) < 1e-6)
  check('Last point matches the end longitude closely', Math.abs(result.dataset.points.at(-1)!.lon - 0.002) < 1e-6)
  check('Output points are flagged interpolated + monotone_cubic', result.dataset.points.every((p) => p.provenance?.qualityFlags?.includes('monotone_cubic')))
  const eles = result.dataset.points.map((p) => p.ele ?? 0)
  check('Elevation never overshoots the [0, 10] range of the input', eles.every((e) => e >= -1e-6 && e <= 10 + 1e-6), `min=${Math.min(...eles)} max=${Math.max(...eles)}`)
}
{
  // Coincident duplicate point in the middle should be dropped, not crash the fit.
  const points: Dataset['points'] = [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.001 },
    { lat: 0, lon: 0.001 }, // duplicate
    { lat: 0, lon: 0.002 },
  ]
  const dataset = makeDataset(points)
  const params = distanceResampleMonotoneOperation.validateParams({ intervalMeters: 500 })
  const result = distanceResampleMonotoneOperation.execute({ dataset, params })
  check('Coincident duplicate point produces a warning', (result.warnings?.length ?? 0) === 1, JSON.stringify(result.warnings))
}
{
  // Scoped execution is not supported yet.
  const points: Dataset['points'] = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }]
  const dataset = makeDataset(points)
  let threw = false
  try {
    distanceResampleMonotoneOperation.execute({ dataset, params: { intervalMeters: 10 }, scope: { indexRange: { start: 0, end: 1 } } })
  } catch { threw = true }
  check('Scoped execution is rejected', threw)
}

// --- Time, name/desc, and non-numeric ext carry ------------------------------------------------------------
{
  // Straight line with monotone time-vs-distance: time should be interpolated,
  // not dropped.
  const points: Dataset['points'] = [
    { lat: 0, lon: 0, time: 0 },
    { lat: 0, lon: 0.001, time: 10_000 },
    { lat: 0, lon: 0.002, time: 20_000 },
  ]
  const dataset = makeDataset(points)
  const params = distanceResampleMonotoneOperation.validateParams({ intervalMeters: 20 })
  const result = distanceResampleMonotoneOperation.execute({ dataset, params })
  check('Time is populated on every output point when source time is monotone', result.dataset.points.every((p) => p.time !== undefined))
  check('First output point time matches the start time', result.dataset.points[0]!.time === 0)
  check('Last output point time matches the end time', Math.abs(result.dataset.points.at(-1)!.time! - 20_000) < 1e-6)
  const times = result.dataset.points.map((p) => p.time!)
  check('Interpolated time is non-decreasing across output points', times.every((t, i) => i === 0 || t >= times[i - 1]!))
}
{
  // Name/desc are carried from the nearest source point rather than dropped.
  const points: Dataset['points'] = [
    { lat: 0, lon: 0, name: 'start', desc: 'origin' },
    { lat: 0, lon: 0.001, name: 'mid', desc: 'midpoint' },
    { lat: 0, lon: 0.002, name: 'end', desc: 'terminus' },
  ]
  const dataset = makeDataset(points)
  const params = distanceResampleMonotoneOperation.validateParams({ intervalMeters: 20 })
  const result = distanceResampleMonotoneOperation.execute({ dataset, params })
  check('Every output point carries a name from the nearest source point', result.dataset.points.every((p) => p.name !== undefined))
  check('First output point carries the start name/desc', result.dataset.points[0]!.name === 'start' && result.dataset.points[0]!.desc === 'origin')
  check('Last output point carries the end name/desc', result.dataset.points.at(-1)!.name === 'end' && result.dataset.points.at(-1)!.desc === 'terminus')
}
{
  // A non-numeric (string) ext channel is carried from the nearest source
  // point rather than being dropped entirely, and a partially-numeric
  // channel is treated the same way (not interpolated).
  const points: Dataset['points'] = [
    { lat: 0, lon: 0, ext: { mode: 'cruise', mixed: 1 } },
    { lat: 0, lon: 0.001, ext: { mode: 'climb', mixed: 'n/a' } },
    { lat: 0, lon: 0.002, ext: { mode: 'descent', mixed: 3 } },
  ]
  const dataset = makeDataset(points)
  const params = distanceResampleMonotoneOperation.validateParams({ intervalMeters: 20 })
  const result = distanceResampleMonotoneOperation.execute({ dataset, params })
  check('String ext channel survives via nearest-carry', result.dataset.points.some((p) => p.ext?.mode !== undefined))
  check('First output point carries the start mode', result.dataset.points[0]!.ext?.mode === 'cruise')
  check('Last output point carries the end mode', result.dataset.points.at(-1)!.ext?.mode === 'descent')
  check('Partially-numeric ext channel is carried, not interpolated', result.dataset.points.some((p) => p.ext?.mixed === 'n/a' || p.ext?.mixed === 1 || p.ext?.mixed === 3))
}
{
  // Non-monotone time (a GPS glitch/loop) must not be silently interpolated
  // into a fabricated monotone sequence.
  const points: Dataset['points'] = [
    { lat: 0, lon: 0, time: 0 },
    { lat: 0, lon: 0.001, time: 20_000 },
    { lat: 0, lon: 0.002, time: 10_000 }, // time goes backward while distance keeps increasing
  ]
  const dataset = makeDataset(points)
  const params = distanceResampleMonotoneOperation.validateParams({ intervalMeters: 20 })
  const result = distanceResampleMonotoneOperation.execute({ dataset, params })
  check('Non-monotone time is dropped rather than interpolated', result.dataset.points.every((p) => p.time === undefined))
  check('Non-monotone time produces a warning', (result.warnings ?? []).some((w) => w.includes('not monotone')), JSON.stringify(result.warnings))
}

console.log(`\n${failures === 0 ? 'ALL DISTANCE RESAMPLE CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

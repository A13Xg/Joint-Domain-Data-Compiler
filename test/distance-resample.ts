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

console.log(`\n${failures === 0 ? 'ALL DISTANCE RESAMPLE CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

// Task 5.2: timestamp de-jitter / duplicate-timestamp policy / clock-drift
// correction. Covers the default 'nudge' policy plus 'drop' and 'average',
// and edge/invalid inputs (empty, single point, all-duplicate timestamps,
// immutability of inputs).
import type { TrackPoint } from '../src/core/model.ts'
import { dejitterTimestamps } from '../src/core/transforms.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function track(times: (number | undefined)[]): TrackPoint[] {
  return times.map((time, i) => ({ lat: 34 + i * 0.001, lon: -118 + i * 0.001, time }))
}

function isStrictlyIncreasing(points: TrackPoint[]): boolean {
  let last: number | undefined
  for (const p of points) {
    if (p.time === undefined) continue
    if (last !== undefined && p.time <= last) return false
    last = p.time
  }
  return true
}

// --- Edge cases ------------------------------------------------------------
{
  const result = dejitterTimestamps([])
  check('Empty input returns empty output', result.points.length === 0)
}
{
  const points = track([1000])
  const result = dejitterTimestamps(points)
  check('Single point is unchanged', result.points[0]?.time === 1000)
  check('Single point produces no correction flags', result.points[0]?.provenance?.qualityFlags === undefined)
}
{
  // All points share the same timestamp — pure duplicate-timestamp stress case.
  const points = track([5000, 5000, 5000, 5000])

  const nudged = dejitterTimestamps(points, { duplicatePolicy: 'nudge', epsilonMs: 10 })
  check('All-duplicate + nudge preserves point count', nudged.points.length === 4)
  check('All-duplicate + nudge yields strictly increasing timestamps', isStrictlyIncreasing(nudged.points))
  check('All-duplicate + nudge spaces by epsilon', nudged.points.map((p) => p.time).join(',') === '5000,5010,5020,5030')

  const dropped = dejitterTimestamps(points, { duplicatePolicy: 'drop' })
  check('All-duplicate + drop keeps only the first point', dropped.points.length === 1 && dropped.points[0]?.time === 5000)

  const averaged = dejitterTimestamps(points, { duplicatePolicy: 'average' })
  check('All-duplicate + average collapses to a single point', averaged.points.length === 1 && averaged.points[0]?.time === 5000)
}

// --- Immutability ------------------------------------------------------------
{
  const points = track([0, 0, 100])
  const original = JSON.parse(JSON.stringify(points))
  dejitterTimestamps(points, { duplicatePolicy: 'nudge' })
  check('Nudge does not mutate input points', JSON.stringify(points) === JSON.stringify(original))
  dejitterTimestamps(points, { duplicatePolicy: 'drop' })
  check('Drop does not mutate input points', JSON.stringify(points) === JSON.stringify(original))
  dejitterTimestamps(points, { duplicatePolicy: 'average' })
  check('Average does not mutate input points', JSON.stringify(points) === JSON.stringify(original))
}

// --- Default policy is 'nudge' ------------------------------------------------
{
  const points = track([0, 0, 200])
  const result = dejitterTimestamps(points)
  check("Default policy is 'nudge'", result.summary.includes('policy=nudge'), result.summary)
  check('Default epsilon is 1ms', result.points[1]?.time === 1)
  check('Nudged point is flagged', result.points[1]?.provenance?.qualityFlags?.includes('time_dejittered') === true)
  check('Untouched leading point is not flagged', result.points[0]?.provenance?.qualityFlags === undefined)
}

// --- Backward drift (not an exact duplicate) --------------------------------
{
  const points = track([1000, 900, 2000]) // clock jumped backward, then recovered
  const result = dejitterTimestamps(points, { duplicatePolicy: 'nudge', epsilonMs: 5 })
  check('Backward drift is corrected forward from the previous kept time', result.points[1]?.time === 1005)
  check('Sequence is strictly increasing after correction', isStrictlyIncreasing(result.points))
}

// --- Untimed points pass through untouched ----------------------------------
{
  const points: TrackPoint[] = [{ lat: 0, lon: 0, time: 100 }, { lat: 1, lon: 1 }, { lat: 2, lon: 2, time: 100 }]
  const result = dejitterTimestamps(points, { duplicatePolicy: 'nudge' })
  check('Untimed point count preserved and untouched', result.points.length === 3 && result.points[1]?.time === undefined)
  check('Timed duplicate after an untimed point is still corrected', result.points[2]?.time === 101)
}

// --- Invalid epsilon ---------------------------------------------------------
{
  let threw = false
  try { dejitterTimestamps(track([0, 0]), { epsilonMs: 0 }) } catch { threw = true }
  check('epsilonMs of 0 is rejected', threw)
  threw = false
  try { dejitterTimestamps(track([0, 0]), { epsilonMs: -5 }) } catch { threw = true }
  check('Negative epsilonMs is rejected', threw)
}

console.log(`\n${failures === 0 ? 'ALL DE-JITTER CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

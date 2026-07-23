import { alignTracksByNearestTime, deriveRelativePosition } from '../src/core/analytics/relative.ts'
import type { TrackPoint } from '../src/core/model.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const reference: TrackPoint[] = [
  { lat: 0, lon: 0, ele: 100, time: 1000 },
  { lat: 0, lon: 0, ele: 100, time: 2000 },
  { lat: 0, lon: 0, ele: 100, time: 3000 },
]
const target: TrackPoint[] = [
  { lat: 0, lon: 0.001, ele: 110, time: 1010 },
  { lat: 0, lon: 0.0005, ele: 105, time: 2010 },
  { lat: 0, lon: 0.00025, ele: 100, time: 3010 },
]

const pairs = alignTracksByNearestTime(reference, target, { toleranceMs: 20 })
check('Nearest-time alignment pairs all samples', pairs.length === 3)
check('Alignment preserves source indices', pairs[1]?.referenceIndex === 1 && pairs[1].targetIndex === 1)
check('Alignment reports signed delta', pairs[0]?.deltaTimeMs === 10)

const samples = deriveRelativePosition(reference, target, pairs)
check('Relative position produces all samples', samples.length === 3)
check('East separation is approximately 111 m', Math.abs((samples[0]?.relativeEastM ?? 0) - 111.319) < 0.2, String(samples[0]?.relativeEastM))
check('North separation is near zero', Math.abs(samples[0]?.relativeNorthM ?? 0) < 0.01)
check('Bearing is east', Math.abs((samples[0]?.bearingDeg ?? 0) - 90) < 0.01)
check('Altitude separation is derived', samples[0]?.altitudeSeparationM === 10)
check('Closure rate is positive while target approaches', (samples[1]?.closureRateMps ?? 0) > 50)

const offsetPairs = alignTracksByNearestTime(reference, target, { toleranceMs: 1, targetTimeOffsetMs: -10 })
check('Manual target time offset aligns exact timestamps', offsetPairs.length === 3 && offsetPairs.every((pair) => pair.deltaTimeMs === 0))

const missingTimePairs = alignTracksByNearestTime([{ lat: 0, lon: 0 }], target, { toleranceMs: 100 })
check('Untimed reference samples are ignored', missingTimePairs.length === 0)

let invalidToleranceRejected = false
try {
  alignTracksByNearestTime(reference, target, { toleranceMs: -1 })
} catch {
  invalidToleranceRejected = true
}
check('Negative alignment tolerance is rejected', invalidToleranceRejected)

console.log(`\n${failures === 0 ? 'ALL RELATIVE ANALYTICS CHECKS PASSED' : `${failures} RELATIVE ANALYTICS CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

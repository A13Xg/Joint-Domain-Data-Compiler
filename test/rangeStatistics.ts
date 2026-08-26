import type { TrackPoint } from '../src/core/model.ts'
import { calculateRangeStatistics } from '../src/core/analytics/rangeStatistics.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const points: TrackPoint[] = [
  { lat: 0, lon: 0, ele: 10, time: 0, ext: { speed_mps: 2 } },
  { lat: 0, lon: 0.001, ele: 20, time: 1000, ext: { speed_mps: 4 } },
  { lat: 0, lon: 0.002, ele: 30, time: 2000, ext: { speed_mps: 6 } },
]

const statistics = calculateRangeStatistics(points, { start: 2, end: 0 }, ['speed_mps'])
check('Normalizes reversed ranges', statistics.startIndex === 0 && statistics.endIndex === 2)
check('Counts selected points', statistics.pointCount === 3)
check('Computes duration', statistics.durationSeconds === 2)
check('Computes positive distance', statistics.distanceMeters > 200 && statistics.distanceMeters < 230)
check('Summarizes elevation', statistics.channels.elevation?.mean === 20)
check('Summarizes selected channels', statistics.channels.speed_mps?.min === 2 && statistics.channels.speed_mps?.max === 6)

const clamped = calculateRangeStatistics(points, { start: -10, end: 99 })
check('Clamps ranges to dataset bounds', clamped.startIndex === 0 && clamped.endIndex === 2)

let emptyRejected = false
try {
  calculateRangeStatistics([], { start: 0, end: 1 })
} catch {
  emptyRejected = true
}
check('Rejects empty datasets', emptyRejected)

console.log(`\n${failures === 0 ? 'ALL RANGE STATISTICS CHECKS PASSED' : `${failures} RANGE STATISTICS CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

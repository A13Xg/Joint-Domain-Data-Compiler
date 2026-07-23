import type { TrackPoint } from '../src/core/model.ts'
import { DEFAULT_SEGMENT_CONFIG, segmentTrack } from '../src/core/analytics/segments.ts'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const points: TrackPoint[] = [
  { lat: 0, lon: 0, time: 0, ext: { ground_speed_mps: 0, vertical_speed_mps: 0, distance_m: 0 } },
  { lat: 0, lon: 0, time: 1000, ext: { ground_speed_mps: 0.5, vertical_speed_mps: 0, sample_interval_s: 1, distance_m: 0.5 } },
  { lat: 0, lon: 0.001, time: 2000, ext: { ground_speed_mps: 20, vertical_speed_mps: 3, sample_interval_s: 1, distance_m: 20 } },
  { lat: 0, lon: 0.002, time: 3000, ext: { ground_speed_mps: 21, vertical_speed_mps: 2, sample_interval_s: 1, distance_m: 41 } },
  { lat: 0, lon: 0.003, time: 4000, ext: { ground_speed_mps: 22, vertical_speed_mps: 0.2, sample_interval_s: 1, distance_m: 63 } },
  { lat: 0, lon: 0.004, time: 5000, ext: { ground_speed_mps: 22, vertical_speed_mps: -2, sample_interval_s: 1, distance_m: 85 } },
  { lat: 0, lon: 0.005, time: 20000, ext: { ground_speed_mps: 22, vertical_speed_mps: -2, sample_interval_s: 15, distance_m: 107 } },
]

const segments = segmentTrack(points, DEFAULT_SEGMENT_CONFIG)
check('Detects stationary segment', segments.some((segment) => segment.kind === 'stationary' && segment.pointCount === 2))
check('Detects climb segment', segments.some((segment) => segment.kind === 'climb' && segment.pointCount === 2))
check('Detects gap segment', segments.some((segment) => segment.kind === 'gap'))
check('Preserves source index ranges', segments[0]?.startIndex === 0 && segments.at(-1)?.endIndex === points.length - 1)
check('Computes duration and distance statistics', segments.some((segment) => (segment.durationSeconds ?? 0) > 0 && (segment.distanceMeters ?? 0) > 0))

const merged = segmentTrack(points, { ...DEFAULT_SEGMENT_CONFIG, minSegmentPoints: 2 })
check('Short transitional segments merge into neighbors', merged.length < 6)

let invalidRejected = false
try {
  segmentTrack(points, { ...DEFAULT_SEGMENT_CONFIG, gapSeconds: 0 })
} catch {
  invalidRejected = true
}
check('Invalid segmentation configuration is rejected', invalidRejected)

check('Empty tracks produce no segments', segmentTrack([]).length === 0)

console.log(`\n${failures === 0 ? 'ALL SEGMENTATION CHECKS PASSED' : `${failures} SEGMENTATION CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

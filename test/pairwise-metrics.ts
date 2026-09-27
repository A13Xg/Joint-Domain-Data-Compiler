// Pairwise range/bearing/closure-rate-at-arbitrary-time (Playback/Graph
// shared helper). See docs/superpowers/specs/2026-09-27-jddc-suite-design.md §11 item 8.
import type { TrackPoint } from '../src/core/model'
import { computePairwiseSeries, interpolateTrackPositionAtTime, pairwiseMetricsAtTime } from '../src/core/analytics/pairwise'

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}
function close(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps
}

// --- interpolateTrackPositionAtTime ---
const track: TrackPoint[] = [
  { lat: 0, lon: 0, ele: 100, time: 0 },
  { lat: 0, lon: 1, ele: 200, time: 10_000 },
  { lat: 0, lon: 2, ele: 300, time: 20_000 },
]

const exact = interpolateTrackPositionAtTime(track, 10_000)
check('interpolation returns the exact observed sample when timeMs matches, not marked derived', exact !== undefined && !exact.derived && close(exact.lon, 1))

const midpoint = interpolateTrackPositionAtTime(track, 5_000)
check('interpolation at the midpoint between two samples is marked derived', midpoint !== undefined && midpoint.derived)
check('interpolated longitude is the linear midpoint', midpoint !== undefined && close(midpoint.lon, 0.5))
check('interpolated elevation is the linear midpoint', midpoint !== undefined && close(midpoint.ele!, 150))

check('interpolation before the first sample returns undefined (never extrapolates)', interpolateTrackPositionAtTime(track, -1_000) === undefined)
check('interpolation after the last sample returns undefined (never extrapolates)', interpolateTrackPositionAtTime(track, 21_000) === undefined)

const gapped: TrackPoint[] = [
  { lat: 0, lon: 0, time: 0 },
  { lat: 0, lon: 10, time: 100_000 },
]
check(
  'a bracket wider than maxBracketGapMs is refused rather than bridged',
  interpolateTrackPositionAtTime(gapped, 50_000, 10_000) === undefined,
)
check(
  'the same bracket is interpolated once the gap limit allows it',
  interpolateTrackPositionAtTime(gapped, 50_000, 200_000) !== undefined,
)

// Antimeridian: -179.9 -> 179.9 should interpolate the short way (through 180), not through 0.
const antimeridian: TrackPoint[] = [
  { lat: 10, lon: -179.9, time: 0 },
  { lat: 10, lon: 179.9, time: 10_000 },
]
const acrossAntimeridian = interpolateTrackPositionAtTime(antimeridian, 5_000)
check(
  'longitude interpolation is antimeridian-safe (crosses 180, not 0)',
  acrossAntimeridian !== undefined && Math.abs(acrossAntimeridian.lon) > 179,
)

// --- pairwiseMetricsAtTime ---
// Two tracks 10km apart on the same latitude, both stationary in time.
const stationaryA: TrackPoint[] = [{ lat: 0, lon: 0, ele: 0, time: 0 }, { lat: 0, lon: 0, ele: 0, time: 20_000 }]
const stationaryB: TrackPoint[] = [{ lat: 0, lon: 0.0899, ele: 0, time: 0 }, { lat: 0, lon: 0.0899, ele: 0, time: 20_000 }]
const stationaryMetrics = pairwiseMetricsAtTime(stationaryA, stationaryB, 5_000)
check('pairwise range between two ~10km-apart tracks is in the right ballpark', stationaryMetrics !== undefined && stationaryMetrics.horizontalRangeM > 9_000 && stationaryMetrics.horizontalRangeM < 11_000)
check('bearing from A to B (due east) is ~90 degrees', stationaryMetrics !== undefined && close(stationaryMetrics.bearingDeg, 90, 1))
check('closure rate is ~0 for two stationary tracks', stationaryMetrics !== undefined && Math.abs(stationaryMetrics.closureRateMps ?? 1) < 0.01)

// A closing scenario: B moves toward A at a known rate over 10s.
const closingA: TrackPoint[] = [{ lat: 0, lon: 0, ele: 0, time: 0 }, { lat: 0, lon: 0, ele: 0, time: 20_000 }]
const closingB: TrackPoint[] = [
  { lat: 0, lon: 0.1, ele: 0, time: 0 },
  { lat: 0, lon: 0.05, ele: 0, time: 10_000 },
  { lat: 0, lon: 0, ele: 0, time: 20_000 },
]
const closingMetrics = pairwiseMetricsAtTime(closingA, closingB, 10_000, { closureLookbackMs: 1_000 })
check('closure rate is positive when the target is approaching', closingMetrics !== undefined && (closingMetrics.closureRateMps ?? -1) > 0)

check('pairwiseMetricsAtTime returns undefined when a query time is outside both tracks', pairwiseMetricsAtTime(stationaryA, stationaryB, 30_000) === undefined)

// --- computePairwiseSeries ---
const series = computePairwiseSeries(closingA, closingB, { sampleCount: 21 })
check('computePairwiseSeries samples across the overlapping time range', series.length > 0 && series.length <= 21)
check('computePairwiseSeries samples are in ascending time order', series.every((s, i) => i === 0 || s.timeMs >= series[i - 1]!.timeMs))
check('computePairwiseSeries samples never fall outside the overlap', series.every((s) => s.timeMs >= 0 && s.timeMs <= 20_000))
check('computePairwiseSeries is empty when the tracks share no time overlap', computePairwiseSeries(
  [{ lat: 0, lon: 0, time: 0 }, { lat: 0, lon: 0, time: 1_000 }],
  [{ lat: 0, lon: 0, time: 100_000 }, { lat: 0, lon: 0, time: 101_000 }],
).length === 0)

console.log(`\n${failures === 0 ? 'ALL PAIRWISE METRICS CHECKS PASSED' : `${failures} PAIRWISE METRICS CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

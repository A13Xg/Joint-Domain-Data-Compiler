// Shared range/bearing/closure-rate query used by both Playback and Graph
// (docs/superpowers/specs/2026-09-27-jddc-suite-design.md §11 item 8: build
// once, so the two apps can't compute it differently). Unlike
// `deriveInterpolatedRelativePosition` in `relative.ts` (which aligns a
// *target* track to a *reference* track's own observed sample times, for
// whole-track comparison), this answers "where is each track at this one
// arbitrary clock instant" — the question a playback scrubber or a
// time-synced chart cursor actually asks, where neither track's samples
// necessarily land on the query time.
import { geodeticToEnu } from '../geodesy'
import { lerp, lerpLon } from '../geoInterpolation'
import type { TrackPoint } from '../model'

export interface InterpolatedPosition {
  lat: number
  lon: number
  ele?: number
  /** True when between two observed samples rather than exactly on one — never fabricated beyond that bracket. */
  derived: boolean
}

/**
 * Interpolates a track's position at `timeMs`. Only interpolates strictly
 * between two real, time-ordered samples no further apart than
 * `maxBracketGapMs` — never extrapolates before the first or after the last
 * sample, and never bridges a gap wider than the caller allows.
 */
export function interpolateTrackPositionAtTime(
  points: readonly TrackPoint[],
  timeMs: number,
  maxBracketGapMs = Infinity,
): InterpolatedPosition | undefined {
  const timed = points.filter((point): point is TrackPoint & { time: number } => point.time !== undefined)
  if (timed.length === 0) return undefined

  let before: (TrackPoint & { time: number }) | undefined
  let after: (TrackPoint & { time: number }) | undefined
  for (const point of timed) {
    if (point.time === timeMs) return { lat: point.lat, lon: point.lon, ele: point.ele, derived: false }
    if (point.time < timeMs && (before === undefined || point.time > before.time)) before = point
    if (point.time > timeMs && (after === undefined || point.time < after.time)) after = point
  }
  if (!before || !after) return undefined
  const gap = after.time - before.time
  if (gap <= 0 || gap > maxBracketGapMs) return undefined

  const fraction = (timeMs - before.time) / gap
  return {
    lat: lerp(before.lat, after.lat, fraction),
    lon: lerpLon(before.lon, after.lon, fraction),
    ele: before.ele !== undefined && after.ele !== undefined ? lerp(before.ele, after.ele, fraction) : undefined,
    derived: true,
  }
}

export interface PairwiseMetrics {
  horizontalRangeM: number
  slantRangeM: number
  bearingDeg: number
  altitudeSeparationM?: number
  /** Present only when a valid position could also be interpolated at `timeMs - closureLookbackMs`. */
  closureRateMps?: number
}

/**
 * Range/bearing/closure-rate between two tracks at one instant. Closure rate
 * is estimated from a short backward finite difference (default 1s) rather
 * than stored per-sample, matching the "computed on-demand, never stored"
 * invariant for pairwise metrics.
 */
export function pairwiseMetricsAtTime(
  a: readonly TrackPoint[],
  b: readonly TrackPoint[],
  timeMs: number,
  options: { maxBracketGapMs?: number; closureLookbackMs?: number } = {},
): PairwiseMetrics | undefined {
  const maxBracketGapMs = options.maxBracketGapMs ?? Infinity
  const posA = interpolateTrackPositionAtTime(a, timeMs, maxBracketGapMs)
  const posB = interpolateTrackPositionAtTime(b, timeMs, maxBracketGapMs)
  if (!posA || !posB) return undefined

  const relative = geodeticToEnu(
    { latDeg: posB.lat, lonDeg: posB.lon, heightM: posB.ele ?? 0 },
    { latDeg: posA.lat, lonDeg: posA.lon, heightM: posA.ele ?? 0 },
  )
  const horizontalRangeM = Math.hypot(relative.eastM, relative.northM)
  const slantRangeM = Math.hypot(horizontalRangeM, relative.upM)
  const bearingDeg = (Math.atan2(relative.eastM, relative.northM) * 180 / Math.PI + 360) % 360
  const altitudeSeparationM = posA.ele !== undefined && posB.ele !== undefined ? posB.ele - posA.ele : undefined

  const lookbackMs = options.closureLookbackMs ?? 1000
  const previous = pairwiseRangeOnlyAtTime(a, b, timeMs - lookbackMs, maxBracketGapMs)
  const closureRateMps = previous !== undefined ? (previous - slantRangeM) / (lookbackMs / 1000) : undefined

  return { horizontalRangeM, slantRangeM, bearingDeg, altitudeSeparationM, ...(closureRateMps !== undefined ? { closureRateMps } : {}) }
}

export interface PairwiseSeriesSample {
  timeMs: number
  metrics: PairwiseMetrics
}

/**
 * Samples `pairwiseMetricsAtTime` across the overlap of both tracks' time
 * ranges, for a Graph chart. `sampleCount` bounds the work (and the chart's
 * point budget) rather than sampling every raw point — this is a display
 * reduction, same posture as `extractChartSeries`'s `maxSamples`, never
 * persisted back onto either Dataset (invariant: pairwise metrics are
 * computed on-demand, never stored).
 */
export function computePairwiseSeries(
  a: readonly TrackPoint[],
  b: readonly TrackPoint[],
  options: { maxBracketGapMs?: number; closureLookbackMs?: number; sampleCount?: number } = {},
): PairwiseSeriesSample[] {
  const rangeA = timeRangeOf(a)
  const rangeB = timeRangeOf(b)
  if (!rangeA || !rangeB) return []
  const startMs = Math.max(rangeA.startMs, rangeB.startMs)
  const endMs = Math.min(rangeA.endMs, rangeB.endMs)
  if (endMs <= startMs) return []

  const sampleCount = Math.max(2, options.sampleCount ?? 200)
  const samples: PairwiseSeriesSample[] = []
  for (let i = 0; i < sampleCount; i++) {
    const timeMs = startMs + ((endMs - startMs) * i) / (sampleCount - 1)
    const metrics = pairwiseMetricsAtTime(a, b, timeMs, options)
    if (metrics) samples.push({ timeMs, metrics })
  }
  return samples
}

function timeRangeOf(points: readonly TrackPoint[]): { startMs: number; endMs: number } | undefined {
  let startMs: number | undefined
  let endMs: number | undefined
  for (const point of points) {
    if (point.time === undefined) continue
    if (startMs === undefined || point.time < startMs) startMs = point.time
    if (endMs === undefined || point.time > endMs) endMs = point.time
  }
  return startMs !== undefined && endMs !== undefined ? { startMs, endMs } : undefined
}

function pairwiseRangeOnlyAtTime(a: readonly TrackPoint[], b: readonly TrackPoint[], timeMs: number, maxBracketGapMs: number): number | undefined {
  const posA = interpolateTrackPositionAtTime(a, timeMs, maxBracketGapMs)
  const posB = interpolateTrackPositionAtTime(b, timeMs, maxBracketGapMs)
  if (!posA || !posB) return undefined
  const relative = geodeticToEnu(
    { latDeg: posB.lat, lonDeg: posB.lon, heightM: posB.ele ?? 0 },
    { latDeg: posA.lat, lonDeg: posA.lon, heightM: posA.ele ?? 0 },
  )
  return Math.hypot(Math.hypot(relative.eastM, relative.northM), relative.upM)
}

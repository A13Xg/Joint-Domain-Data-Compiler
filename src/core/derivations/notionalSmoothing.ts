// Tranche 6 Task 6.4 (core layer): non-destructive notional gap-fill.
// Never edits source points — always returns a new array/dataset. Inserted
// points are linearly interpolated in time and space and are always flagged
// `notional` in provenance so they can never be mistaken for observed
// telemetry downstream (charts, map, export).
import type { Dataset, TrackPoint } from '../model'
import { withPoints } from '../transforms'

export interface NotionalSmoothingOptions {
  /** Gaps at or below this duration are left alone. Defaults to 3000ms per the plan. */
  gapThresholdMs: number
  /** Target spacing for inserted samples. Defaults to the median observed interval among non-gap consecutive timed points. */
  sampleIntervalMs?: number
}

export interface NotionalGapReport {
  /** Index into the ORIGINAL points array of the last real point before the gap. */
  beforeIndex: number
  /** Index into the ORIGINAL points array of the first real point after the gap. */
  afterIndex: number
  durationMs: number
  insertedCount: number
  sampleIntervalMs: number
}

export interface NotionalSmoothingResult {
  points: TrackPoint[]
  gaps: NotionalGapReport[]
  insertedCount: number
}

const DEFAULT_GAP_THRESHOLD_MS = 3000

/** Median interval among consecutive timed points, excluding any interval already above the gap threshold (so gaps don't skew the "normal" cadence estimate). */
function estimateSampleIntervalMs(points: readonly TrackPoint[], gapThresholdMs: number): number {
  const intervals: number[] = []
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]!.time
    const current = points[i]!.time
    if (previous === undefined || current === undefined) continue
    const delta = current - previous
    if (delta > 0 && delta <= gapThresholdMs) intervals.push(delta)
  }
  if (intervals.length === 0) return gapThresholdMs
  const sorted = [...intervals].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Shortest-path longitude interpolation so an antimeridian-crossing gap doesn't produce points that wrap the wrong way around the globe. */
function lerpLon(a: number, b: number, t: number): number {
  let delta = b - a
  if (delta > 180) delta -= 360
  else if (delta < -180) delta += 360
  const result = a + delta * t
  return ((result + 540) % 360) - 180
}

export function deriveNotionalSmoothedTrack(
  points: readonly TrackPoint[],
  options: Partial<NotionalSmoothingOptions> = {},
): NotionalSmoothingResult {
  const gapThresholdMs = options.gapThresholdMs ?? DEFAULT_GAP_THRESHOLD_MS
  if (gapThresholdMs <= 0) throw new RangeError('gapThresholdMs must be positive')
  const sampleIntervalMs = options.sampleIntervalMs ?? estimateSampleIntervalMs(points, gapThresholdMs)
  if (sampleIntervalMs <= 0) throw new RangeError('sampleIntervalMs must be positive')

  const out: TrackPoint[] = []
  const gaps: NotionalGapReport[] = []

  for (let i = 0; i < points.length; i++) {
    const current = points[i]!
    out.push(current)
    if (i === points.length - 1) continue

    const next = points[i + 1]!
    if (current.time === undefined || next.time === undefined) continue
    const durationMs = next.time - current.time
    if (durationMs <= gapThresholdMs) continue

    const insertedCount = Math.max(0, Math.floor(durationMs / sampleIntervalMs) - 1)
    if (insertedCount === 0) continue

    for (let step = 1; step <= insertedCount; step++) {
      const t = step / (insertedCount + 1)
      const notionalPoint: TrackPoint = {
        lat: lerp(current.lat, next.lat, t),
        lon: lerpLon(current.lon, next.lon, t),
        time: Math.round(lerp(current.time, next.time, t)),
        provenance: { qualityFlags: ['notional'] },
        ext: {
          notional: true,
          notional_method: 'linear_time',
          derived_from_gap_start: current.time,
          derived_from_gap_end: next.time,
        },
      }
      if (current.ele !== undefined && next.ele !== undefined) notionalPoint.ele = lerp(current.ele, next.ele, t)
      out.push(notionalPoint)
    }

    gaps.push({ beforeIndex: i, afterIndex: i + 1, durationMs, insertedCount, sampleIntervalMs })
  }

  return { points: out, gaps, insertedCount: gaps.reduce((sum, gap) => sum + gap.insertedCount, 0) }
}

/** Wraps deriveNotionalSmoothedTrack into a new, separately-named Dataset — the source dataset is never mutated. */
export function deriveNotionalSmoothedDataset(dataset: Dataset, options: Partial<NotionalSmoothingOptions> = {}): { dataset: Dataset; result: NotionalSmoothingResult } {
  const result = deriveNotionalSmoothedTrack(dataset.points, options)
  const derived = withPoints(dataset, result.points)
  return {
    dataset: { ...derived, id: `${dataset.id}_notionalSmoothed`, name: `${dataset.name}_notionalSmoothed` },
    result,
  }
}

// Gap filling by monotone cubic interpolation, gated on plausibility.
//
// The interpolator is `fitMonotoneCubic` unchanged. It is already a cubic
// Hermite spline whose tangents come from adjacent secants, zeroed at local
// extrema and then limited by Fritsch–Carlson, so feeding it real points on
// either side of a gap yields tangents that match the trajectory going in and
// coming out, *and* a guarantee that the fill cannot overshoot past the
// neighbouring samples. A naive spline would ring past the true local extrema,
// which ARCHITECTURE.md §10 calls out as worse than the linear interpolation
// it replaces.
//
// The load-bearing rule is invariant 1, never fabricate data: a gap whose fill
// would require implausible motion is left alone and reported, not filled with
// a plausible-looking curve. Every point this operation inserts is marked
// `interpolated` in its provenance so nothing downstream mistakes it for a
// measurement.

import { clonePoint, type TrackPoint } from '../model'
import type { OperationDefinition, OperationExecutionResult } from '../recipes/model'
import { withPoints } from '../transforms'
import { MOTION_PROFILES, MOTION_PROFILE_IDS, type MotionProfileId } from './motionProfiles'
import { requireGreaterThan, requireInteger, requireOneOf, requireRecord, rejectUnknownKeys } from './params'
import { rejectScope } from './scope'
import { angularChannelsOf, collectRealNeighbors, firstProfileViolation, fitChannelsAtTimes, reconstructionKnots, type TimedPoint } from './trackReconstruction'

const MAX_INSERTED_POINTS = 1_000_000

export interface FillGapsParams {
  /** A sample interval longer than this counts as a gap worth filling. */
  gapThresholdMs: number
  /** Spacing of the points inserted into a gap. */
  sampleIntervalMs: number
  /** Real points on each side of a gap used as spline knots. */
  contextPoints: number
  profile: MotionProfileId
}

export const fillGapsOperation: OperationDefinition<FillGapsParams> = {
  id: 'fill-gaps',
  version: 1,
  label: 'Fill gaps',
  description: 'Insert interpolated points across dropouts using Fritsch–Carlson monotone cubic interpolation, skipping any gap whose fill would imply motion outside the selected profile.',
  validateParams: validateFillGapsParams,
  execute: ({ dataset, params, scope }) => {
    rejectScope(scope, 'Fill gaps')
    const points = requireStrictlyTimedPoints(dataset.points)
    const profile = MOTION_PROFILES[params.profile]

    const gaps: number[] = []
    for (let index = 0; index < points.length - 1; index++) {
      if (points[index + 1]!.time - points[index]!.time > params.gapThresholdMs) gaps.push(index)
    }
    const gapIndices = new Set(gaps)
    if (gaps.length === 0) {
      return {
        dataset,
        summary: `No sample interval exceeded ${params.gapThresholdMs} ms; nothing to fill`,
      }
    }

    const estimated = gaps.reduce((total, index) => {
      const span = points[index + 1]!.time - points[index]!.time
      return total + Math.max(0, Math.ceil(span / params.sampleIntervalMs) - 1)
    }, 0)
    if (estimated > MAX_INSERTED_POINTS) {
      throw new Error(`Filling these gaps would insert about ${estimated.toLocaleString()} points, over the ${MAX_INSERTED_POINTS.toLocaleString()} limit. Raise the sample interval or the gap threshold.`)
    }

    const angularChannels = angularChannelsOf(points, dataset.metadata?.channels)

    const output: TrackPoint[] = []
    const warnings: string[] = []
    let filledGaps = 0
    let insertedPoints = 0

    for (let index = 0; index < points.length; index++) {
      output.push(clonePoint(points[index]!))
      if (!gapIndices.has(index)) continue

      const left = points[index]!
      const right = points[index + 1]!
      const knots = reconstructionKnots(contextWindow(points, index, params.contextPoints, left, right), left, right, profile)
      const candidates = interpolateGap(knots, left, right, params.sampleIntervalMs, angularChannels)
      if (candidates.length === 0) continue

      const violation = firstProfileViolation([left, ...candidates, right], profile)
      if (violation) {
        // Invariant 1: a gap that cannot be filled honestly is reported, not
        // filled with something that merely looks reasonable.
        warnings.push(`Skipped the ${formatSeconds(right.time - left.time)} gap at index ${index}: ${violation}`)
        continue
      }

      output.push(...candidates)
      filledGaps++
      insertedPoints += candidates.length
    }

    const skipped = gaps.length - filledGaps
    const summary = insertedPoints === 0
      ? `Filled no gaps; all ${gaps.length} exceeded the ${profile.label.toLowerCase()} profile`
      : `Filled ${filledGaps} of ${gaps.length} gap(s) with ${insertedPoints.toLocaleString()} interpolated point(s) at ${params.sampleIntervalMs} ms (${profile.label} profile)${skipped > 0 ? `; skipped ${skipped} as implausible` : ''}`

    return { dataset: withPoints(dataset, output), summary, warnings } satisfies OperationExecutionResult
  },
}

/**
 * Real points either side of the gap, used as spline knots: the gap's own
 * two endpoints (`left`/`right`, always included — a prior fill-gaps run can
 * leave one of them synthetic, but it is still the real boundary of *this*
 * gap and stays the anchor `firstProfileViolation` checks the join against)
 * plus up to `contextPoints - 1` further real points walking outward from
 * each, skipping anything already synthesized so this fit is never built on
 * top of another fit's own small error.
 *
 * Using neighbours rather than only the two gap endpoints is what gives the
 * fill a trajectory-matching tangent: with two knots `fitMonotoneCubic`
 * degenerates to the straight secant between them.
 */
function contextWindow(points: readonly TimedPoint[], gapIndex: number, contextPoints: number, left: TimedPoint, right: TimedPoint): TimedPoint[] {
  const backward = collectRealNeighbors(points, gapIndex - 1, -1, contextPoints - 1)
  const forward = collectRealNeighbors(points, gapIndex + 2, 1, contextPoints - 1)
  return [...backward, left, right, ...forward]
}

function interpolateGap(
  knots: readonly TimedPoint[],
  left: TimedPoint,
  right: TimedPoint,
  sampleIntervalMs: number,
  angularChannels: ReadonlySet<string>,
): TrackPoint[] {
  const queryTimes: number[] = []
  for (let time = left.time + sampleIntervalMs; time < right.time; time += sampleIntervalMs) queryTimes.push(time)
  if (queryTimes.length === 0) return []
  return fitChannelsAtTimes(knots, queryTimes, angularChannels)
}

/**
 * Gap filling is parameterised by time, so every point needs one and the
 * series must be strictly increasing for `fitMonotoneCubic` to accept it.
 * Both failures name the operation that fixes them rather than just refusing.
 */
function requireStrictlyTimedPoints(points: readonly TrackPoint[]): TimedPoint[] {
  if (points.length < 2) throw new Error('Fill gaps requires at least two points')
  const timed: TimedPoint[] = []
  for (const point of points) {
    if (point.time === undefined) {
      throw new Error('Fill gaps requires every point to carry a timestamp. Drop the untimed points first, or clip to a timed window.')
    }
    timed.push(point as TimedPoint)
  }
  for (let index = 1; index < timed.length; index++) {
    if (timed[index]!.time <= timed[index - 1]!.time) {
      throw new Error(`Fill gaps requires strictly increasing timestamps; index ${index} is not after index ${index - 1}. Sort by time and de-jitter first.`)
    }
  }
  return timed
}

function formatSeconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`
}

function validateFillGapsParams(value: unknown): FillGapsParams {
  const record = requireRecord(value, 'Fill gaps')
  rejectUnknownKeys(record, 'Fill gaps', ['gapThresholdMs', 'sampleIntervalMs', 'contextPoints', 'profile'])
  const gapThresholdMs = requireGreaterThan(record.gapThresholdMs, 'gapThresholdMs', 0)
  const sampleIntervalMs = requireGreaterThan(record.sampleIntervalMs, 'sampleIntervalMs', 0)
  if (sampleIntervalMs > gapThresholdMs) {
    throw new Error('sampleIntervalMs must not exceed gapThresholdMs, or a gap would be detected but produce no samples')
  }
  return {
    gapThresholdMs,
    sampleIntervalMs,
    // Two knots reduce the spline to a straight secant, which defeats the
    // point of using a Hermite fit at all.
    contextPoints: requireInteger(record.contextPoints, 'contextPoints', 2),
    profile: requireOneOf(record.profile, 'profile', MOTION_PROFILE_IDS),
  }
}

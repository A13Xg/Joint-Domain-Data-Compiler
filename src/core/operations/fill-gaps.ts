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

import { clonePoint, collectChannels, haversineMeters, type TrackPoint } from '../model'
import type { OperationDefinition, OperationExecutionResult } from '../recipes/model'
import { withPoints } from '../transforms'
import { initialBearingDegrees, isAngularChannel, shortestAngleDelta, unwrapDegrees, unwrapLongitudes, wrapDegrees, wrapLongitude } from './angular'
import { evaluateMonotoneCubic, fitMonotoneCubic } from './monotone-interpolation'
import { MOTION_PROFILES, MOTION_PROFILE_IDS, type MotionProfile, type MotionProfileId } from './motionProfiles'
import { requireGreaterThan, requireInteger, requireOneOf, requireRecord, rejectUnknownKeys } from './params'
import { rejectScope } from './scope'

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

interface TimedPoint extends TrackPoint { time: number }

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

    const angularChannels = new Set(
      collectChannels(points).filter((channel) => isAngularChannel(channel, dataset.metadata?.channels)),
    )

    const output: TrackPoint[] = []
    const warnings: string[] = []
    let filledGaps = 0
    let insertedPoints = 0

    for (let index = 0; index < points.length; index++) {
      output.push(clonePoint(points[index]!))
      if (!gapIndices.has(index)) continue

      const left = points[index]!
      const right = points[index + 1]!
      const knots = contextWindow(points, index, params.contextPoints)
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
 * Real points either side of the gap, used as spline knots.
 *
 * Using neighbours rather than only the two gap endpoints is what gives the
 * fill a trajectory-matching tangent: with two knots `fitMonotoneCubic`
 * degenerates to the straight secant between them.
 */
function contextWindow(points: readonly TimedPoint[], gapIndex: number, contextPoints: number): TimedPoint[] {
  const start = Math.max(0, gapIndex - contextPoints + 1)
  const end = Math.min(points.length, gapIndex + 1 + contextPoints)
  return points.slice(start, end)
}

function interpolateGap(
  knots: readonly TimedPoint[],
  left: TimedPoint,
  right: TimedPoint,
  sampleIntervalMs: number,
  angularChannels: ReadonlySet<string>,
): TrackPoint[] {
  const times = knots.map((point) => point.time)
  const queryTimes: number[] = []
  for (let time = left.time + sampleIntervalMs; time < right.time; time += sampleIntervalMs) queryTimes.push(time)
  if (queryTimes.length === 0) return []

  const latSpline = fitMonotoneCubic(times, knots.map((point) => point.lat))
  const lonSpline = fitMonotoneCubic(times, unwrapLongitudes(knots.map((point) => point.lon)))
  // Elevation is only interpolated when every knot carries one. A gap bounded
  // by a point with no elevation has nothing to interpolate between, and
  // inventing one would be fabrication.
  const eleSpline = knots.every((point) => point.ele !== undefined)
    ? fitMonotoneCubic(times, knots.map((point) => point.ele!))
    : null

  // Same rule for channels: interpolate only those numeric on every knot.
  // Non-numeric channels are left off the inserted points rather than carried
  // from a neighbour, which would assert a reading that was never taken.
  const numericChannels = collectChannels(knots).filter((channel) => knots.every((point) => typeof point.ext?.[channel] === 'number'))
  const channelSplines = new Map(numericChannels.map((channel) => {
    const values = knots.map((point) => point.ext![channel] as number)
    return [channel, fitMonotoneCubic(times, angularChannels.has(channel) ? unwrapDegrees(values) : values)]
  }))

  return queryTimes.map((time) => {
    const ext: Record<string, number | string | boolean> = {}
    for (const [channel, spline] of channelSplines) {
      const value = evaluateMonotoneCubic(spline, time)
      ext[channel] = angularChannels.has(channel) ? wrapDegrees(value) : value
    }
    return {
      lat: evaluateMonotoneCubic(latSpline, time),
      lon: wrapLongitude(evaluateMonotoneCubic(lonSpline, time)),
      ele: eleSpline ? evaluateMonotoneCubic(eleSpline, time) : undefined,
      time,
      ext: numericChannels.length > 0 ? ext : undefined,
      provenance: { qualityFlags: ['interpolated'] },
    }
  })
}

/**
 * Describes the first profile limit the sequence breaks, or null if it holds.
 *
 * The two real endpoints are included so the joins into and out of the fill
 * are checked, not just the synthetic interior — a fill can be internally
 * smooth and still require an impossible jump to meet the real track.
 */
function firstProfileViolation(sequence: readonly TrackPoint[], profile: MotionProfile): string | null {
  let previousSpeed: number | undefined
  let previousBearing: number | undefined

  for (let index = 1; index < sequence.length; index++) {
    const from = sequence[index - 1]!
    const to = sequence[index]!
    const dt = (to.time! - from.time!) / 1000
    if (dt <= 0) continue

    const distance = haversineMeters(from.lat, from.lon, to.lat, to.lon)
    const speed = distance / dt
    if (speed > profile.maxGroundSpeedMps) {
      return `implied ground speed ${speed.toFixed(1)} m/s exceeds the profile limit of ${profile.maxGroundSpeedMps} m/s`
    }

    if (from.ele !== undefined && to.ele !== undefined) {
      const verticalSpeed = Math.abs(to.ele - from.ele) / dt
      if (verticalSpeed > profile.maxVerticalSpeedMps) {
        return `implied vertical speed ${verticalSpeed.toFixed(1)} m/s exceeds the profile limit of ${profile.maxVerticalSpeedMps} m/s`
      }
    }

    if (previousSpeed !== undefined) {
      const accel = Math.abs(speed - previousSpeed) / dt
      if (accel > profile.maxHorizontalAccelMps2) {
        return `implied acceleration ${accel.toFixed(1)} m/s² exceeds the profile limit of ${profile.maxHorizontalAccelMps2} m/s²`
      }
    }
    previousSpeed = speed

    // A bearing between two coincident points is meaningless, so a stationary
    // segment contributes no turn rate rather than a spurious one.
    if (distance === 0) { previousBearing = undefined; continue }
    const heading = initialBearingDegrees(from.lat, from.lon, to.lat, to.lon)
    if (previousBearing !== undefined) {
      const turnRate = Math.abs(shortestAngleDelta(previousBearing, heading)) / dt
      if (turnRate > profile.maxTurnRateDps) {
        return `implied turn rate ${turnRate.toFixed(1)}°/s exceeds the profile limit of ${profile.maxTurnRateDps}°/s`
      }
    }
    previousBearing = heading
  }

  return null
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

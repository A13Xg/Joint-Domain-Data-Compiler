// Shared plausibility-gated reconstruction engine.
//
// `fill-gaps` and `drop-outliers` both need the same thing: fit real
// neighbouring points through a curve (or, for the vector-only profile, a
// straight secant) and refuse to emit anything that implies motion outside
// the selected MotionProfile. They differ only in *where* they evaluate that
// fit — fill-gaps samples a fixed grid across a time-gap, drop-outliers
// samples the original timestamps of the points it is replacing — so that
// difference stays in each operation and this module holds the one engine
// both call. A track repaired either way is held to the same physical
// honesty, and a fix to the interpolation math only has one place to land.

import { collectChannels, haversineMeters, type ChannelDefinition, type TrackPoint } from '../model'
import { isSynthesized } from '../quality/outliers'
import { initialBearingDegrees, isAngularChannel, shortestAngleDelta, unwrapDegrees, unwrapLongitudes, wrapDegrees, wrapLongitude } from './angular'
import { evaluateMonotoneCubic, fitMonotoneCubic } from './monotone-interpolation'
import type { MotionProfile } from './motionProfiles'

export interface TimedPoint extends TrackPoint { time: number }

/**
 * Up to `count` real (non-synthesized) points walking outward from `start`
 * in `step` order, returned chronologically.
 *
 * Walking past a synthetic point rather than stopping at the nearest one
 * keeps every fit anchored in genuinely measured data. Without this, a fit
 * built through an already-interpolated knot inherits that knot's own small
 * fit error, and a repeated Apply "walks" the same handful of metres of
 * residual one point further out each time instead of ever converging.
 */
export function collectRealNeighbors(points: readonly TimedPoint[], start: number, step: -1 | 1, count: number): TimedPoint[] {
  const collected: TimedPoint[] = []
  for (let index = start; index >= 0 && index < points.length && collected.length < count; index += step) {
    const point = points[index]!
    if (!isSynthesized(point)) collected.push(point)
  }
  if (step === -1) collected.reverse()
  return collected
}

/**
 * Real points used as fit knots, narrowed to just the two endpoints for a
 * `'linear'` profile. `fitMonotoneCubic` degenerates to the straight secant
 * between two knots, so narrowing the knot list is all "vector-only" needs.
 */
export function reconstructionKnots(
  contextKnots: readonly TimedPoint[],
  left: TimedPoint,
  right: TimedPoint,
  profile: MotionProfile,
): readonly TimedPoint[] {
  return profile.interpolation === 'linear' ? [left, right] : contextKnots
}

/**
 * Fits every numeric channel through `knots` and evaluates each at
 * `queryTimes`. A channel is only fit when every knot carries it — a channel
 * missing from one knot has nothing honest to interpolate between, so it is
 * left off the result rather than carried from a neighbour.
 */
export function fitChannelsAtTimes(
  knots: readonly TimedPoint[],
  queryTimes: readonly number[],
  angularChannels: ReadonlySet<string>,
): TrackPoint[] {
  const times = knots.map((point) => point.time)
  const latSpline = fitMonotoneCubic(times, knots.map((point) => point.lat))
  const lonSpline = fitMonotoneCubic(times, unwrapLongitudes(knots.map((point) => point.lon)))
  const eleSpline = knots.every((point) => point.ele !== undefined)
    ? fitMonotoneCubic(times, knots.map((point) => point.ele!))
    : null

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

/** The set of `ext` channels reconstruction should treat as angular (wrap/unwrap around 360°). */
export function angularChannelsOf(points: readonly TrackPoint[], declared: readonly ChannelDefinition[] | undefined): Set<string> {
  return new Set(collectChannels(points).filter((channel) => isAngularChannel(channel, declared)))
}

/**
 * Describes the first profile limit the sequence breaks, or null if it holds.
 *
 * Real endpoints belong in `sequence` alongside the candidates so the joins
 * into and out of the fill are checked, not just the synthetic interior — a
 * fill can be internally smooth and still require an impossible jump to meet
 * the real track.
 */
export function firstProfileViolation(sequence: readonly TrackPoint[], profile: MotionProfile): string | null {
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

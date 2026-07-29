import { geodeticToEnu } from '../geodesy'
import { lerp, lerpLon } from '../geoInterpolation'
import type { TrackPoint } from '../model'

export interface AlignedPointPair {
  referenceIndex: number
  targetIndex: number
  referenceTimeMs: number
  targetTimeMs: number
  deltaTimeMs: number
}

export interface RelativePointSample extends AlignedPointPair {
  relativeEastM: number
  relativeNorthM: number
  relativeUpM: number
  horizontalRangeM: number
  slantRangeM: number
  bearingDeg: number
  altitudeSeparationM?: number
  closureRateMps?: number
  /** True when the target position was linearly interpolated (Task 5.3 step 2) rather than an observed target sample — always surfaced so a derived value is never mistaken for a real one. */
  derived?: boolean
}

export interface AlignmentOptions {
  targetTimeOffsetMs?: number
  toleranceMs: number
}

export function alignTracksByNearestTime(
  reference: readonly TrackPoint[],
  target: readonly TrackPoint[],
  options: AlignmentOptions,
): AlignedPointPair[] {
  if (!Number.isFinite(options.toleranceMs) || options.toleranceMs < 0) {
    throw new Error('Alignment tolerance must be a non-negative finite number')
  }
  const offset = options.targetTimeOffsetMs ?? 0
  if (!Number.isFinite(offset)) throw new Error('Target time offset must be finite')

  const targetTimed = target
    .map((point, index) => point.time === undefined ? null : { index, time: point.time + offset })
    .filter((entry): entry is { index: number; time: number } => entry !== null)
    .sort((a, b) => a.time - b.time)

  const pairs: AlignedPointPair[] = []
  for (let referenceIndex = 0; referenceIndex < reference.length; referenceIndex++) {
    const referenceTime = reference[referenceIndex]?.time
    if (referenceTime === undefined || targetTimed.length === 0) continue
    const nearest = nearestTimedEntry(targetTimed, referenceTime)
    if (!nearest) continue
    const delta = nearest.time - referenceTime
    if (Math.abs(delta) > options.toleranceMs) continue
    const targetTime = target[nearest.index]?.time
    if (targetTime === undefined) continue
    pairs.push({
      referenceIndex,
      targetIndex: nearest.index,
      referenceTimeMs: referenceTime,
      targetTimeMs: targetTime,
      deltaTimeMs: delta,
    })
  }
  return pairs
}

export function deriveRelativePosition(
  reference: readonly TrackPoint[],
  target: readonly TrackPoint[],
  pairs: readonly AlignedPointPair[],
): RelativePointSample[] {
  const samples: RelativePointSample[] = []
  let previousRange: number | undefined
  let previousTime: number | undefined

  for (const pair of pairs) {
    const referencePoint = reference[pair.referenceIndex]
    const targetPoint = target[pair.targetIndex]
    if (!referencePoint || !targetPoint) continue

    const relative = geodeticToEnu(
      { latDeg: targetPoint.lat, lonDeg: targetPoint.lon, heightM: targetPoint.ele ?? 0 },
      { latDeg: referencePoint.lat, lonDeg: referencePoint.lon, heightM: referencePoint.ele ?? 0 },
    )
    const horizontalRangeM = Math.hypot(relative.eastM, relative.northM)
    const slantRangeM = Math.hypot(horizontalRangeM, relative.upM)
    const bearingDeg = (Math.atan2(relative.eastM, relative.northM) * 180 / Math.PI + 360) % 360
    const sample: RelativePointSample = {
      ...pair,
      relativeEastM: relative.eastM,
      relativeNorthM: relative.northM,
      relativeUpM: relative.upM,
      horizontalRangeM,
      slantRangeM,
      bearingDeg,
      altitudeSeparationM:
        referencePoint.ele !== undefined && targetPoint.ele !== undefined
          ? targetPoint.ele - referencePoint.ele
          : undefined,
    }

    if (previousRange !== undefined && previousTime !== undefined) {
      const dt = (pair.referenceTimeMs - previousTime) / 1000
      if (dt > 0) sample.closureRateMps = (previousRange - slantRangeM) / dt
    }

    previousRange = slantRangeM
    previousTime = pair.referenceTimeMs
    samples.push(sample)
  }

  return samples
}

export interface InterpolatedAlignedPair {
  referenceIndex: number
  referenceTimeMs: number
  /** By construction equal to referenceTimeMs — the target position is interpolated to exactly this instant. */
  targetTimeMs: number
  targetBeforeIndex: number
  targetAfterIndex: number
  /** 0..1 position of referenceTimeMs between the bracketing target samples. */
  interpolationFraction: number
}

export interface InterpolationAlignmentOptions {
  targetTimeOffsetMs?: number
  /** Refuse to interpolate across a target gap wider than this — never extrapolate or bridge a large hole in the target track. */
  maxBracketGapMs: number
}

/**
 * Aligns reference points to an interpolated target position at exactly the
 * reference time, rather than snapping to the nearest observed target
 * sample (Task 5.3 step 2). Only interpolates strictly between two real
 * target samples — a reference time before the first or after the last
 * target sample is never extrapolated.
 */
export function alignTracksByInterpolation(
  reference: readonly TrackPoint[],
  target: readonly TrackPoint[],
  options: InterpolationAlignmentOptions,
): InterpolatedAlignedPair[] {
  if (!Number.isFinite(options.maxBracketGapMs) || options.maxBracketGapMs <= 0) {
    throw new Error('maxBracketGapMs must be a positive finite number')
  }
  const offset = options.targetTimeOffsetMs ?? 0
  if (!Number.isFinite(offset)) throw new Error('Target time offset must be finite')

  const targetTimed = target
    .map((point, index) => point.time === undefined ? null : { index, time: point.time + offset })
    .filter((entry): entry is { index: number; time: number } => entry !== null)
    .sort((a, b) => a.time - b.time)

  const pairs: InterpolatedAlignedPair[] = []
  for (let referenceIndex = 0; referenceIndex < reference.length; referenceIndex++) {
    const referenceTime = reference[referenceIndex]?.time
    if (referenceTime === undefined) continue
    const bracket = findBracket(targetTimed, referenceTime)
    if (!bracket) continue
    const gap = bracket.after.time - bracket.before.time
    if (gap > options.maxBracketGapMs) continue
    const fraction = gap === 0 ? 0 : (referenceTime - bracket.before.time) / gap
    pairs.push({
      referenceIndex,
      referenceTimeMs: referenceTime,
      targetTimeMs: referenceTime,
      targetBeforeIndex: bracket.before.index,
      targetAfterIndex: bracket.after.index,
      interpolationFraction: fraction,
    })
  }
  return pairs
}

/** Companion to deriveRelativePosition, for interpolated pairs. Every sample is marked `derived: true`. */
export function deriveInterpolatedRelativePosition(
  reference: readonly TrackPoint[],
  target: readonly TrackPoint[],
  pairs: readonly InterpolatedAlignedPair[],
): RelativePointSample[] {
  const samples: RelativePointSample[] = []
  let previousRange: number | undefined
  let previousTime: number | undefined

  for (const pair of pairs) {
    const referencePoint = reference[pair.referenceIndex]
    const before = target[pair.targetBeforeIndex]
    const after = target[pair.targetAfterIndex]
    if (!referencePoint || !before || !after) continue

    const targetLat = lerp(before.lat, after.lat, pair.interpolationFraction)
    const targetLon = lerpLon(before.lon, after.lon, pair.interpolationFraction)
    const targetEle = before.ele !== undefined && after.ele !== undefined
      ? lerp(before.ele, after.ele, pair.interpolationFraction)
      : undefined

    const relative = geodeticToEnu(
      { latDeg: targetLat, lonDeg: targetLon, heightM: targetEle ?? 0 },
      { latDeg: referencePoint.lat, lonDeg: referencePoint.lon, heightM: referencePoint.ele ?? 0 },
    )
    const horizontalRangeM = Math.hypot(relative.eastM, relative.northM)
    const slantRangeM = Math.hypot(horizontalRangeM, relative.upM)
    const bearingDeg = (Math.atan2(relative.eastM, relative.northM) * 180 / Math.PI + 360) % 360

    const sample: RelativePointSample = {
      referenceIndex: pair.referenceIndex,
      targetIndex: pair.targetBeforeIndex,
      referenceTimeMs: pair.referenceTimeMs,
      targetTimeMs: pair.targetTimeMs,
      deltaTimeMs: 0,
      relativeEastM: relative.eastM,
      relativeNorthM: relative.northM,
      relativeUpM: relative.upM,
      horizontalRangeM,
      slantRangeM,
      bearingDeg,
      altitudeSeparationM: targetEle !== undefined && referencePoint.ele !== undefined ? targetEle - referencePoint.ele : undefined,
      derived: true,
    }

    if (previousRange !== undefined && previousTime !== undefined) {
      const dt = (pair.referenceTimeMs - previousTime) / 1000
      if (dt > 0) sample.closureRateMps = (previousRange - slantRangeM) / dt
    }
    previousRange = slantRangeM
    previousTime = pair.referenceTimeMs
    samples.push(sample)
  }

  return samples
}

export interface AlongCrossTrackSample {
  referenceIndex: number
  targetIndex: number
  /** Signed distance along the local reference-path tangent (positive = ahead in the direction of travel). */
  alongTrackM: number
  /** Signed perpendicular distance from the reference path (positive = left of the direction of travel). */
  crossTrackM: number
}

/**
 * Decomposes each relative-position sample's horizontal ENU offset into an
 * along-track / cross-track pair, using the local tangent of the reference
 * path at that sample's reference index (Task 4.3). This is a local
 * decomposition — alongTrackM is the signed offset from the reference point
 * along its path tangent, not cumulative distance travelled along the path.
 *
 * Samples whose reference index has no determinable path tangent (a
 * single-point reference track, or coincident neighbouring points) are
 * silently skipped — never approximated.
 */
export function computeAlongCrossTrack(
  reference: readonly TrackPoint[],
  samples: readonly RelativePointSample[],
): AlongCrossTrackSample[] {
  const results: AlongCrossTrackSample[] = []
  for (const sample of samples) {
    const tangent = pathTangent(reference, sample.referenceIndex)
    if (!tangent) continue
    const alongTrackM = tangent.eastM * sample.relativeEastM + tangent.northM * sample.relativeNorthM
    const crossTrackM = tangent.eastM * sample.relativeNorthM - tangent.northM * sample.relativeEastM
    results.push({
      referenceIndex: sample.referenceIndex,
      targetIndex: sample.targetIndex,
      alongTrackM,
      crossTrackM,
    })
  }
  return results
}

/** Returns the unit tangent (east, north) of the reference path at `index`, or null when it cannot be determined. */
function pathTangent(
  reference: readonly TrackPoint[],
  index: number,
): { eastM: number; northM: number } | null {
  const anchor = reference[index]
  if (!anchor) return null
  const forward = reference[index + 1]
  const backward = reference[index - 1]
  const neighbour = forward ?? backward
  if (!neighbour) return null

  const relative = geodeticToEnu(
    { latDeg: neighbour.lat, lonDeg: neighbour.lon, heightM: neighbour.ele ?? 0 },
    { latDeg: anchor.lat, lonDeg: anchor.lon, heightM: anchor.ele ?? 0 },
  )
  // If we stepped backward, the ENU vector points behind the direction of travel — flip it.
  const eastM = forward ? relative.eastM : -relative.eastM
  const northM = forward ? relative.northM : -relative.northM
  const magnitude = Math.hypot(eastM, northM)
  if (!Number.isFinite(magnitude) || magnitude < 1e-9) return null
  return { eastM: eastM / magnitude, northM: northM / magnitude }
}

export interface ClockDriftEstimate {
  /** Estimated target-minus-reference clock offset, in ms, evaluated at referenceEpochMs. */
  offsetMs: number
  /** Estimated drift rate: change in the offset per ms of reference time elapsed since referenceEpochMs (dimensionless, e.g. 1e-4 == 100 ppm). */
  driftRatePerMs: number
  /** The reference timestamp (ms) at which offsetMs applies — driftRatePerMs extrapolates away from this epoch. */
  referenceEpochMs: number
  sampleCount: number
}

/**
 * Estimates a linear clock-offset/drift model between two tracks' raw
 * timestamps via ordinary least squares (Task 4.3), rather than relying on
 * a manually supplied constant offset. Fits
 *   (targetTimeMs - referenceTimeMs) ≈ offsetMs + driftRatePerMs * (referenceTimeMs - referenceEpochMs)
 * over the supplied aligned pairs. Pure and deterministic: the same pairs
 * always produce the same estimate, and the input is never mutated.
 */
export function estimateClockDrift(
  pairs: readonly { referenceTimeMs: number; targetTimeMs: number }[],
): ClockDriftEstimate {
  if (pairs.length === 0) throw new Error('At least one aligned pair is required to estimate clock drift')

  const referenceEpochMs = pairs[0]!.referenceTimeMs
  const dxs: number[] = []
  const ys: number[] = []
  for (const pair of pairs) {
    if (!Number.isFinite(pair.referenceTimeMs) || !Number.isFinite(pair.targetTimeMs)) {
      throw new Error('Clock drift estimation requires finite timestamps')
    }
    dxs.push(pair.referenceTimeMs - referenceEpochMs)
    ys.push(pair.targetTimeMs - pair.referenceTimeMs)
  }

  const meanDx = mean(dxs)
  const meanY = mean(ys)
  let numerator = 0
  let denominator = 0
  for (let i = 0; i < dxs.length; i++) {
    const dx = dxs[i]! - meanDx
    numerator += dx * (ys[i]! - meanY)
    denominator += dx * dx
  }
  const driftRatePerMs = denominator > 1e-9 ? numerator / denominator : 0
  const offsetMs = meanY - driftRatePerMs * meanDx

  return { offsetMs, driftRatePerMs, referenceEpochMs, sampleCount: pairs.length }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function findBracket(
  entries: readonly { index: number; time: number }[],
  time: number,
): { before: { index: number; time: number }; after: { index: number; time: number } } | null {
  if (entries.length === 0) return null
  let low = 0
  let high = entries.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (entries[middle]!.time < time) low = middle + 1
    else high = middle
  }
  if (low === 0) return entries[0]!.time === time ? { before: entries[0]!, after: entries[0]! } : null
  if (low === entries.length) {
    const last = entries[low - 1]!
    return last.time === time ? { before: last, after: last } : null
  }
  const after = entries[low]!
  const before = entries[low - 1]!
  return { before, after }
}

function nearestTimedEntry(
  entries: readonly { index: number; time: number }[],
  time: number,
): { index: number; time: number } | null {
  let low = 0
  let high = entries.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const entry = entries[middle]
    if (entry && entry.time < time) low = middle + 1
    else high = middle
  }

  const after = entries[low]
  const before = low > 0 ? entries[low - 1] : undefined
  if (!before) return after ?? null
  if (!after) return before
  return Math.abs(before.time - time) <= Math.abs(after.time - time) ? before : after
}

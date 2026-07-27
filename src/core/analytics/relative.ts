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

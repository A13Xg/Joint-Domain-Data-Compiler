import { geodeticToEnu } from '../geodesy'
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

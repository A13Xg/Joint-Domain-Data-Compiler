// Multi-channel outlier detection and repair.
//
// This shares `detectOutliers` with the Track Health scan, so what the scan
// reports and what this acts on cannot drift apart. By default a flagged
// point is not simply deleted: it is refit from its surviving neighbours at
// its own original timestamp through the same plausibility-gated engine
// `fill-gaps` uses (see `trackReconstruction.ts`), so point count and
// cadence are unchanged and a repaired track never needs a second pass to
// bridge the holes the first one left. Set `reconstruct: false` to fall back
// to plain removal.
//
// Detection itself gets one enrichment over a flat, static floor: a legitimate
// sustained turn at the selected profile's max turn rate produces a large but
// nearly-constant position residual across the whole turn, which a MAD-based
// scale cannot distinguish from noise (its local scatter reads as near zero
// either way) — every point in a real turn would otherwise score as an
// outlier. `estimateTurnPositionFloorMeters` widens the floor to cover that,
// using the track's own fastest observed speed and sample cadence.

import { clonePoint, type Dataset, type TrackPoint } from '../model'
import { derivePointSpeeds } from '../quality/movementWindow'
import { ALL_OUTLIER_CHANNELS, detectOutliers, estimateTurnPositionFloorMeters, type OutlierChannel, type OutlierConfig } from '../quality/outliers'
import type { OperationDefinition, OperationExecutionResult } from '../recipes/model'
import { withPoints } from '../transforms'
import { MOTION_PROFILES, MOTION_PROFILE_IDS, type MotionProfile, type MotionProfileId } from './motionProfiles'
import { requireBoolean, requireGreaterThan, requireInteger, requireOneOf, requireRecord, rejectUnknownKeys } from './params'
import { angularChannelsOf, collectRealNeighbors, firstProfileViolation, fitChannelsAtTimes, reconstructionKnots, type TimedPoint } from './trackReconstruction'

export interface DropOutliersParams extends OutlierConfig {
  channels: OutlierChannel[]
  /** Widens the position floor for legitimate turns, and — when reconstructing — gates the replacement fit. */
  profile: MotionProfileId
  /**
   * When true, a flagged point is refit from its surviving neighbours at its
   * own timestamp instead of being deleted. A run whose fit would fall
   * outside the profile, or that has no surviving neighbour on one side, is
   * left exactly as it was and reported rather than silently dropped or
   * left as a gap.
   */
  reconstruct: boolean
  /** Real, surviving points on each side of a flagged run used as fit knots. Unused when reconstruct is false. */
  contextPoints: number
}

export const dropOutliersOperation: OperationDefinition<DropOutliersParams> = {
  id: 'drop-outliers',
  version: 2,
  label: 'Drop outliers',
  description: 'Find points that break their local trend in position, elevation, or ground speed, scored by a robust (MAD-based) z-score against their neighbours. By default the flagged points are reconstructed in place from their surviving neighbours — same engine as Fill gaps, gated on the selected profile — so point count and cadence are unchanged; turn reconstruction off to just remove them.',
  validateParams: validateDropOutliersParams,
  execute: ({ dataset, params, scope }) => {
    if (scope?.timeRange) throw new Error('Drop outliers does not support time-range scope')
    const points = dataset.points
    const profile = MOTION_PROFILES[params.profile]
    // The channel selection is pushed into the detector rather than applied to
    // its output: `channelByIndex` names only the highest-scoring channel, so
    // filtering on it afterwards would spare a point that broke a selected
    // channel's threshold merely because an unselected one scored higher.
    const detection = detectOutliers(points, widenFloorsForTurning(points, profile, params))

    // Detection always runs over the whole track: a point's score is defined
    // by its neighbours, and a window truncated at a selection boundary would
    // score the same point differently depending on where the user dragged.
    // The scope narrows only which flagged points are acted on.
    const range = scope?.indexRange
    const lower = range ? Math.min(range.start, range.end) : 0
    const upper = range ? Math.max(range.start, range.end) : points.length - 1

    const doomed = new Set<number>()
    const byChannel = new Map<OutlierChannel, number>()
    for (const index of detection.flaggedIndices) {
      if (index < lower || index > upper) continue
      doomed.add(index)
      const channel = detection.channelByIndex.get(index)
      if (channel) byChannel.set(channel, (byChannel.get(channel) ?? 0) + 1)
    }

    const where = range ? ` within range ${lower}–${upper}` : ''
    if (doomed.size === 0) {
      return { dataset, summary: `No outliers exceeded ${params.scoreThreshold}σ${where}` }
    }

    const breakdown = ALL_OUTLIER_CHANNELS
      .filter((channel) => byChannel.has(channel))
      .map((channel) => `${channel} ${byChannel.get(channel)}`)
      .join(', ')

    if (!params.reconstruct) {
      const kept: TrackPoint[] = []
      for (let index = 0; index < points.length; index++) {
        if (!doomed.has(index)) kept.push(clonePoint(points[index]!))
      }
      return {
        dataset: withPoints(dataset, kept),
        summary: `Dropped ${doomed.size} outlier point(s)${where} at >${params.scoreThreshold}σ (${breakdown})`,
      }
    }

    return reconstructInPlace(dataset, points, doomed, profile, params, breakdown, where)
  },
}

/**
 * Widens the position floor to cover a legitimate sustained turn at the
 * profile's max turn rate. A profile with no turn-rate ceiling
 * (`None (vector-only)`), or a track with no derivable speed or cadence,
 * leaves the configured floor untouched.
 */
function widenFloorsForTurning(points: readonly TrackPoint[], profile: MotionProfile, config: OutlierConfig): OutlierConfig {
  const sampleIntervalSeconds = medianSampleIntervalSeconds(points)
  if (sampleIntervalSeconds === null) return config
  const speeds = derivePointSpeeds(points).filter((value): value is number => value !== undefined && Number.isFinite(value) && value > 0)
  if (speeds.length === 0) return config
  const characteristicSpeedMps = Math.min(Math.max(...speeds), profile.maxGroundSpeedMps)
  const turnFloor = estimateTurnPositionFloorMeters(characteristicSpeedMps, profile.maxTurnRateDps, config.windowSize, sampleIntervalSeconds)
  return turnFloor > config.minPositionScaleMeters ? { ...config, minPositionScaleMeters: turnFloor } : config
}

function medianSampleIntervalSeconds(points: readonly TrackPoint[]): number | null {
  const deltas: number[] = []
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!.time
    const current = points[index]!.time
    if (previous === undefined || current === undefined) continue
    const dt = (current - previous) / 1000
    if (dt > 0) deltas.push(dt)
  }
  if (deltas.length === 0) return null
  deltas.sort((a, b) => a - b)
  const mid = deltas.length / 2
  return deltas.length % 2 === 0 ? (deltas[mid - 1]! + deltas[mid]!) / 2 : deltas[Math.floor(mid)]!
}

/**
 * Replaces each flagged point's position/elevation/channel values in place —
 * never its timestamp or identity fields — with a fit through the surviving
 * points around it, gated by `firstProfileViolation` exactly as `fill-gaps`
 * gates an inserted point. Consecutive flagged indices are repaired as one
 * run so a single fit spans them, rather than fitting each in isolation
 * against neighbours that are themselves flagged.
 */
function reconstructInPlace(
  dataset: Dataset,
  points: readonly TrackPoint[],
  doomed: ReadonlySet<number>,
  profile: MotionProfile,
  params: DropOutliersParams,
  breakdown: string,
  where: string,
): OperationExecutionResult {
  const timed = requireStrictlyTimedForReconstruction(points)
  const angularChannels = angularChannelsOf(points, dataset.metadata?.channels)
  const output: TimedPoint[] = timed.map((point) => clonePoint(point) as TimedPoint)

  const runs = contiguousRuns([...doomed].sort((a, b) => a - b))
  const warnings: string[] = []
  let reconstructed = 0
  let unresolved = 0

  for (const [runStart, runEnd] of runs) {
    const backward = collectRealNeighbors(timed, runStart - 1, -1, params.contextPoints)
    const forward = collectRealNeighbors(timed, runEnd + 1, 1, params.contextPoints)
    if (backward.length === 0 || forward.length === 0) {
      unresolved += runEnd - runStart + 1
      warnings.push(`Flagged run at index ${runStart}–${runEnd} sits at the edge of the track with no surviving neighbour on one side; left unchanged.`)
      continue
    }

    const left = backward[backward.length - 1]!
    const right = forward[0]!
    const knots = reconstructionKnots([...backward, ...forward], left, right, profile)
    const queryTimes = timed.slice(runStart, runEnd + 1).map((point) => point.time)
    const candidates = fitChannelsAtTimes(knots, queryTimes, angularChannels)
    const violation = firstProfileViolation([left, ...candidates, right], profile)
    if (violation) {
      unresolved += runEnd - runStart + 1
      warnings.push(`Flagged run at index ${runStart}–${runEnd} could not be reconstructed within the ${profile.label} profile: ${violation}; left unchanged.`)
      continue
    }

    for (let offset = 0; offset < candidates.length; offset++) {
      output[runStart + offset] = mergeReconstructed(output[runStart + offset]!, candidates[offset]!)
    }
    reconstructed += candidates.length
  }

  const parts: string[] = []
  if (reconstructed > 0) parts.push(`reconstructed ${reconstructed}`)
  if (unresolved > 0) parts.push(`left ${unresolved} unchanged (no plausible repair)`)
  const summary = `Flagged ${doomed.size} outlier point(s)${where} at >${params.scoreThreshold}σ (${breakdown}); ${parts.join(', ')}, at the ${profile.label} profile`

  return { dataset: withPoints(dataset, output), summary, warnings }
}

/** Keeps the original point's identity (name, timestamp, source lineage); only the fitted channels move. */
function mergeReconstructed(original: TimedPoint, candidate: TrackPoint): TimedPoint {
  const ext = original.ext || candidate.ext ? { ...original.ext, ...candidate.ext } : undefined
  return {
    ...original,
    lat: candidate.lat,
    lon: candidate.lon,
    ele: candidate.ele,
    ext,
    provenance: { ...original.provenance, qualityFlags: ['interpolated'] },
  }
}

function contiguousRuns(sortedIndices: number[]): [number, number][] {
  const runs: [number, number][] = []
  let start: number | null = null
  let previous: number | null = null
  for (const index of sortedIndices) {
    if (start === null) { start = index; previous = index; continue }
    if (index === previous! + 1) { previous = index; continue }
    runs.push([start, previous!])
    start = index
    previous = index
  }
  if (start !== null) runs.push([start, previous!])
  return runs
}

function requireStrictlyTimedForReconstruction(points: readonly TrackPoint[]): TimedPoint[] {
  const timed: TimedPoint[] = []
  for (const point of points) {
    if (point.time === undefined) {
      throw new Error('Reconstructing dropped outliers requires every point to carry a timestamp. Drop the untimed points first, or turn reconstruction off.')
    }
    timed.push(point as TimedPoint)
  }
  for (let index = 1; index < timed.length; index++) {
    if (timed[index]!.time <= timed[index - 1]!.time) {
      throw new Error(`Reconstructing dropped outliers requires strictly increasing timestamps; index ${index} is not after index ${index - 1}. Sort by time and de-jitter first.`)
    }
  }
  return timed
}

function validateDropOutliersParams(value: unknown): DropOutliersParams {
  const record = requireRecord(value, 'Drop outliers')
  rejectUnknownKeys(record, 'Drop outliers', [
    'channels', 'windowSize', 'scoreThreshold',
    'minPositionScaleMeters', 'minElevationScaleMeters', 'minSpeedScaleMps',
    'profile', 'reconstruct', 'contextPoints',
  ])
  if (!Array.isArray(record.channels)) throw new Error('channels must be an array')
  const channels = record.channels.map((channel) => requireOneOf(channel, 'channels[]', ALL_OUTLIER_CHANNELS))
  if (channels.length === 0) throw new Error('At least one outlier channel must be selected')
  if (new Set(channels).size !== channels.length) throw new Error('channels must not repeat')
  return {
    channels,
    windowSize: requireInteger(record.windowSize, 'windowSize', 1),
    scoreThreshold: requireGreaterThan(record.scoreThreshold, 'scoreThreshold', 0),
    minPositionScaleMeters: requireGreaterThan(record.minPositionScaleMeters, 'minPositionScaleMeters', 0),
    minElevationScaleMeters: requireGreaterThan(record.minElevationScaleMeters, 'minElevationScaleMeters', 0),
    minSpeedScaleMps: requireGreaterThan(record.minSpeedScaleMps, 'minSpeedScaleMps', 0),
    profile: requireOneOf(record.profile, 'profile', MOTION_PROFILE_IDS),
    reconstruct: requireBoolean(record.reconstruct, 'reconstruct'),
    // Two knots reduce the fit to a straight secant, matching Fill gaps' own minimum.
    contextPoints: requireInteger(record.contextPoints, 'contextPoints', 2),
  }
}

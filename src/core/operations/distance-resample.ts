import { collectChannels, haversineMeters, inferChannelDefinitions, type Dataset, type TrackPoint } from '../model'
import type { OperationDefinition, OperationExecutionContext, OperationExecutionResult } from '../recipes/model'
import { monotoneCubicInterpolate } from './monotone-interpolation'
import { isAngularChannel, unwrapDegrees, unwrapLongitudes, wrapDegrees, wrapLongitude } from './angular'

export interface DistanceResampleParams {
  intervalMeters: number
}

/**
 * Resample points at fixed cumulative-distance intervals using Fritsch-
 * Carlson monotone cubic interpolation for latitude, longitude, elevation,
 * and any fully-numeric extension channel. Distance (not time) is the
 * interpolation parameter, so this also works on untimed tracks. Because
 * the interpolant is monotone-limited, it cannot overshoot/undershoot past
 * its two neighboring samples the way a naive/natural cubic spline can.
 *
 * Timestamps are interpolated the same way when every source point has one
 * and time is monotone non-decreasing with distance; otherwise time is
 * dropped with a warning rather than fabricated. Name/description and any
 * non-fully-numeric extension channel are carried from the nearest source
 * point (step-carry) rather than silently discarded. Angular extension
 * channels (heading/bearing/course, by declared channel semanticType or
 * name) are unwrapped across the 0/360 seam before interpolating and
 * re-wrapped after, the same way longitude is, so they don't swing the long
 * way around when crossing 0/360.
 */
export const distanceResampleMonotoneOperation: OperationDefinition<DistanceResampleParams> = {
  id: 'resample-distance-monotone-cubic',
  version: 1,
  label: 'Resample by distance (monotone cubic)',
  description: 'Resample points at fixed cumulative-distance intervals using Fritsch-Carlson monotone cubic interpolation. Avoids the overshoot/undershoot a naive cubic spline would introduce.',
  validateParams,
  execute,
}

function validateParams(value: unknown): DistanceResampleParams {
  if (!isRecord(value)) throw new Error('Distance resample parameters must be an object')
  const intervalMeters = value.intervalMeters
  if (typeof intervalMeters !== 'number' || !Number.isFinite(intervalMeters) || intervalMeters <= 0) {
    throw new Error('intervalMeters must be a finite number greater than 0')
  }
  return { intervalMeters }
}

function execute(context: OperationExecutionContext<DistanceResampleParams>): OperationExecutionResult {
  if (context.scope) throw new Error('Distance resampling currently requires full-dataset scope')
  const source = context.dataset.points
  if (source.length < 2) throw new Error('Distance resampling requires at least two points')

  // Cumulative distance is the interpolation parameter; monotone cubic
  // fitting requires strictly increasing x, so coincident (zero-length
  // segment) points are dropped before fitting.
  const kept: TrackPoint[] = [source[0]!]
  const distances: number[] = [0]
  for (let i = 1; i < source.length; i++) {
    const prev = kept[kept.length - 1]!
    const point = source[i]!
    const segment = haversineMeters(prev.lat, prev.lon, point.lat, point.lon)
    if (segment <= 0) continue
    distances.push(distances[distances.length - 1]! + segment)
    kept.push(point)
  }
  if (kept.length < 2) throw new Error('Distance resampling requires at least two spatially distinct points')

  const totalDistance = distances[distances.length - 1]!
  const intervalMeters = context.params.intervalMeters
  const estimatedCount = Math.floor(totalDistance / intervalMeters) + 1
  if (estimatedCount > 5_000_000) throw new Error('Requested resampling would create more than 5,000,000 points')

  const queryDistances: number[] = []
  for (let i = 0; i < estimatedCount; i++) queryDistances.push(Math.min(totalDistance, i * intervalMeters))
  if (queryDistances.at(-1) !== totalDistance) queryDistances.push(totalDistance)

  const lats = monotoneCubicInterpolate(distances, kept.map((p) => p.lat), queryDistances)
  const lons = monotoneCubicInterpolate(distances, unwrapLongitudes(kept.map((p) => p.lon)), queryDistances)
  const hasEle = kept.every((p) => p.ele !== undefined)
  const eles = hasEle ? monotoneCubicInterpolate(distances, kept.map((p) => p.ele!), queryDistances) : null

  // Time is only interpolated when every kept point has one AND it is
  // monotone non-decreasing in the (distance-sorted) kept order; distance,
  // not time, is the resampling parameter, so unlike fixed-rate resampling
  // there is no guarantee of that unless checked explicitly.
  const hasAllTime = kept.every((p) => p.time !== undefined)
  const timeMonotone = hasAllTime && isNonDecreasing(kept.map((p) => p.time!))
  const times = hasAllTime && timeMonotone ? monotoneCubicInterpolate(distances, kept.map((p) => p.time!), queryDistances) : null

  const numericChannels = collectChannels(kept).filter((channel) => kept.every((p) => typeof p.ext?.[channel] === 'number'))
  const carryChannels = collectChannels(kept).filter((channel) => !numericChannels.includes(channel))
  // Angular channels (heading/bearing/course) wrap at 0/360 rather than
  // being a continuous linear quantity like most ext channels — naively
  // monotone-cubic-interpolating raw degree values would treat e.g. 359deg
  // -> 1deg as a ~358deg swing through 180 instead of the true ~2deg
  // crossing through 0/360, the same class of bug longitude already guards
  // against via unwrapLongitudes/wrapLongitude above.
  const angularChannels = numericChannels.filter((channel) => isAngularChannel(channel, context.dataset.metadata?.channels))
  const numericExtValues = new Map(numericChannels.map((channel) => [
    channel,
    angularChannels.includes(channel)
      ? monotoneCubicInterpolate(distances, unwrapDegrees(kept.map((p) => p.ext![channel] as number)), queryDistances).map(wrapDegrees)
      : monotoneCubicInterpolate(distances, kept.map((p) => p.ext![channel] as number), queryDistances),
  ]))
  // Used for name/desc carry as well as non-numeric ext carry, so always computed.
  const nearest = nearestSourceIndices(distances, queryDistances)

  const output: TrackPoint[] = queryDistances.map((_, i) => {
    const nearestPoint = kept[nearest[i]!]!
    const ext: Record<string, number | string | boolean> | undefined = numericChannels.length > 0 || carryChannels.length > 0
      ? {
          ...Object.fromEntries(numericChannels.map((channel) => [channel, numericExtValues.get(channel)![i]!])),
          ...Object.fromEntries(carryChannels.flatMap((channel) => nearestPoint.ext?.[channel] === undefined ? [] : [[channel, nearestPoint.ext[channel]]])),
        }
      : undefined
    return {
      lat: lats[i]!,
      lon: wrapLongitude(lons[i]!),
      ele: hasEle ? eles![i] : undefined,
      time: times ? times[i] : undefined,
      name: nearestPoint.name,
      desc: nearestPoint.desc,
      ext,
      provenance: { qualityFlags: ['interpolated', 'monotone_cubic'] },
    }
  })

  const channels = collectChannels(output)
  const dataset: Dataset = {
    ...context.dataset,
    points: output,
    channels,
    metadata: context.dataset.metadata
      ? { ...context.dataset.metadata, channels: inferChannelDefinitions(output, channels) }
      : undefined,
  }
  const droppedCoincident = source.length - kept.length
  const warnings: string[] = []
  if (droppedCoincident > 0) warnings.push(`Dropped ${droppedCoincident.toLocaleString()} coincident point(s) before fitting`)
  if (hasAllTime && !timeMonotone) warnings.push('Source time is not monotone with cumulative distance; time was dropped from the resampled output')
  return {
    dataset,
    summary: `Resampled ${kept.length.toLocaleString()} points to ${output.length.toLocaleString()} points every ${intervalMeters} m (monotone cubic)`,
    warnings,
  }
}

function isNonDecreasing(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i]! < values[i - 1]!) return false
  }
  return true
}

/**
 * For each ascending query distance, finds the index of the nearest source
 * (kept) distance via a single forward two-pointer scan over both sorted
 * arrays — O(n) total rather than a per-query search, since kept/query can
 * both be in the millions of points.
 */
function nearestSourceIndices(distances: number[], queryDistances: number[]): number[] {
  const result: number[] = []
  let cursor = 0
  for (const query of queryDistances) {
    while (cursor < distances.length - 1 && distances[cursor + 1]! <= query) cursor++
    if (cursor < distances.length - 1) {
      const left = distances[cursor]!
      const right = distances[cursor + 1]!
      result.push(query - left <= right - query ? cursor : cursor + 1)
    } else {
      result.push(cursor)
    }
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

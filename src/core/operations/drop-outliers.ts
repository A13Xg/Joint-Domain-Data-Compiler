// Multi-channel outlier removal.
//
// This replaces the elevation-only `removeElevationOutliers` card. It shares
// `detectOutliers` with the Track Health scan, so what the scan reports and
// what this drops cannot drift apart, and Track Health finally has a
// remediation action rather than only a pointer at the problem. The detector
// gained one optional field for this caller — a channel mask — which Track
// Health omits and therefore still scores all three channels.

import { clonePoint, type TrackPoint } from '../model'
import { ALL_OUTLIER_CHANNELS, detectOutliers, type OutlierChannel, type OutlierConfig } from '../quality/outliers'
import type { OperationDefinition } from '../recipes/model'
import { withPoints } from '../transforms'
import { requireGreaterThan, requireInteger, requireOneOf, requireRecord, rejectUnknownKeys } from './params'

export interface DropOutliersParams extends OutlierConfig {
  channels: OutlierChannel[]
}

export const dropOutliersOperation: OperationDefinition<DropOutliersParams> = {
  id: 'drop-outliers',
  version: 1,
  label: 'Drop outliers',
  description: 'Remove points that break their local trend in position, elevation, or ground speed, scored by a robust (MAD-based) z-score against their neighbours.',
  validateParams: validateDropOutliersParams,
  execute: ({ dataset, params, scope }) => {
    if (scope?.timeRange) throw new Error('Drop outliers does not support time-range scope')
    const points = dataset.points
    // The channel selection is pushed into the detector rather than applied to
    // its output: `channelByIndex` names only the highest-scoring channel, so
    // filtering on it afterwards would spare a point that broke a selected
    // channel's threshold merely because an unselected one scored higher.
    const detection = detectOutliers(points, params)

    // Detection always runs over the whole track: a point's score is defined
    // by its neighbours, and a window truncated at a selection boundary would
    // score the same point differently depending on where the user dragged.
    // The scope narrows only which flagged points are removed.
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

    const kept: TrackPoint[] = []
    for (let index = 0; index < points.length; index++) {
      if (!doomed.has(index)) kept.push(clonePoint(points[index]!))
    }

    const breakdown = ALL_OUTLIER_CHANNELS
      .filter((channel) => byChannel.has(channel))
      .map((channel) => `${channel} ${byChannel.get(channel)}`)
      .join(', ')
    const where = range ? ` within range ${lower}–${upper}` : ''
    const summary = doomed.size === 0
      ? `No outliers exceeded ${params.scoreThreshold}σ${where}`
      : `Dropped ${doomed.size} outlier point(s)${where} at >${params.scoreThreshold}σ (${breakdown})`

    return { dataset: withPoints(dataset, kept), summary }
  },
}

function validateDropOutliersParams(value: unknown): DropOutliersParams {
  const record = requireRecord(value, 'Drop outliers')
  rejectUnknownKeys(record, 'Drop outliers', [
    'channels', 'windowSize', 'scoreThreshold',
    'minPositionScaleMeters', 'minElevationScaleMeters', 'minSpeedScaleMps',
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
  }
}

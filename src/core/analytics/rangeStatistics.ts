import { haversineMeters, type TrackPoint } from '../model'
import type { SelectedIndexRange } from '../../state/pointSelection'

export interface NumericSummary {
  count: number
  min: number
  max: number
  mean: number
}

export interface RangeStatistics {
  startIndex: number
  endIndex: number
  pointCount: number
  durationSeconds?: number
  distanceMeters: number
  channels: Record<string, NumericSummary>
}

export function calculateRangeStatistics(
  points: readonly TrackPoint[],
  range: SelectedIndexRange,
  channelIds: readonly string[] = [],
): RangeStatistics {
  if (points.length === 0) throw new Error('Cannot calculate range statistics for an empty dataset')
  const startIndex = Math.max(0, Math.min(points.length - 1, Math.min(range.start, range.end)))
  const endIndex = Math.max(0, Math.min(points.length - 1, Math.max(range.start, range.end)))
  const selected = points.slice(startIndex, endIndex + 1)

  let distanceMeters = 0
  for (let index = 1; index < selected.length; index++) {
    const previous = selected[index - 1]
    const current = selected[index]
    if (!previous || !current) continue
    distanceMeters += haversineMeters(previous.lat, previous.lon, current.lat, current.lon)
  }

  const firstTime = selected.find((point) => point.time !== undefined)?.time
  const lastTime = [...selected].reverse().find((point) => point.time !== undefined)?.time
  const durationSeconds = firstTime !== undefined && lastTime !== undefined && lastTime >= firstTime
    ? (lastTime - firstTime) / 1000
    : undefined

  const ids = [...new Set(['elevation', ...channelIds])]
  const channels: Record<string, NumericSummary> = {}
  for (const id of ids) {
    const values = selected
      .map((point) => numericValue(point, id))
      .filter((value): value is number => value !== null)
    if (values.length === 0) continue
    channels[id] = {
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    }
  }

  return {
    startIndex,
    endIndex,
    pointCount: selected.length,
    durationSeconds,
    distanceMeters,
    channels,
  }
}

function numericValue(point: TrackPoint, id: string): number | null {
  if (id === 'elevation') return point.ele !== undefined && Number.isFinite(point.ele) ? point.ele : null
  const value = point.ext?.[id]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

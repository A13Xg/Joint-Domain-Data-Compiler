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
  let distanceMeters = 0
  let firstTime: number | undefined
  let lastTime: number | undefined
  let previous: TrackPoint | undefined
  const summaries = new Map<string, { count: number; min: number; max: number; sum: number }>()
  const ids = [...new Set(['elevation', ...channelIds])]
  for (let index = startIndex; index <= endIndex; index++) {
    const current = points[index]
    if (!current) continue
    if (previous) distanceMeters += haversineMeters(previous.lat, previous.lon, current.lat, current.lon)
    previous = current
    if (current.time !== undefined) {
      firstTime ??= current.time
      lastTime = current.time
    }
    for (const id of ids) {
      const value = numericValue(current, id)
      if (value === null) continue
      const summary = summaries.get(id)
      if (summary) {
        summary.count++
        summary.min = Math.min(summary.min, value)
        summary.max = Math.max(summary.max, value)
        summary.sum += value
      } else summaries.set(id, { count: 1, min: value, max: value, sum: value })
    }
  }
  const durationSeconds = firstTime !== undefined && lastTime !== undefined && lastTime >= firstTime
    ? (lastTime - firstTime) / 1000
    : undefined

  const channels: Record<string, NumericSummary> = {}
  for (const [id, summary] of summaries) {
    channels[id] = {
      count: summary.count,
      min: summary.min,
      max: summary.max,
      mean: summary.sum / summary.count,
    }
  }

  return {
    startIndex,
    endIndex,
    pointCount: endIndex - startIndex + 1,
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

import type { TrackPoint } from './model'

export interface IndexRange {
  start: number
  end: number
}

export interface TimeRange {
  startMs: number
  endMs: number
}

export interface WorkspaceSelection {
  datasetId: string | null
  pointIndex: number | null
  timeCursorMs: number | null
  indexRange: IndexRange | null
  timeRange: TimeRange | null
  segmentIds: string[]
}

export const EMPTY_WORKSPACE_SELECTION: WorkspaceSelection = {
  datasetId: null,
  pointIndex: null,
  timeCursorMs: null,
  indexRange: null,
  timeRange: null,
  segmentIds: [],
}

export function normalizeIndexRange(range: IndexRange, pointCount: number): IndexRange | null {
  if (pointCount <= 0) return null
  const lower = Math.min(range.start, range.end)
  const upper = Math.max(range.start, range.end)
  const start = Math.max(0, Math.min(pointCount - 1, Math.floor(lower)))
  const end = Math.max(0, Math.min(pointCount - 1, Math.floor(upper)))
  return { start, end }
}

export function normalizeTimeRange(range: TimeRange): TimeRange {
  return range.startMs <= range.endMs
    ? { ...range }
    : { startMs: range.endMs, endMs: range.startMs }
}

export function timeRangeToIndexRange(points: TrackPoint[], range: TimeRange): IndexRange | null {
  const normalized = normalizeTimeRange(range)
  let start = -1
  let end = -1

  for (let index = 0; index < points.length; index++) {
    const time = points[index]?.time
    if (time === undefined || time < normalized.startMs || time > normalized.endMs) continue
    if (start === -1) start = index
    end = index
  }

  return start === -1 ? null : { start, end }
}

export function indexRangeToTimeRange(points: TrackPoint[], range: IndexRange): TimeRange | null {
  const normalized = normalizeIndexRange(range, points.length)
  if (!normalized) return null

  let startMs = Infinity
  let endMs = -Infinity
  for (let index = normalized.start; index <= normalized.end; index++) {
    const time = points[index]?.time
    if (time === undefined) continue
    if (time < startMs) startMs = time
    if (time > endMs) endMs = time
  }

  return Number.isFinite(startMs) ? { startMs, endMs } : null
}

export function nearestPointIndexByTime(points: TrackPoint[], timeMs: number): number | null {
  let nearestIndex: number | null = null
  let nearestDistance = Infinity

  for (let index = 0; index < points.length; index++) {
    const time = points[index]?.time
    if (time === undefined) continue
    const distance = Math.abs(time - timeMs)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  }

  return nearestIndex
}

export function selectedPoints(points: TrackPoint[], selection: WorkspaceSelection): TrackPoint[] {
  if (selection.indexRange) {
    const range = normalizeIndexRange(selection.indexRange, points.length)
    return range ? points.slice(range.start, range.end + 1) : []
  }

  if (selection.timeRange) {
    const range = normalizeTimeRange(selection.timeRange)
    return points.filter((point) => point.time !== undefined && point.time >= range.startMs && point.time <= range.endMs)
  }

  return points
}

export function resetSelectionForDataset(datasetId: string | null): WorkspaceSelection {
  return {
    ...EMPTY_WORKSPACE_SELECTION,
    datasetId,
    segmentIds: [],
  }
}

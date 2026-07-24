import type { TrackPoint } from './model'
import type { TransformResult } from './transforms'
import type { SelectedIndexRange } from '../state/pointSelection'

export function applyTransformToRange(
  points: readonly TrackPoint[],
  range: SelectedIndexRange,
  transform: (selected: TrackPoint[]) => TransformResult,
): TransformResult {
  if (points.length === 0) throw new Error('Cannot apply a range transform to an empty dataset')
  const start = Math.max(0, Math.min(points.length - 1, Math.min(range.start, range.end)))
  const end = Math.max(0, Math.min(points.length - 1, Math.max(range.start, range.end)))
  const selected = points.slice(start, end + 1).map(clonePoint)
  const result = transform(selected)
  if (result.points.length !== selected.length) {
    throw new Error('Selected-range transforms must preserve point count')
  }

  const output = points.map(clonePoint)
  output.splice(start, selected.length, ...result.points.map(clonePoint))
  return {
    points: output,
    summary: `${result.summary} within selected range ${start}–${end}`,
  }
}

function clonePoint(point: TrackPoint): TrackPoint {
  return {
    ...point,
    ext: point.ext ? { ...point.ext } : undefined,
    provenance: point.provenance
      ? { ...point.provenance, qualityFlags: point.provenance.qualityFlags ? [...point.provenance.qualityFlags] : undefined }
      : undefined,
  }
}

// Spatial occupancy binning: where did the track actually spend its samples?
//
// Kept free of any DOM or Leaflet dependency so it is unit-testable and so the
// roadmap's multi-track divergence heatmaps can reuse it without dragging a
// renderer along.

import { unwrapLongitudes, wrapLongitude } from '../operations/angular'
import type { TrackPoint } from '../model'

export interface SpatialBin {
  /** Bin indices; multiply by the cell size to recover the south-west corner. */
  row: number
  column: number
  /** South-west and north-east corners in degrees, longitude re-wrapped. */
  south: number
  west: number
  north: number
  east: number
  count: number
}

export interface SpatialBinResult {
  cells: SpatialBin[]
  /** Highest count in any cell; 0 when there is nothing to bin. */
  max: number
  /** Cell size actually used, after the safety clamp. */
  cellMeters: number
  /** Reference latitude the longitude scaling was computed at. */
  referenceLat: number
}

const METERS_PER_DEGREE_LAT = 111_320
/** Above this the cos(lat) scaling blows the longitude cell up without limit. */
const MAX_ABS_REFERENCE_LAT = 89.5

/**
 * Bins points into approximately equal-area cells.
 *
 * A degree of longitude shrinks with latitude, so cells are sized in degrees of
 * latitude and then widened in longitude by 1/cos(lat) at a reference latitude.
 * That keeps a cell roughly square on the ground instead of increasingly
 * letterboxed toward the poles, which is what makes counts between cells
 * comparable at all.
 *
 * No cell budget is enforced. The number of occupied cells cannot exceed the
 * number of points however small `cellMeters` is, and the parsers already cap
 * imports at 100k points, so an arbitrarily small cell size costs memory in
 * proportion to the track rather than without bound. Capping how many cells
 * are *rendered* is the renderer's job, and DensityLayer does it.
 *
 * Longitude is unwrapped before binning. A track crossing the antimeridian has
 * a raw longitude series that jumps 179 → −179, which would scatter one
 * continuous pass into cells thousands of columns apart; unwrapping makes the
 * series continuous, and each cell's reported bounds are re-wrapped so the
 * renderer still receives real coordinates.
 */
export function binTrack(points: readonly TrackPoint[], cellMeters: number): SpatialBinResult {
  if (!Number.isFinite(cellMeters) || cellMeters <= 0) throw new Error('cellMeters must be a finite number greater than 0')

  const usable = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 90)
  if (usable.length === 0) return { cells: [], max: 0, cellMeters, referenceLat: 0 }

  const referenceLat = clamp(
    usable.reduce((sum, point) => sum + point.lat, 0) / usable.length,
    -MAX_ABS_REFERENCE_LAT,
    MAX_ABS_REFERENCE_LAT,
  )
  const cosLat = Math.max(Math.cos((referenceLat * Math.PI) / 180), 1e-6)

  const latStep = cellMeters / METERS_PER_DEGREE_LAT
  const lonStep = latStep / cosLat

  const unwrappedLons = unwrapLongitudes(usable.map((point) => point.lon))

  const counts = new Map<string, { row: number; column: number; count: number }>()
  let max = 0
  for (let index = 0; index < usable.length; index++) {
    const row = Math.floor(usable[index]!.lat / latStep)
    const column = Math.floor(unwrappedLons[index]! / lonStep)
    const key = `${row}:${column}`
    const existing = counts.get(key)
    if (existing) {
      existing.count++
      if (existing.count > max) max = existing.count
    } else {
      counts.set(key, { row, column, count: 1 })
      if (max === 0) max = 1
    }
  }

  const cells: SpatialBin[] = [...counts.values()].map((cell) => ({
    row: cell.row,
    column: cell.column,
    count: cell.count,
    south: cell.row * latStep,
    north: (cell.row + 1) * latStep,
    west: wrapLongitude(cell.column * lonStep),
    east: wrapLongitude((cell.column + 1) * lonStep),
  }))
  // Ascending count so a renderer painting in order draws the busiest cells
  // last, on top.
  cells.sort((left, right) => left.count - right.count)

  return { cells, max, cellMeters, referenceLat }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

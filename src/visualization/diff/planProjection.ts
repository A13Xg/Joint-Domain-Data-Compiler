// Local plan-view projection shared by the repair preview and the point
// visualizer: several tracks onto one equal-aspect frame of local meters.
//
// Equal aspect is the point. A repair that nudges a sample 50 m north has to
// look like 50 m next to a leg that is 50 m long, so the same metres-per-pixel
// scale is used on both axes rather than stretching each to fill the box.
//
// Longitudes are unwrapped per series and then brought within half a turn of
// the frame origin, so a track crossing the antimeridian projects as the short
// continuous path it is instead of a streak across the whole plot.

import { EARTH_RADIUS_M, type TrackPoint } from '../../core/model'
import { unwrapLongitudes } from '../../core/operations/angular'

const METERS_PER_DEGREE = (EARTH_RADIUS_M * Math.PI) / 180
const DEGREES_TO_RADIANS = Math.PI / 180

/** A projected sample. `sourceIndex` is the index in the track it came from. */
export interface PlanPoint {
  sourceIndex: number
  x: number
  y: number
}

export interface PlanFrame {
  originLat: number
  originLon: number
  /** Pixels per metre, identical on both axes. */
  scale: number
  offsetX: number
  offsetY: number
  width: number
  height: number
  /** Half-width of the framed area in metres, for the scale bar. */
  spanMeters: number
}

/** A plan view of a dense track is drawn from a stride sample; markers still come from the full arrays. */
export const MAX_PLAN_SAMPLES = 2000

export function planStride(pointCount: number, maxSamples = MAX_PLAN_SAMPLES): number {
  if (pointCount <= maxSamples || maxSamples < 1) return 1
  return Math.ceil(pointCount / maxSamples)
}

/**
 * Builds one frame that fits every supplied track. Returns null when no track
 * holds a finite coordinate — callers render an explanation rather than an
 * empty box.
 */
export function buildPlanFrame(
  tracks: readonly (readonly TrackPoint[])[],
  width: number,
  height: number,
  padding: number,
): PlanFrame | null {
  const usable = tracks.filter((track) => track.some(isPlottable))
  if (usable.length === 0 || width <= padding * 2 || height <= padding * 2) return null

  const first = usable[0]!.find(isPlottable)!
  const originLat = first.lat
  const originLon = first.lon
  const cosLat = Math.max(Math.cos(originLat * DEGREES_TO_RADIANS), 1e-6)

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const track of usable) {
    for (const [x, y] of localMeters(track, originLat, originLon, cosLat)) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null

  // A stationary track has zero span on both axes; give it a metre of room so
  // the sample still lands in the middle of the box instead of dividing by zero.
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY)

  return {
    originLat,
    originLon,
    scale,
    offsetX: width / 2 - ((minX + maxX) / 2) * scale,
    // SVG y grows downward; north must grow upward, hence the negated centre.
    offsetY: height / 2 + ((minY + maxY) / 2) * scale,
    width,
    height,
    spanMeters: Math.max(spanX, spanY),
  }
}

/** Projects one point. Returns null for a coordinate that cannot be plotted. */
export function projectPoint(point: TrackPoint, frame: PlanFrame): PlanPoint | null {
  if (!isPlottable(point)) return null
  const cosLat = Math.max(Math.cos(frame.originLat * DEGREES_TO_RADIANS), 1e-6)
  const lon = nearestLongitude(point.lon, frame.originLon)
  const east = (lon - frame.originLon) * METERS_PER_DEGREE * cosLat
  const north = (point.lat - frame.originLat) * METERS_PER_DEGREE
  return { sourceIndex: 0, x: east * frame.scale + frame.offsetX, y: frame.offsetY - north * frame.scale }
}

/**
 * Projects a whole track, dropping unplottable samples and thinning to at most
 * `maxSamples` for display. Thinning is a stride, not a min/max reduction: a
 * plan view is a shape, and picking extremes per axis would distort it.
 */
export function projectTrack(
  points: readonly TrackPoint[],
  frame: PlanFrame,
  maxSamples = MAX_PLAN_SAMPLES,
): PlanPoint[] {
  const stride = planStride(points.length, maxSamples)
  const projected: PlanPoint[] = []
  const cosLat = Math.max(Math.cos(frame.originLat * DEGREES_TO_RADIANS), 1e-6)
  const lons = unwrapAgainst(points, frame.originLon)

  for (let index = 0; index < points.length; index += stride) {
    const point = points[index]!
    if (!isPlottable(point)) continue
    projected.push(place(point.lat, lons[index]!, index, frame, cosLat))
  }
  // The last sample anchors the end of the path; a stride that misses it would
  // shorten the drawn track for no reason the user could see.
  const lastIndex = points.length - 1
  if (lastIndex >= 0 && projected[projected.length - 1]?.sourceIndex !== lastIndex && isPlottable(points[lastIndex]!)) {
    projected.push(place(points[lastIndex]!.lat, lons[lastIndex]!, lastIndex, frame, cosLat))
  }
  return projected
}

/** A round distance close to a quarter of the frame, for a scale bar. */
export function niceScaleBarMeters(frame: PlanFrame): number {
  const target = frame.spanMeters / 4
  if (!Number.isFinite(target) || target <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(target))
  for (const step of [1, 2, 5]) {
    if (target < step * magnitude) return step * magnitude
  }
  return 10 * magnitude
}

export function formatScaleBar(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`
  if (meters >= 1) return `${meters.toLocaleString(undefined, { maximumFractionDigits: 0 })} m`
  return `${(meters * 100).toFixed(0)} cm`
}

export function isPlottable(point: TrackPoint): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lon)
}

function place(lat: number, lon: number, sourceIndex: number, frame: PlanFrame, cosLat: number): PlanPoint {
  const east = (lon - frame.originLon) * METERS_PER_DEGREE * cosLat
  const north = (lat - frame.originLat) * METERS_PER_DEGREE
  return { sourceIndex, x: east * frame.scale + frame.offsetX, y: frame.offsetY - north * frame.scale }
}

function* localMeters(points: readonly TrackPoint[], originLat: number, originLon: number, cosLat: number): Generator<[number, number]> {
  const lons = unwrapAgainst(points, originLon)
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!
    if (!isPlottable(point)) continue
    yield [(lons[index]! - originLon) * METERS_PER_DEGREE * cosLat, (point.lat - originLat) * METERS_PER_DEGREE]
  }
}

/**
 * Unwraps a track's longitudes into a continuous series, then translates the
 * whole series by whole turns so it sits beside the frame origin. Unwrapping
 * alone is not enough: two tracks unwrapped independently can end up a full
 * turn apart and would plot as two distant paths.
 */
function unwrapAgainst(points: readonly TrackPoint[], originLon: number): number[] {
  const unwrapped = unwrapLongitudes(points.map((point) => (Number.isFinite(point.lon) ? point.lon : originLon)))
  const first = unwrapped.find((value) => Number.isFinite(value))
  if (first === undefined) return unwrapped
  const turns = Math.round((originLon - first) / 360)
  return turns === 0 ? unwrapped : unwrapped.map((value) => value + turns * 360)
}

function nearestLongitude(lon: number, originLon: number): number {
  return lon + Math.round((originLon - lon) / 360) * 360
}

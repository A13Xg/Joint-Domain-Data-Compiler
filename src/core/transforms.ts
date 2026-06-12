// Data manipulation primitives — the "correct & massage" half of the app.
// Every transform is pure (returns new points) so the UI can preview, stack,
// and undo operations deterministically.
import { collectChannels, haversineMeters, isValidLat, isValidLon, type Dataset, type TrackPoint } from './model'

export interface TransformResult {
  points: TrackPoint[]
  /** Human-readable summary of what changed (logged + shown as a toast). */
  summary: string
}

function clone(points: TrackPoint[]): TrackPoint[] {
  return points.map((p) => ({ ...p, ext: p.ext ? { ...p.ext } : undefined }))
}

/** Sort ascending by timestamp; points without time keep relative order at end. */
export function sortByTime(points: TrackPoint[]): TransformResult {
  const out = clone(points).sort((a, b) => {
    if (a.time === undefined && b.time === undefined) return 0
    if (a.time === undefined) return 1
    if (b.time === undefined) return -1
    return a.time - b.time
  })
  return { points: out, summary: 'Sorted points by ascending time' }
}

/** Swap latitude and longitude on every point (fixes transposed exports). */
export function swapLatLon(points: TrackPoint[]): TransformResult {
  const out = clone(points).map((p) => ({ ...p, lat: p.lon, lon: p.lat }))
  return { points: out, summary: 'Swapped latitude and longitude' }
}

/** Drop points whose coordinates are invalid or out of range. */
export function dropInvalid(points: TrackPoint[]): TransformResult {
  const out = points.filter((p) => isValidLat(p.lat) && isValidLon(p.lon))
  return { points: clone(out), summary: `Removed ${points.length - out.length} invalid points` }
}

/** Remove consecutive duplicate coordinates (optionally within a tolerance). */
export function dedupe(points: TrackPoint[], toleranceMeters = 0): TransformResult {
  const out: TrackPoint[] = []
  let removed = 0
  for (const p of points) {
    const prev = out[out.length - 1]
    if (prev && haversineMeters(prev.lat, prev.lon, p.lat, p.lon) <= toleranceMeters) {
      removed++
      continue
    }
    out.push({ ...p, ext: p.ext ? { ...p.ext } : undefined })
  }
  return { points: out, summary: `Removed ${removed} duplicate points (≤ ${toleranceMeters} m)` }
}

/** Keep every Nth point — fast decimation for very dense tracks. */
export function decimate(points: TrackPoint[], factor: number): TransformResult {
  const f = Math.max(1, Math.floor(factor))
  const out = clone(points).filter((_, i) => i % f === 0)
  return { points: out, summary: `Decimated to every ${f}th point (${out.length} kept)` }
}

/**
 * Douglas–Peucker simplification in lon/lat space — removes redundant points
 * while preserving track shape within an epsilon (degrees).
 */
export function simplify(points: TrackPoint[], epsilonMeters: number): TransformResult {
  if (points.length < 3) return { points: clone(points), summary: 'Too few points to simplify' }
  const epsDeg = epsilonMeters / 111_320 // rough meters→degrees at equator
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()!
    let maxDist = 0
    let index = -1
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(points[i], points[start], points[end])
      if (d > maxDist) {
        maxDist = d
        index = i
      }
    }
    if (maxDist > epsDeg && index !== -1) {
      keep[index] = 1
      stack.push([start, index], [index, end])
    }
  }

  const out = clone(points).filter((_, i) => keep[i] === 1)
  return { points: out, summary: `Simplified ${points.length} → ${out.length} points (ε=${epsilonMeters} m)` }
}

function perpendicularDistance(p: TrackPoint, a: TrackPoint, b: TrackPoint): number {
  const dx = b.lon - a.lon
  const dy = b.lat - a.lat
  const mag = Math.hypot(dx, dy)
  if (mag === 0) return Math.hypot(p.lon - a.lon, p.lat - a.lat)
  const u = ((p.lon - a.lon) * dx + (p.lat - a.lat) * dy) / (mag * mag)
  const projX = a.lon + u * dx
  const projY = a.lat + u * dy
  return Math.hypot(p.lon - projX, p.lat - projY)
}

/** Moving-average smoothing over a window for elevation and/or coordinates. */
export function smooth(
  points: TrackPoint[],
  window: number,
  targets: { coords: boolean; elevation: boolean },
): TransformResult {
  const w = Math.max(1, Math.floor(window))
  const half = Math.floor(w / 2)
  const out = clone(points)
  for (let i = 0; i < points.length; i++) {
    let latSum = 0, lonSum = 0, eleSum = 0, eleCount = 0, count = 0
    for (let j = i - half; j <= i + half; j++) {
      if (j < 0 || j >= points.length) continue
      latSum += points[j].lat
      lonSum += points[j].lon
      if (points[j].ele !== undefined) { eleSum += points[j].ele as number; eleCount++ }
      count++
    }
    if (targets.coords && count > 0) {
      out[i].lat = latSum / count
      out[i].lon = lonSum / count
    }
    if (targets.elevation && eleCount > 0 && out[i].ele !== undefined) {
      out[i].ele = eleSum / eleCount
    }
  }
  const what = [targets.coords && 'position', targets.elevation && 'elevation'].filter(Boolean).join(' + ')
  return { points: out, summary: `Smoothed ${what} (window ${w})` }
}

/** Derive speed (m/s), cumulative distance (m), and heading (deg) from geometry+time. */
export function deriveKinematics(points: TrackPoint[]): TransformResult {
  const out = clone(points)
  let cumDist = 0
  for (let i = 0; i < out.length; i++) {
    const ext = out[i].ext ?? {}
    if (i === 0) {
      ext['distance_m'] = 0
      ext['speed_mps'] = 0
    } else {
      const prev = out[i - 1]
      const d = haversineMeters(prev.lat, prev.lon, out[i].lat, out[i].lon)
      cumDist += d
      ext['distance_m'] = Math.round(cumDist * 1000) / 1000
      if (out[i].time !== undefined && prev.time !== undefined) {
        const dt = (out[i].time! - prev.time!) / 1000
        ext['speed_mps'] = dt > 0 ? Math.round((d / dt) * 1000) / 1000 : 0
      }
      ext['heading_deg'] = Math.round(bearing(prev, out[i]) * 100) / 100
    }
    out[i].ext = ext
  }
  return { points: out, summary: 'Derived distance, speed, and heading channels' }
}

function bearing(a: TrackPoint, b: TrackPoint): number {
  const toRad = Math.PI / 180
  const y = Math.sin((b.lon - a.lon) * toRad) * Math.cos(b.lat * toRad)
  const x =
    Math.cos(a.lat * toRad) * Math.sin(b.lat * toRad) -
    Math.sin(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.cos((b.lon - a.lon) * toRad)
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360
}

/** Shift every timestamp by a fixed number of seconds (clock alignment). */
export function shiftTime(points: TrackPoint[], seconds: number): TransformResult {
  const out = clone(points).map((p) =>
    p.time !== undefined ? { ...p, time: p.time + seconds * 1000 } : p,
  )
  return { points: out, summary: `Shifted timestamps by ${seconds} s` }
}

/** Add a constant offset to every elevation (datum correction). */
export function offsetElevation(points: TrackPoint[], meters: number): TransformResult {
  const out = clone(points).map((p) =>
    p.ele !== undefined ? { ...p, ele: p.ele + meters } : p,
  )
  return { points: out, summary: `Offset elevation by ${meters} m` }
}

/** Keep points within an inclusive time window (epoch ms). */
export function clipTimeRange(points: TrackPoint[], startMs: number, endMs: number): TransformResult {
  const out = points.filter((p) => p.time === undefined || (p.time >= startMs && p.time <= endMs))
  return { points: clone(out), summary: `Clipped to time window (${out.length} kept)` }
}

/** Remove statistical outliers in elevation using a rolling median absolute deviation. */
export function removeElevationOutliers(points: TrackPoint[], threshold = 4): TransformResult {
  const eles = points.map((p) => p.ele).filter((e): e is number => e !== undefined)
  if (eles.length < 5) return { points: clone(points), summary: 'Too few elevations for outlier removal' }
  const median = quantile(eles, 0.5)
  const mad = quantile(eles.map((e) => Math.abs(e - median)), 0.5) || 1
  let removed = 0
  const out = points.filter((p) => {
    if (p.ele === undefined) return true
    const score = Math.abs(p.ele - median) / (1.4826 * mad)
    if (score > threshold) { removed++; return false }
    return true
  })
  return { points: clone(out), summary: `Removed ${removed} elevation outliers (>${threshold}σ)` }
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base]
}

/** Apply a transform result back onto a dataset, refreshing channel list. */
export function withPoints(dataset: Dataset, points: TrackPoint[]): Dataset {
  return { ...dataset, points, channels: collectChannels(points) }
}

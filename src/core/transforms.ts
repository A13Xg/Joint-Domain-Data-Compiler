// Data manipulation primitives — the "correct & massage" half of the app.
// Every transform is pure so the UI can preview, stack, and undo operations deterministically.
import { collectChannels, haversineMeters, inferChannelDefinitions, isValidLat, isValidLon, type Dataset, type TrackPoint } from './model'

export interface TransformResult {
  points: TrackPoint[]
  summary: string
}

export type UntimedPointPolicy = 'keep' | 'drop'

function clonePoint(p: TrackPoint): TrackPoint {
  return {
    ...p,
    ext: p.ext ? { ...p.ext } : undefined,
    provenance: p.provenance
      ? { ...p.provenance, qualityFlags: p.provenance.qualityFlags ? [...p.provenance.qualityFlags] : undefined }
      : undefined,
  }
}

function clone(points: TrackPoint[]): TrackPoint[] {
  return points.map(clonePoint)
}

/** Fills `into` with the defined elevations in `[from, to)`, reusing the array
 *  so the rolling-window filters below allocate once instead of building a
 *  slice, a map, and a filter per point. Ascending order is preserved. */
function collectElevations(points: TrackPoint[], from: number, to: number, into: number[]): void {
  into.length = 0
  for (let i = from; i < to; i++) {
    const ele = points[i]!.ele
    if (ele !== undefined) into.push(ele)
  }
}

export function sortByTime(points: TrackPoint[]): TransformResult {
  const out = clone(points).sort((a, b) => {
    if (a.time === undefined && b.time === undefined) return 0
    if (a.time === undefined) return 1
    if (b.time === undefined) return -1
    return a.time - b.time
  })
  return { points: out, summary: 'Sorted points by ascending time' }
}

export function swapLatLon(points: TrackPoint[]): TransformResult {
  return { points: clone(points).map((p) => ({ ...p, lat: p.lon, lon: p.lat })), summary: 'Swapped latitude and longitude' }
}

export function dropInvalid(points: TrackPoint[]): TransformResult {
  const out = points.filter((p) => isValidLat(p.lat) && isValidLon(p.lon))
  return { points: clone(out), summary: `Removed ${points.length - out.length} invalid points` }
}

export function dedupe(points: TrackPoint[], toleranceMeters = 0): TransformResult {
  const out: TrackPoint[] = []
  let removed = 0
  let prev: TrackPoint | undefined
  for (const p of points) {
    if (prev && haversineMeters(prev.lat, prev.lon, p.lat, p.lon) <= toleranceMeters) {
      removed++
      continue
    }
    prev = clonePoint(p)
    out.push(prev)
  }
  return { points: out, summary: `Removed ${removed} consecutive duplicate points (≤ ${toleranceMeters} m)` }
}

export function decimate(points: TrackPoint[], factor: number): TransformResult {
  const f = Math.max(1, Math.floor(factor))
  const out = clone(points.filter((_, i) => i % f === 0))
  return { points: out, summary: `Decimated to every ${f}th point (${out.length} kept)` }
}

/** Douglas–Peucker simplification in a local equirectangular projection measured in meters. */
export function simplify(points: TrackPoint[], epsilonMeters: number): TransformResult {
  if (points.length < 3) return { points: clone(points), summary: 'Too few points to simplify' }
  const referenceLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length
  const projected = points.map((p) => projectMeters(p, referenceLat))
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]

  while (stack.length) {
    const [start, end] = stack.pop()!
    const from = projected[start]!
    const to = projected[end]!
    let maxDist = 0
    let index = -1
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(projected[i]!, from, to)
      if (d > maxDist) {
        maxDist = d
        index = i
      }
    }
    if (maxDist > Math.max(0, epsilonMeters) && index !== -1) {
      keep[index] = 1
      stack.push([start, index], [index, end])
    }
  }

  const out = clone(points.filter((_, i) => keep[i] === 1))
  return { points: out, summary: `Simplified ${points.length} → ${out.length} points (ε=${epsilonMeters} m)` }
}

interface XY { x: number; y: number }

function projectMeters(p: TrackPoint, referenceLat: number): XY {
  const rad = Math.PI / 180
  return {
    x: p.lon * rad * 6371008.8 * Math.cos(referenceLat * rad),
    y: p.lat * rad * 6371008.8,
  }
}

function perpendicularDistance(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const mag2 = dx * dx + dy * dy
  if (mag2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / mag2))
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy))
}

/** Moving-average smoothing using ECEF vectors for antimeridian-safe coordinates. */
export function smooth(points: TrackPoint[], window: number, targets: { coords: boolean; elevation: boolean }): TransformResult {
  const w = Math.max(1, Math.floor(window))
  const half = Math.floor(w / 2)
  const out = clone(points)

  // Every window covering point j recomputed j's ECEF unit vector, so a window
  // of w cost w trig evaluations per point. Computing each vector once cuts
  // that to one. The window sums still accumulate in ascending j order over
  // the same terms, so the result is bit-identical to the inline form.
  const ecefX = new Float64Array(points.length)
  const ecefY = new Float64Array(points.length)
  const ecefZ = new Float64Array(points.length)
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!
    const lat = point.lat * Math.PI / 180
    const lon = point.lon * Math.PI / 180
    ecefX[i] = Math.cos(lat) * Math.cos(lon)
    ecefY[i] = Math.cos(lat) * Math.sin(lon)
    ecefZ[i] = Math.sin(lat)
  }

  for (let i = 0; i < points.length; i++) {
    let x = 0, y = 0, z = 0, eleSum = 0, eleCount = 0, count = 0
    const first = Math.max(0, i - half)
    const last = Math.min(points.length - 1, i + half)
    for (let j = first; j <= last; j++) {
      x += ecefX[j]!
      y += ecefY[j]!
      z += ecefZ[j]!
      const ele = points[j]!.ele
      if (ele !== undefined) { eleSum += ele; eleCount++ }
      count++
    }
    const target = out[i]!
    if (targets.coords && count > 0) {
      const lon = Math.atan2(y / count, x / count)
      const hyp = Math.hypot(x / count, y / count)
      const lat = Math.atan2(z / count, hyp)
      target.lat = lat * 180 / Math.PI
      target.lon = lon * 180 / Math.PI
    }
    if (targets.elevation && eleCount > 0 && target.ele !== undefined) target.ele = eleSum / eleCount
  }

  const what = [targets.coords && 'position', targets.elevation && 'elevation'].filter(Boolean).join(' + ')
  return { points: out, summary: `Smoothed ${what} (window ${w})` }
}

export function shiftTime(points: TrackPoint[], seconds: number): TransformResult {
  return {
    points: clone(points).map((p) => p.time !== undefined ? { ...p, time: p.time + seconds * 1000 } : p),
    summary: `Shifted timestamps by ${seconds} s`,
  }
}

export function offsetElevation(points: TrackPoint[], meters: number): TransformResult {
  return {
    points: clone(points).map((p) => p.ele !== undefined ? { ...p, ele: p.ele + meters } : p),
    summary: `Offset elevation by ${meters} m`,
  }
}

export function clipTimeRange(points: TrackPoint[], startMs: number, endMs: number, untimedPolicy: UntimedPointPolicy = 'keep'): TransformResult {
  const out = points.filter((p) => p.time === undefined ? untimedPolicy === 'keep' : p.time >= startMs && p.time <= endMs)
  return { points: clone(out), summary: `Clipped to time window (${out.length} kept; untimed=${untimedPolicy})` }
}

/** Remove local elevation outliers using a rolling median absolute deviation window. */
export function removeElevationOutliers(points: TrackPoint[], threshold = 4, window = 21): TransformResult {
  if (points.filter((p) => p.ele !== undefined).length < 5) return { points: clone(points), summary: 'Too few elevations for outlier removal' }
  const radius = Math.max(2, Math.floor(window / 2))
  let removed = 0
  const local: number[] = []
  const out = points.filter((p, i) => {
    if (p.ele === undefined) return true
    collectElevations(points, Math.max(0, i - radius), Math.min(points.length, i + radius + 1), local)
    if (local.length < 5) return true
    const median = quantile(local, 0.5)
    const mad = quantile(local.map((value) => Math.abs(value - median)), 0.5)
    if (mad === 0) return true
    const score = Math.abs(p.ele - median) / (1.4826 * mad)
    if (score > threshold) { removed++; return false }
    return true
  })
  return { points: clone(out), summary: `Removed ${removed} rolling elevation outliers (>${threshold}σ, window=${radius * 2 + 1})` }
}

/**
 * Rolling median filter over elevation. Robust to spikes without the
 * amplitude/phase distortion a moving-average filter introduces; unlike
 * removeElevationOutliers, this never changes the point count. Index-window
 * based (not time-window based), so it makes no assumption about uniform
 * sample spacing — the reason it is safe to ship ahead of a Butterworth
 * filter, which is deferred until sampling-rate assumptions are explicit.
 */
export function medianFilterElevation(points: TrackPoint[], window: number): TransformResult {
  const w = Math.max(1, Math.floor(window))
  const half = Math.floor(w / 2)
  const out = clone(points)
  let changed = 0

  const local: number[] = []
  for (let i = 0; i < points.length; i++) {
    if (points[i]!.ele === undefined) continue
    collectElevations(points, Math.max(0, i - half), Math.min(points.length, i + half + 1), local)
    if (local.length === 0) continue
    const median = quantile(local, 0.5)
    const target = out[i]!
    if (target.ele !== median) changed++
    target.ele = median
  }

  return { points: out, summary: `Applied median filter to elevation (window ${w}, ${changed} point(s) changed)` }
}

/** Causal EMA over elevation; missing values remain unchanged. */
export function exponentialMovingAverageElevation(points: TrackPoint[], alpha: number): TransformResult {
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) throw new Error('EMA alpha must be greater than 0 and less than 1')
  const out = clone(points)
  let previous: number | undefined
  let changed = 0
  for (const point of out) {
    if (point.ele === undefined) continue
    const smoothed = previous === undefined ? point.ele : alpha * point.ele + (1 - alpha) * previous
    previous = smoothed
    if (smoothed !== point.ele) {
      point.ele = smoothed
      addFlag(point, 'ema_smoothed')
      changed++
    }
  }
  return { points: out, summary: `Applied EMA to elevation (α=${alpha}, ${changed} point(s) changed)` }
}

/**
 * Hampel identifier over elevation: like removeElevationOutliers, but
 * replaces an outlier with the local median instead of dropping the point,
 * so the point count and timing are preserved. Flagged points carry
 * `hampel_corrected` provenance so the correction is traceable.
 */
export function hampelFilterElevation(points: TrackPoint[], sigmaThreshold = 3, window = 11): TransformResult {
  if (points.filter((p) => p.ele !== undefined).length < 5) return { points: clone(points), summary: 'Too few elevations for Hampel filtering' }
  const radius = Math.max(2, Math.floor(window / 2))
  const out = clone(points)
  let replaced = 0

  const local: number[] = []
  for (let i = 0; i < out.length; i++) {
    const current = out[i]!
    if (current.ele === undefined) continue
    collectElevations(points, Math.max(0, i - radius), Math.min(points.length, i + radius + 1), local)
    if (local.length < 5) continue
    const median = quantile(local, 0.5)
    const mad = quantile(local.map((value) => Math.abs(value - median)), 0.5)
    // A zero MAD means the window is otherwise uniform: any deviation is
    // unbounded in score terms, so treat "differs from the median at all" as
    // the outlier condition rather than skipping (which would silently miss
    // the clearest possible spike — a single value in a flat run).
    const isOutlier = mad === 0 ? current.ele !== median : Math.abs(current.ele - median) / (1.4826 * mad) > sigmaThreshold
    if (isOutlier) {
      current.ele = median
      addFlag(current, 'hampel_corrected')
      replaced++
    }
  }

  return { points: out, summary: `Hampel filter replaced ${replaced} elevation outlier(s) with the local median (>${sigmaThreshold}σ, window=${radius * 2 + 1})` }
}

export type DuplicateTimestampPolicy = 'nudge' | 'drop' | 'average'

export interface DejitterTimestampsOptions {
  /**
   * How to resolve a timestamp that is not strictly greater than the
   * previous (kept) point's timestamp — either an exact duplicate or a
   * backward jump from clock drift/jitter. Default: `'nudge'`.
   *
   * - `'nudge'` (default): shift the offending timestamp forward to
   *   `previous + epsilonMs`. Preserves point count and point identity;
   *   the safest default because it never discards or blends samples —
   *   it only breaks time ties deterministically.
   * - `'drop'`: discard the offending point entirely.
   * - `'average'`: merge the offending point into the previously kept
   *   point (numeric fields averaged; ext channels averaged where both
   *   sides are numeric) rather than emitting a second point at
   *   (effectively) the same instant.
   */
  duplicatePolicy?: DuplicateTimestampPolicy
  /** Minimum spacing enforced between corrected timestamps, in milliseconds. Default: 1. */
  epsilonMs?: number
}

/**
 * Enforce strictly-increasing timestamps across timed points, correcting
 * jitter/duplicate/clock-drift artifacts without reordering points (use
 * `sortByTime` first if the input isn't already time-ordered). Untimed
 * points pass through unchanged and do not participate in the monotonic
 * check. Default policy is `'nudge'` — see `DejitterTimestampsOptions` for
 * the full policy contract. Corrected/merged points are flagged with
 * `time_dejittered` provenance so the correction is traceable.
 *
 * Known limitation: when this runs over a sub-range of a larger dataset (see
 * `applyTransformToRange`), the `'nudge'` policy only sees timestamps inside
 * the slice it was given. A run of nudges near the end of the range can in
 * principle push a corrected timestamp past the original timestamp of the
 * first point after the range, locally breaking the global
 * strictly-increasing guarantee this function otherwise provides. There is
 * no cheap fix within this function (it would require passing the next
 * out-of-range timestamp in as a ceiling), so range-scoped nudges on data
 * with heavy jitter right at a range boundary should be treated as a known
 * edge case rather than a guarantee.
 */
export function dejitterTimestamps(points: TrackPoint[], options: DejitterTimestampsOptions = {}): TransformResult {
  const duplicatePolicy = options.duplicatePolicy ?? 'nudge'
  const epsilonMs = options.epsilonMs ?? 1
  if (!Number.isFinite(epsilonMs) || epsilonMs <= 0) throw new Error('epsilonMs must be a finite number greater than 0')
  if (points.length === 0) return { points: [], summary: 'No points to de-jitter' }

  const cloned = clone(points)
  const out: TrackPoint[] = []
  let lastOutTime: number | undefined
  let lastTimedOutIndex: number | undefined
  let corrected = 0
  let dropped = 0

  for (const point of cloned) {
    if (point.time === undefined) { out.push(point); continue }

    if (lastOutTime === undefined || point.time > lastOutTime) {
      out.push(point)
      lastOutTime = point.time
      lastTimedOutIndex = out.length - 1
      continue
    }

    // Non-increasing timestamp: exact duplicate or backward drift/jitter.
    corrected++
    if (duplicatePolicy === 'drop') {
      dropped++
      continue
    }
    if (duplicatePolicy === 'average') {
      // Merge into the last output point that actually has a defined time —
      // not simply the last-pushed point, which may be an untimed point that
      // was pushed through unconditionally above. Merging into an untimed
      // point would spread `time: undefined` over the merged result and
      // silently discard this point's real timestamp. lastTimedOutIndex is
      // guaranteed to be defined here because lastOutTime is defined (the
      // `lastOutTime === undefined` branch above is the only path that
      // leaves it unset, and that branch always short-circuits first).
      const targetIndex = lastTimedOutIndex!
      const previous = out[targetIndex]!
      out[targetIndex] = mergeAveraged(previous, point)
      addFlag(out[targetIndex], 'time_dejittered')
      continue
    }
    // 'nudge'
    const newTime = lastOutTime + epsilonMs
    point.time = newTime
    addFlag(point, 'time_dejittered')
    out.push(point)
    lastOutTime = newTime
    lastTimedOutIndex = out.length - 1
  }

  const detail = duplicatePolicy === 'drop'
    ? `dropped ${dropped}`
    : duplicatePolicy === 'average'
      ? `merged ${corrected}`
      : `nudged ${corrected}`
  return { points: out, summary: `De-jittered timestamps (policy=${duplicatePolicy}, ${detail}, ε=${epsilonMs}ms)` }
}

/** Merge `next` into `previous` by averaging numeric fields; `previous`'s timestamp is kept. */
function mergeAveraged(previous: TrackPoint, next: TrackPoint): TrackPoint {
  const extKeys = new Set([...Object.keys(previous.ext ?? {}), ...Object.keys(next.ext ?? {})])
  const ext: Record<string, number | string | boolean> = {}
  for (const key of extKeys) {
    const a = previous.ext?.[key]
    const b = next.ext?.[key]
    if (typeof a === 'number' && typeof b === 'number') ext[key] = (a + b) / 2
    else if (a !== undefined) ext[key] = a
    else if (b !== undefined) ext[key] = b
  }
  return {
    ...previous,
    lat: (previous.lat + next.lat) / 2,
    lon: (previous.lon + next.lon) / 2,
    ele: previous.ele !== undefined && next.ele !== undefined ? (previous.ele + next.ele) / 2 : previous.ele ?? next.ele,
    name: previous.name ?? next.name,
    desc: previous.desc ?? next.desc,
    ext: Object.keys(ext).length > 0 ? ext : undefined,
  }
}

function addFlag(point: TrackPoint, flag: string): void {
  const flags = new Set(point.provenance?.qualityFlags ?? [])
  flags.add(flag)
  point.provenance = { ...point.provenance, qualityFlags: [...flags] }
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const lower = sorted[base]
  // Every caller filters its window before calling, so an empty input is a
  // programming error; returning `undefined` typed as a number would poison
  // whatever arithmetic consumed it.
  if (lower === undefined) throw new Error('quantile requires at least one value')
  const upper = sorted[base + 1]
  return upper !== undefined ? lower + rest * (upper - lower) : lower
}

export function withPoints(dataset: Dataset, points: TrackPoint[]): Dataset {
  const channels = collectChannels(points)
  const retained = dataset.metadata?.channels.filter((definition) => channels.includes(definition.id)) ?? []
  const retainedIds = new Set(retained.map((definition) => definition.id))
  const definitions = [...retained, ...inferChannelDefinitions(points, channels.filter((channel) => !retainedIds.has(channel)))]
  return {
    ...dataset,
    points,
    channels,
    metadata: dataset.metadata ? { ...dataset.metadata, channels: definitions } : undefined,
  }
}
